// compute-mmm — closed-form geometric adstock + Hill saturation with bootstrap CIs.
// Version 0. Not a Bayesian posterior. Gated by marketing-readiness.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const MODEL_VERSION = "bootstrap-v0";
const WINDOW_DAYS = 90;

// -------- math helpers --------
function adstock(x: number[], lambda: number): number[] {
  const y = new Array(x.length).fill(0);
  for (let i = 0; i < x.length; i++) y[i] = x[i] + (i > 0 ? lambda * y[i - 1] : 0);
  return y;
}

function hill(x: number, alpha: number, gamma: number): number {
  if (x <= 0) return 0;
  const xa = Math.pow(x, alpha);
  return xa / (Math.pow(gamma, alpha) + xa);
}

function fit(spendByDay: number[], revByDay: number[]) {
  // Grid search lambda ∈ [0, 0.9], alpha ∈ [0.5, 3], gamma ∈ percentiles of spend
  const nonzero = spendByDay.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonzero.length < 5) return null;
  const gammaCandidates = [0.25, 0.5, 0.75].map((p) => nonzero[Math.floor(p * (nonzero.length - 1))]);
  const lambdas = [0, 0.15, 0.3, 0.45, 0.6, 0.75];
  const alphas = [0.7, 1.0, 1.5, 2.0, 2.5];
  const meanRev = revByDay.reduce((s, v) => s + v, 0) / revByDay.length;
  const ssTot = revByDay.reduce((s, v) => s + (v - meanRev) ** 2, 0) || 1;

  let best: any = null;
  for (const lambda of lambdas) {
    const stocked = adstock(spendByDay, lambda);
    for (const alpha of alphas) {
      for (const gamma of gammaCandidates) {
        // Ordinary least squares beta = sum(y * s) / sum(s^2), s = hill(stock)
        const s = stocked.map((v) => hill(v, alpha, gamma));
        const num = s.reduce((sum, si, i) => sum + si * revByDay[i], 0);
        const den = s.reduce((sum, si) => sum + si * si, 0) || 1e-9;
        const beta = num / den;
        const pred = s.map((si) => si * beta);
        const ssRes = revByDay.reduce((sum, y, i) => sum + (y - pred[i]) ** 2, 0);
        const r2 = 1 - ssRes / ssTot;
        if (!best || r2 > best.r2) best = { lambda, alpha, gamma, beta, r2, stocked };
      }
    }
  }
  return best;
}

function bootstrapROI(spend: number[], rev: number[], fitParams: any, iters = 100) {
  const n = spend.length;
  const rois: number[] = [];
  for (let b = 0; b < iters; b++) {
    const bs = new Array(n), br = new Array(n);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      bs[i] = spend[idx]; br[i] = rev[idx];
    }
    const totalSpend = bs.reduce((s, v) => s + v, 0);
    const stocked = adstock(bs, fitParams.lambda);
    const contrib = stocked.reduce((s, v) => s + hill(v, fitParams.alpha, fitParams.gamma) * fitParams.beta, 0);
    if (totalSpend > 0) rois.push(contrib / totalSpend);
  }
  rois.sort((a, b) => a - b);
  const q = (p: number) => rois[Math.floor(p * (rois.length - 1))] ?? 0;
  const mean = rois.reduce((s, v) => s + v, 0) / (rois.length || 1);
  const pGt1 = rois.filter((r) => r > 1).length / (rois.length || 1);
  return { mean, p10: q(0.1), p90: q(0.9), prob_gt_1: pGt1, samples: rois.length };
}

