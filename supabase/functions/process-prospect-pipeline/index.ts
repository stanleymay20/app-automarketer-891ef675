// Orchestrate enrich -> qualify -> estimate value for a single prospect or a
// small batch belonging to the authenticated user. NO autopilot, NO sending,
// NO review queue. Sets routing hint `autopilot_state` for later phases.
import {
  handlePreflight,
  requireUser,
  adminClient,
  checkRateLimit,
  errorResponse,
  jsonResponse,
  safeJson,
} from "../_shared/guard.ts";

const RULE_VERSION = "pipeline-v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const STEPS = ["enrich-prospect", "qualify-prospect", "estimate-prospect-value"] as const;
type Step = (typeof STEPS)[number];

interface StepResult {
  step: Step;
  ok: boolean;
  status?: number;
  error?: string;
  data?: any;
}

async function callStep(step: Step, prospectId: string, authHeader: string): Promise<StepResult> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${step}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prospect_id: prospectId }),
    });
    const text = await r.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
    if (!r.ok) {
      return { step, ok: false, status: r.status, error: data?.error || `HTTP ${r.status}`, data };
    }
    return { step, ok: true, status: r.status, data };
  } catch (e) {
    return { step, ok: false, error: (e as Error).message };
  }
}

function deriveRoutingState(p: {
  opportunity_score: number | null;
  opportunity_confidence: number | null;
  expected_value: number | null;
  expected_value_confidence: number | null;
  reviewWorthy: boolean;
}): "queued" | "review_required" | null {
  const opp = Number(p.opportunity_score ?? 0);
  const oppConf = Number(p.opportunity_confidence ?? 0);
  const evConf = Number(p.expected_value_confidence ?? 0);
  const ev = Number(p.expected_value ?? 0);

  if (p.reviewWorthy) return "review_required";
  if (oppConf < 50 || evConf < 50) return "review_required";
  if (opp >= 75 && oppConf >= 60 && ev > 0 && evConf >= 50) return "queued";
  return null;
}

interface PerProspect {
  prospect_id: string;
  ok: boolean;
  steps: StepResult[];
  routing: "queued" | "review_required" | "idle" | null;
  summary: {
    enrichment_confidence?: number | null;
    opportunity_score?: number | null;
    opportunity_confidence?: number | null;
    segment?: string | null;
    expected_value?: number | null;
    expected_value_confidence?: number | null;
    value_currency?: string | null;
    review_worthy?: boolean;
  };
  error?: string;
}

