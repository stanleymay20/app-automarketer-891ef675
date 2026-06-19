// Dawn Marketing Autopilot — orchestrates a full morning marketing cycle.
// Cron/service-role only. Resumable, idempotent per user/day, modular.
// Every module runs in isolation; failures are recorded but don't abort the run.
import {
  adminClient,
  corsHeaders,
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireCron,
  safeJson,
} from "../_shared/guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RULE_VERSION = "dawn-autopilot-v1";

interface DawnSettings {
  user_id: string;
  dawn_autopilot_enabled: boolean;
  dawn_autopilot_time: string;
  dawn_timezone: string;
  dawn_max_daily_prospects: number;
  dawn_max_daily_outreach: number;
  dawn_max_daily_content: number;
  dawn_require_review_for_content: boolean;
  dawn_require_review_for_high_value: boolean;
  dawn_high_value_threshold: number;
  dawn_last_run_at: string | null;
}

interface Metrics {
  prospects_discovered: number;
  prospects_enriched: number;
  prospects_qualified: number;
  prospects_auto_sent: number;
  prospects_sent_to_review: number;
  content_generated: number;
  content_scheduled: number;
  proposals_created: number;
  followups_created: number;
  revenue_expected: number;
  errors: { module: string; message: string }[];
  details: Record<string, unknown>;
}

function emptyMetrics(): Metrics {
  return {
    prospects_discovered: 0, prospects_enriched: 0, prospects_qualified: 0,
    prospects_auto_sent: 0, prospects_sent_to_review: 0,
    content_generated: 0, content_scheduled: 0,
    proposals_created: 0, followups_created: 0, revenue_expected: 0,
    errors: [], details: {},
  };
}

async function invokeFn(name: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, data };
}

async function audit(userId: string, action: string, decision: string, ctx: Record<string, unknown>) {
  try {
    await adminClient().from("automation_audit_log").insert({
      user_id: userId,
      action_type: action,
      decision,
      rule_version: RULE_VERSION,
      context: ctx,
    });
  } catch (e) {
    console.error("[dawn] audit log failed", e);
  }
}