async function runForUser(admin: any, user_id: string, app_id: string | null) {
  const sinceDate = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

  let spendQ = admin.from("channel_spend").select("date, channel, normalized_spend").eq("user_id", user_id).gte("date", sinceDate);
  if (app_id) spendQ = spendQ.eq("app_id", app_id);
  const { data: spend = [] } = await spendQ;

  let convQ = admin.from("conversions").select("amount, converted_at, source_content_id, distribution_target_id").eq("user_id", user_id).gte("converted_at", sinceIso);
  if (app_id) convQ = convQ.eq("app_id", app_id);
  const { data: convs = [] } = await convQ;

  // Determine channel per conversion via content or distribution target
  const contentIds = [...new Set((convs ?? []).map((c: any) => c.source_content_id).filter(Boolean))] as string[];
  const targetIds = [...new Set((convs ?? []).map((c: any) => c.distribution_target_id).filter(Boolean))] as string[];
  const contentMap = new Map<string, string>();
  const targetMap = new Map<string, string>();
  if (contentIds.length) {
    const { data } = await admin.from("content").select("id, platform").in("id", contentIds);
    for (const r of data ?? []) contentMap.set(r.id, (r.platform ?? "").toLowerCase());
  }
  if (targetIds.length) {
    const { data } = await admin.from("distribution_targets").select("id, channel").in("id", targetIds);
    for (const r of data ?? []) targetMap.set(r.id, (r.channel ?? "").toLowerCase());
  }

  const channels = [...new Set((spend ?? []).map((r: any) => (r.channel ?? "").toLowerCase()).filter(Boolean))];
  const runs: any[] = [];
  const windowStart = sinceDate;
  const windowEnd = new Date().toISOString().slice(0, 10);

  for (const channel of channels) {
    const days: Record<string, { spend: number; rev: number }> = {};
    for (let i = 0; i <= WINDOW_DAYS; i++) {
      const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      days[d] = { spend: 0, rev: 0 };
    }
    for (const s of spend ?? []) {
      if ((s.channel ?? "").toLowerCase() !== channel) continue;
      if (days[s.date]) days[s.date].spend += Number(s.normalized_spend ?? 0);
    }
    for (const c of convs ?? []) {
      const ch = contentMap.get(c.source_content_id) || targetMap.get(c.distribution_target_id);
      if (ch !== channel) continue;
      const d = c.converted_at?.slice(0, 10);
      if (days[d]) days[d].rev += Number(c.amount ?? 0);
    }
    const ordered = Object.keys(days).sort();
    const spendArr = ordered.map((d) => days[d].spend);
    const revArr = ordered.map((d) => days[d].rev);
    const sampleSize = spendArr.filter((v) => v > 0).length;

    const f = fit(spendArr, revArr);
    if (!f) {
      runs.push({
        user_id, app_id, channel, model_version: MODEL_VERSION,
        sample_size: sampleSize, fit_quality: 0,
        window_start: windowStart, window_end: windowEnd,
        metadata: { insufficient_data: true },
      });
      continue;
    }
    const boot = bootstrapROI(spendArr, revArr, f, 150);
    const totalSpend = spendArr.reduce((s, v) => s + v, 0);
    // Marginal ROI at current avg spend
    const avgSpend = totalSpend / spendArr.length;
    const eps = Math.max(avgSpend * 0.05, 1);
    const stocked = adstock(spendArr, f.lambda);
    const currentContrib = hill(stocked[stocked.length - 1], f.alpha, f.gamma) * f.beta;
    const bumped = hill(stocked[stocked.length - 1] + eps, f.alpha, f.gamma) * f.beta;
    const marginal = (bumped - currentContrib) / eps;
    // Saturation ≈ gamma (Hill EC50)
    const saturation_point = f.gamma;
    // Optimal spend: point where marginal ROI ≈ 1 (rough — Hill inversion)
    // Solve hill'(x)*beta = 1 → for Hill: derivative complex, approximate by search
    let optimal = avgSpend;
    for (let x = eps; x < avgSpend * 10; x += eps) {
      const dh = (hill(x + eps, f.alpha, f.gamma) - hill(x, f.alpha, f.gamma)) / eps;
      if (dh * f.beta < 1) { optimal = x; break; }
    }

    runs.push({
      user_id, app_id, channel,
      adstock_lambda: f.lambda,
      hill_alpha: f.alpha,
      hill_gamma: f.gamma,
      roi_mean: boot.mean,
      roi_p10: boot.p10,
      roi_p90: boot.p90,
      probability_roi_gt_1: boot.prob_gt_1,
      marginal_roi: marginal,
      saturation_point,
      optimal_spend: optimal,
      fit_quality: Math.max(0, Math.min(1, f.r2)),
      sample_size: sampleSize,
      model_version: MODEL_VERSION,
      window_start: windowStart, window_end: windowEnd,
      metadata: { beta: f.beta, bootstrap_samples: boot.samples, total_spend: totalSpend },
    });
  }

  if (runs.length) await admin.from("mmm_runs").insert(runs);
  return { channels: channels.length, runs: runs.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // Cron path: header CRON_SECRET → run for all users with recent spend
    const isCron = CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;

    if (isCron) {
      const { data: users } = await admin.from("channel_spend")
        .select("user_id")
        .gte("date", new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
      const uniq = [...new Set((users ?? []).map((u: any) => u.user_id))];
      const results: any[] = [];
      for (const uid of uniq) results.push({ uid, ...(await runForUser(admin, uid, null)) });
      return new Response(JSON.stringify({ ok: true, users: uniq.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // User path
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Enforce readiness gate for on-demand runs
    const readinessRes = await fetch(`${SUPABASE_URL}/functions/v1/marketing-readiness${body.app_id ? `?app_id=${body.app_id}` : ""}`, {
      headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
    });
    const readiness = await readinessRes.json();
    if (!readiness?.mmm_ready && !body.force) {
      return new Response(JSON.stringify({
        error: "readiness_gate_blocked",
        message: "Marketing Mix Model is not yet statistically reliable. Recommendations remain heuristic until sufficient evidence has been collected.",
        readiness,
      }), { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = await runForUser(admin, user.id, body.app_id ?? null);
    return new Response(JSON.stringify({ ok: true, ...result, model_version: MODEL_VERSION }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("compute-mmm error", e);
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