async function processOne(
  prospectId: string,
  userId: string,
  authHeader: string,
  admin: ReturnType<typeof adminClient>,
): Promise<PerProspect> {
  const steps: StepResult[] = [];
  for (const step of STEPS) {
    const res = await callStep(step, prospectId, authHeader);
    steps.push(res);
    // Continue best-effort; later steps benefit from earlier data but are not strictly blocked.
  }

  // Re-read latest prospect state to derive routing
  const { data: latest, error: pErr } = await admin
    .from("prospects")
    .select(
      "enrichment_confidence,opportunity_score,opportunity_confidence,segment,expected_value,expected_value_confidence,value_currency,autopilot_state",
    )
    .eq("id", prospectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (pErr || !latest) {
    return {
      prospect_id: prospectId,
      ok: false,
      steps,
      routing: null,
      summary: {},
      error: pErr?.message ?? "prospect missing after pipeline",
    };
  }

  const evStep = steps.find((s) => s.step === "estimate-prospect-value");
  const reviewWorthy = !!evStep?.data?.review_worthy;

  const routing = deriveRoutingState({
    opportunity_score: latest.opportunity_score,
    opportunity_confidence: latest.opportunity_confidence,
    expected_value: latest.expected_value,
    expected_value_confidence: latest.expected_value_confidence,
    reviewWorthy,
  });

  // Only persist routing hint if the prospect isn't already in a downstream
  // human-managed state (paused/done/sent etc.). We only set queued/review_required/idle.
  const currentState = (latest as any).autopilot_state as string | null;
  const HUMAN_STATES = new Set(["paused", "sending", "sent", "done", "opted_out"]);
  if (!currentState || !HUMAN_STATES.has(currentState)) {
    await admin
      .from("prospects")
      .update({ autopilot_state: routing })
      .eq("id", prospectId)
      .eq("user_id", userId);
  }

  const anyFailed = steps.some((s) => !s.ok);

  return {
    prospect_id: prospectId,
    ok: !anyFailed,
    steps,
    routing,
    summary: {
      enrichment_confidence: latest.enrichment_confidence,
      opportunity_score: latest.opportunity_score,
      opportunity_confidence: latest.opportunity_confidence,
      segment: latest.segment,
      expected_value: latest.expected_value,
      expected_value_confidence: latest.expected_value_confidence,
      value_currency: latest.value_currency,
      review_worthy: reviewWorthy,
    },
    error: anyFailed
      ? steps.filter((s) => !s.ok).map((s) => `${s.step}: ${s.error}`).join("; ")
      : undefined,
  };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const rl = await checkRateLimit(auth.id, "process-prospect-pipeline", 10, 60);
  if (rl) return rl;

  const body = await safeJson<{
    prospect_id?: string;
    app_id?: string;
    limit?: number;
    mode?: "single" | "batch";
  }>(req);

  const mode: "single" | "batch" =
    body.mode === "single" || body.mode === "batch"
      ? body.mode
      : body.prospect_id
        ? "single"
        : "batch";

  const limit = Math.max(1, Math.min(25, Number(body.limit ?? 10) || 10));
  const authHeader = req.headers.get("Authorization") ?? "";
  const admin = adminClient();

  // Resolve target prospect IDs.
  let targets: string[] = [];
  if (mode === "single") {
    if (!body.prospect_id) return errorResponse("prospect_id required in single mode", 400);
    const { data: p, error: e } = await admin
      .from("prospects")
      .select("id")
      .eq("id", body.prospect_id)
      .eq("user_id", auth.id)
      .maybeSingle();
    if (e) return errorResponse(`lookup failed: ${e.message}`, 500);
    if (!p) return errorResponse("Prospect not found", 404);
    targets = [p.id];
  } else {
    let q = admin
      .from("prospects")
      .select("id,enriched_at,opportunity_score,expected_value,autopilot_state,discovered_at,created_at")
      .eq("user_id", auth.id)
      .or("enriched_at.is.null,opportunity_score.is.null,expected_value.is.null")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (body.app_id) q = q.eq("app_id", body.app_id);
    const { data, error } = await q;
    if (error) return errorResponse(`batch lookup failed: ${error.message}`, 500);
    // Skip rows the user has explicitly paused.
    targets = (data ?? [])
      .filter((r: any) => !["paused", "opted_out"].includes(r.autopilot_state ?? ""))
      .map((r: any) => r.id);
  }

  if (targets.length === 0) {
    return jsonResponse({
      ok: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      rule_version: RULE_VERSION,
      message: "Nothing to process",
    });
  }

  const results: PerProspect[] = [];
  for (const id of targets) {
    // Sequential to respect downstream per-user AI rate limits.
    const r = await processOne(id, auth.id, authHeader, admin);
    results.push(r);
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const routingCounts = results.reduce(
    (acc, r) => {
      if (r.routing) acc[r.routing] = (acc[r.routing] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  try {
    await admin.from("automation_audit_log").insert({
      user_id: auth.id,
      action_type: "prospect_pipeline_processed",
      entity_type: "prospect",
      entity_id: mode === "single" ? targets[0] : null,
      metadata: {
        rule_version: RULE_VERSION,
        mode,
        app_id: body.app_id ?? null,
        processed: results.length,
        succeeded,
        failed,
        routing_counts: routingCounts,
        failures: results
          .filter((r) => !r.ok)
          .map((r) => ({ prospect_id: r.prospect_id, error: r.error })),
        per_prospect: results.map((r) => ({
          prospect_id: r.prospect_id,
          ok: r.ok,
          routing: r.routing,
          opportunity_score: r.summary.opportunity_score,
          opportunity_confidence: r.summary.opportunity_confidence,
          expected_value: r.summary.expected_value,
          expected_value_confidence: r.summary.expected_value_confidence,
          review_worthy: r.summary.review_worthy,
        })),
      },
    });
  } catch (e) {
    console.warn("[pipeline] audit log failed", e);
  }

  return jsonResponse({
    ok: true,
    mode,
    processed: results.length,
    succeeded,
    failed,
    routing_counts: routingCounts,
    results,
    rule_version: RULE_VERSION,
  });
});