async function runModule<T>(label: string, m: Metrics, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[dawn] module ${label} failed`, msg);
    m.errors.push({ module: label, message: msg });
    return null;
  }
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

async function runForUser(settings: DawnSettings): Promise<{ runId: string; metrics: Metrics; status: string }> {
  const admin = adminClient();
  const userId = settings.user_id;
  const today = ymd(new Date());
  const m = emptyMetrics();

  // Idempotency: if a completed/running run already exists for today, reuse it.
  const { data: existing } = await admin
    .from("dawn_autopilot_runs")
    .select("id,status")
    .eq("user_id", userId)
    .gte("started_at", `${today}T00:00:00Z`)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let runId: string;
  if (existing && existing.status === "running") {
    runId = existing.id;
  } else if (existing && existing.status === "completed") {
    return { runId: existing.id, metrics: emptyMetrics(), status: "skipped_already_completed" };
  } else {
    const { data: inserted, error } = await admin
      .from("dawn_autopilot_runs")
      .insert({ user_id: userId, status: "running" })
      .select("id")
      .single();
    if (error) throw error;
    runId = inserted.id;
  }

  await audit(userId, "dawn_autopilot_started", "started", { run_id: runId });

  // 1. Review yesterday's performance — pull aggregate counters
  await runModule("yesterday_review", m, async () => {
    const yStart = new Date(Date.now() - 86_400_000); yStart.setUTCHours(0,0,0,0);
    const yEnd = new Date(yStart); yEnd.setUTCHours(23,59,59,999);
    const [{ count: replies }, { count: meetings }, { count: outcomes }, { count: conv }] = await Promise.all([
      admin.from("prospect_replies").select("id", { count: "exact", head: true })
        .eq("user_id", userId).gte("received_at", yStart.toISOString()).lte("received_at", yEnd.toISOString()),
      admin.from("meetings").select("id", { count: "exact", head: true })
        .eq("user_id", userId).gte("scheduled_at", yStart.toISOString()).lte("scheduled_at", yEnd.toISOString()),
      admin.from("outcomes").select("id", { count: "exact", head: true })
        .eq("user_id", userId).gte("created_at", yStart.toISOString()).lte("created_at", yEnd.toISOString()),
      admin.from("conversions").select("id", { count: "exact", head: true })
        .eq("user_id", userId).gte("created_at", yStart.toISOString()).lte("created_at", yEnd.toISOString()),
    ]);
    m.details.yesterday = { replies: replies ?? 0, meetings: meetings ?? 0, outcomes: outcomes ?? 0, conversions: conv ?? 0 };
  });

  // 2. Learn — call learning insights generator
  await runModule("learning_insights", m, async () => {
    const r = await invokeFn("generate-learning-insights", { user_id: userId });
    m.details.learning = { ok: r.ok, status: r.status };
  });

  // 3 & 4. Refresh + enrich prospect pipeline
  await runModule("prospect_pipeline", m, async () => {
    const r = await invokeFn("process-prospect-pipeline", {
      user_id: userId,
      max_prospects: settings.dawn_max_daily_prospects,
    });
    if (r.ok && r.data) {
      m.prospects_discovered = Number(r.data.discovered ?? r.data.prospects_discovered ?? 0);
      m.prospects_enriched = Number(r.data.enriched ?? r.data.prospects_enriched ?? 0);
      m.prospects_qualified = Number(r.data.qualified ?? r.data.prospects_qualified ?? 0);
    }
    m.details.pipeline = r.data ?? { ok: r.ok, status: r.status };
  });

  // 5 & 6. Estimate expected value + route prospects (auto-send vs review vs nurture)
  await runModule("route_prospects", m, async () => {
    const { data: candidates } = await admin
      .from("prospects")
      .select("id,segment,opportunity_score,opportunity_confidence,expected_value,stage,autopilot_state")
      .eq("user_id", userId)
      .eq("autopilot_state", "queued")
      .limit(settings.dawn_max_daily_outreach * 4);

    let autoSent = 0;
    let toReview = 0;
    const highValThreshold = Number(settings.dawn_high_value_threshold ?? 5000);
    const requireReviewHV = settings.dawn_require_review_for_high_value;

    for (const p of candidates ?? []) {
      if (autoSent >= settings.dawn_max_daily_outreach) break;
      const expVal = Number(p.expected_value ?? 0);
      const conf = Number(p.opportunity_confidence ?? 0);
      const score = Number(p.opportunity_score ?? 0);
      const isHighValue = expVal >= highValThreshold;
      const lowConf = conf < 60;
      const eligibleAuto = !isHighValue && !lowConf && score >= 75 && p.segment === "hot";

      if (eligibleAuto && !requireReviewHV) {
        await admin.from("prospects").update({ autopilot_state: "auto_send" }).eq("id", p.id);
        await audit(userId, "prospect_routed", "auto_send", { prospect_id: p.id, score, conf, expVal });
        autoSent++;
      } else {
        const reason = isHighValue ? "high_value" : lowConf ? "low_confidence" : "policy_review";
        await admin.from("prospects").update({ autopilot_state: "review_required", review_status: "pending" }).eq("id", p.id);
        await audit(userId, "prospect_routed", "review_required", { prospect_id: p.id, reason, score, conf, expVal });
        toReview++;
      }
      m.revenue_expected += expVal;
    }
    m.prospects_auto_sent = autoSent;
    m.prospects_sent_to_review = toReview;
  });

  // 7. Generate fresh content (respects cap + review requirement)
  await runModule("generate_content", m, async () => {
    const r = await invokeFn("auto-generate-content", {
      user_id: userId,
      max_pieces: settings.dawn_max_daily_content,
      require_review: settings.dawn_require_review_for_content,
    });
    if (r.ok && r.data) {
      m.content_generated = Number(r.data.generated ?? r.data.content_generated ?? 0);
      m.content_scheduled = Number(r.data.scheduled ?? r.data.content_scheduled ?? 0);
    }
    m.details.content = r.data ?? { ok: r.ok, status: r.status };
  });

  // 8 + 10. Send approved outreach via existing autopilot-tick (honors all existing gates)
  await runModule("outreach_send", m, async () => {
    const r = await invokeFn("autopilot-tick", { user_id: userId });
    m.details.outreach = r.data ?? { ok: r.ok, status: r.status };
  });

  // 9. Publish approved scheduled content (only if user opted into publish autopilot via existing flow)
  await runModule("publish_scheduled", m, async () => {
    const r = await invokeFn("publish-scheduled-content", { user_id: userId });
    m.details.publish = r.data ?? { ok: r.ok, status: r.status };
  });

  // 11. Create follow-up tasks (for meetings that completed without outcomes + replies needing response)
  await runModule("followups", m, async () => {
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { data: needsFollowup } = await admin
      .from("prospect_replies")
      .select("id,prospect_id,subject")
      .eq("user_id", userId)
      .eq("direction", "inbound")
      .gte("received_at", since)
      .limit(20);
    let created = 0;
    for (const r of needsFollowup ?? []) {
      const { data: existing } = await admin
        .from("prospect_actions")
        .select("id")
        .eq("user_id", userId)
        .eq("prospect_id", r.prospect_id)
        .eq("action_type", "followup_task")
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();
      if (existing) continue;
      await admin.from("prospect_actions").insert({
        user_id: userId, prospect_id: r.prospect_id,
        action_type: "followup_task", channel: "internal",
        subject: `Follow up: ${r.subject ?? "inbound reply"}`,
        metadata: { source_reply_id: r.id, created_by: "dawn-autopilot" },
      });
      created++;
    }
    m.followups_created = created;
  });

  // 12. Touch user_settings dawn_last_run_at (acts as Today dashboard refresh signal)
  await runModule("update_dashboard", m, async () => {
    await admin.from("user_settings").update({ dawn_last_run_at: new Date().toISOString() }).eq("user_id", userId);
  });

  // 13. Build the Dawn Marketing Brief
  const brief = buildBrief(m, settings);

  const status = m.errors.length === 0 ? "completed" : "partial";
  await admin.from("dawn_autopilot_runs").update({
    completed_at: new Date().toISOString(),
    status,
    prospects_discovered: m.prospects_discovered,
    prospects_enriched: m.prospects_enriched,
    prospects_qualified: m.prospects_qualified,
    prospects_auto_sent: m.prospects_auto_sent,
    prospects_sent_to_review: m.prospects_sent_to_review,
    content_generated: m.content_generated,
    content_scheduled: m.content_scheduled,
    proposals_created: m.proposals_created,
    followups_created: m.followups_created,
    revenue_expected: m.revenue_expected,
    errors: m.errors,
    details: m.details,
    summary: brief.summary,
    brief,
  }).eq("id", runId);

  await audit(userId, "dawn_autopilot_completed", status, { run_id: runId, metrics: {
    discovered: m.prospects_discovered, auto_sent: m.prospects_auto_sent,
    to_review: m.prospects_sent_to_review, content: m.content_generated,
    followups: m.followups_created, errors: m.errors.length,
  } });

  return { runId, metrics: m, status };
}

function buildBrief(m: Metrics, s: DawnSettings) {
  const discovered = `${m.prospects_discovered} prospect${m.prospects_discovered === 1 ? "" : "s"} discovered, ${m.prospects_enriched} enriched, ${m.prospects_qualified} qualified.`;
  const sent = `${m.prospects_auto_sent} outreach auto-sent, ${m.content_generated} pieces of content generated (${m.content_scheduled} scheduled).`;
  const review = `${m.prospects_sent_to_review} prospect${m.prospects_sent_to_review === 1 ? "" : "s"} awaiting your review.`;
  const pipeline = `Pipeline value added today: ~${Math.round(m.revenue_expected).toLocaleString()}.`;

  const recommended: string[] = [];
  if (m.prospects_sent_to_review > 0) recommended.push(`Review ${m.prospects_sent_to_review} high-value / low-confidence prospect${m.prospects_sent_to_review === 1 ? "" : "s"}.`);
  if (m.content_generated > 0 && s.dawn_require_review_for_content) recommended.push(`Approve ${m.content_generated} draft content piece${m.content_generated === 1 ? "" : "s"}.`);
  if (m.followups_created > 0) recommended.push(`Reply to ${m.followups_created} inbound message${m.followups_created === 1 ? "" : "s"} flagged for follow-up.`);
  while (recommended.length < 3) recommended.push("No additional action needed — keep autopilot running.");

  const risks: string[] = [];
  for (const e of m.errors) risks.push(`${e.module} failed: ${e.message}`);
  if (m.prospects_discovered === 0) risks.push("No new prospects discovered today — top-of-funnel may be drying up.");

  return {
    summary: `${discovered} ${sent} ${review} ${pipeline}`.trim(),
    discovered,
    sent,
    review,
    pipeline_change: pipeline,
    expected_revenue_impact: m.revenue_expected,
    recommended_actions: recommended.slice(0, 3),
    risks,
    learning_insights: (m.details.learning as any) ?? null,
    generated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req); if (pf) return pf;
  const cronCheck = requireCron(req); if (cronCheck) return cronCheck;

  const body = await safeJson<{ user_id?: string; dry_run?: boolean }>(req);
  const admin = adminClient();

  try {
    let q = admin
      .from("user_settings")
      .select("user_id, dawn_autopilot_enabled, dawn_autopilot_time, dawn_timezone, dawn_max_daily_prospects, dawn_max_daily_outreach, dawn_max_daily_content, dawn_require_review_for_content, dawn_require_review_for_high_value, dawn_high_value_threshold, dawn_last_run_at")
      .eq("dawn_autopilot_enabled", true);
    if (body.user_id) q = q.eq("user_id", body.user_id);

    const { data: users, error } = await q.limit(200);
    if (error) throw error;

    const results: any[] = [];
    for (const u of (users ?? []) as DawnSettings[]) {
      // Time-of-day gate (skip if not within ±60min of configured dawn time, unless explicit user_id call)
      if (!body.user_id) {
        const now = new Date();
        // Compute local time in user's tz
        let localHM: string;
        try {
          localHM = new Intl.DateTimeFormat("en-GB", {
            timeZone: u.dawn_timezone || "UTC", hour12: false, hour: "2-digit", minute: "2-digit",
          }).format(now);
        } catch { localHM = now.toISOString().slice(11, 16); }
        const [lh, lm] = localHM.split(":").map(Number);
        const [th, tm] = (u.dawn_autopilot_time ?? "05:00").split(":").map(Number);
        const diffMin = Math.abs((lh * 60 + lm) - (th * 60 + tm));
        if (diffMin > 60) { results.push({ user_id: u.user_id, skipped: "outside_dawn_window", local: localHM, target: u.dawn_autopilot_time }); continue; }
      }

      try {
        const r = await runForUser(u);
        results.push({ user_id: u.user_id, run_id: r.runId, status: r.status, metrics: r.metrics });
      } catch (e: any) {
        results.push({ user_id: u.user_id, error: e?.message ?? String(e) });
      }
    }

    return jsonResponse({ ok: true, processed: results.length, results });
  } catch (e: any) {
    return errorResponse(e?.message ?? "Dawn autopilot failed", 500);
  }
});
