// Estimate prospect expected value. Computes deal_probability, estimated_value,
// expected_value (adjusted), confidence, and reasoning. NO autopilot, NO review queue.
import {
  handlePreflight,
  requireUser,
  adminClient,
  checkRateLimit,
  errorResponse,
  jsonResponse,
  safeJson,
} from "../_shared/guard.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const RULE_VERSION = "expected-value-v1";

const CAP_STR = (s: unknown, n: number) =>
  typeof s === "string" ? s.slice(0, n) : null;
const CAP_ARR = <T>(a: unknown, n: number): T[] =>
  Array.isArray(a) ? (a.slice(0, n) as T[]) : [];
const CLAMP_INT = (n: unknown, lo = 0, hi = 100) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
};
const CLAMP_PROB = (n: unknown) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
};
const CLAMP_MONEY = (n: unknown) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  // hard cap to a sane upper bound to avoid runaway AI numbers
  return Math.min(v, 100_000_000);
};
const ALLOWED_CCY = new Set([
  "EUR", "USD", "GBP", "CAD", "AUD", "CHF", "JPY", "SEK", "NOK", "DKK", "PLN", "INR", "BRL",
]);

interface AiJson {
  deal_probability?: number;
  estimated_value?: number;
  expected_value?: number;
  expected_value_confidence?: number;
  value_currency?: string;
  value_reasoning?: string;
  assumptions?: string[];
  risk_factors?: string[];
  upside_factors?: string[];
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const rl = await checkRateLimit(auth.id, "estimate-prospect-value", 30, 60);
  if (rl) return rl;

  const body = await safeJson<{ prospect_id?: string }>(req);
  const prospect_id = body.prospect_id;
  if (!prospect_id || typeof prospect_id !== "string") {
    return errorResponse("prospect_id is required", 400);
  }
  if (!LOVABLE_API_KEY) {
    return errorResponse("AI gateway not configured", 503);
  }

  const admin = adminClient();
  const { data: prospect, error: pErr } = await admin
    .from("prospects")
    .select("*")
    .eq("id", prospect_id)
    .eq("user_id", auth.id)
    .maybeSingle();
  if (pErr) return errorResponse(`fetch failed: ${pErr.message}`, 500);
  if (!prospect) return errorResponse("Prospect not found", 404);

  const appId = prospect.app_id ?? null;
  const [appRes, settingsRes, conversionsRes, priorWonRes] = await Promise.all([
    appId
      ? admin.from("apps").select("*").eq("id", appId).maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    admin.from("user_settings").select("*").eq("user_id", auth.id).maybeSingle(),
    admin
      .from("conversions")
      .select("amount,created_at,source_content_id")
      .eq("user_id", auth.id)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("prospects")
      .select("actual_value,outcome,expected_value,estimated_value")
      .eq("user_id", auth.id)
      .eq("outcome", "won")
      .not("actual_value", "is", null)
      .limit(50),
  ]);

  // Historical stats from prior conversions + won prospects.
  const convAmounts = (conversionsRes.data ?? [])
    .map((c: any) => Number(c.amount))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  const wonAmounts = (priorWonRes.data ?? [])
    .map((p: any) => Number(p.actual_value))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  const historyPool = [...convAmounts, ...wonAmounts];
  const historyCount = historyPool.length;
  const historyAvg =
    historyCount > 0 ? historyPool.reduce((a, b) => a + b, 0) / historyCount : null;
  const historyMax = historyCount > 0 ? Math.max(...historyPool) : null;

  const opportunityScore = Number(prospect.opportunity_score ?? 0);
  const opportunityConfidence = Number(prospect.opportunity_confidence ?? 0);
  const segment = prospect.segment ?? null;
  const enrichmentConfidence = Number(prospect.enrichment_confidence ?? 0);
  const isQualified = opportunityScore > 0 && opportunityConfidence > 0;

  const defaultCurrency =
    (settingsRes.data as any)?.currency ||
    prospect.value_currency ||
    "EUR";

  const system = `You are a B2B revenue analyst. Estimate the expected value of a single prospect deal.
RULES:
- Be conservative. Never invent numbers. If unsure, use lower bounds and explain in reasoning.
- deal_probability is 0.0-1.0 (chance of closing if we engage). Tie it to opportunity_score and confidence.
- estimated_value is the typical contract/deal size in the offering's currency. Anchor on historical_avg / historical_max when present. If no history, use a conservative industry default and STATE the assumption.
- expected_value = deal_probability * estimated_value, but you MAY adjust DOWN (never up) when evidence is weak or risk factors dominate.
- expected_value_confidence (0-100) reflects how trustworthy the expected_value is given evidence + history.
- assumptions: 2-5 short strings. risk_factors and upside_factors: 0-5 short strings each.
- value_reasoning: 1-3 sentences. If estimated_value is much higher than history, explicitly flag "review-worthy".
Return JSON only.`;

  const ctx = {
    offering: appRes.data
      ? {
          name: appRes.data.name,
          description: appRes.data.description,
          target_audience: appRes.data.target_audience,
          value_props: appRes.data.value_props,
          pricing: (appRes.data as any).pricing ?? null,
          monetization: (appRes.data as any).monetization ?? null,
        }
      : null,
    goal_type: (settingsRes.data as any)?.primary_goal ?? null,
    default_currency: defaultCurrency,
    history: {
      conversions_count: convAmounts.length,
      won_prospects_count: wonAmounts.length,
      avg_value: historyAvg,
      max_value: historyMax,
      sample_values: historyPool.slice(0, 10),
    },
    qualification: {
      opportunity_score: opportunityScore,
      opportunity_confidence: opportunityConfidence,
      segment,
      fit_score: prospect.fit_score,
      buying_signal_score: prospect.buying_signal_score,
      urgency_score: prospect.urgency_score,
      reachability_score: prospect.reachability_score,
    },
    prospect: {
      name: prospect.name,
      company_name: prospect.company_name,
      industry: prospect.industry,
      employee_count: prospect.employee_count,
      revenue_band: prospect.revenue_band,
      location: prospect.location,
      enrichment_confidence: enrichmentConfidence,
      recent_news: prospect.recent_news,
      hiring_signals: prospect.hiring_signals,
      funding_signals: prospect.funding_signals,
      technology_stack: prospect.technology_stack,
      revenue_attributed: (prospect as any).revenue_attributed ?? null,
    },
  };

  let ai: AiJson | null = null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(ctx) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (r.status === 429) return errorResponse("AI rate-limited, retry shortly", 429);
    if (r.status === 402) return errorResponse("AI credits exhausted", 402);
    const d = await r.json();
    if (!r.ok) return errorResponse(`AI failed: ${d?.error?.message ?? r.status}`, 502);
    const content = d.choices?.[0]?.message?.content;
    ai = content ? JSON.parse(content) : null;
  } catch (e) {
    return errorResponse(`AI error: ${(e as Error).message}`, 502);
  }
  if (!ai) return errorResponse("AI returned no estimate", 502);

  const deal_probability = CLAMP_PROB(ai.deal_probability);
  const estimated_value = CLAMP_MONEY(ai.estimated_value);
  const baselineEV = Math.round(deal_probability * estimated_value * 100) / 100;

  // AI-adjusted EV — clamp to [0, baseline]. Never inflate above baseline.
  let adjustedEV =
    ai.expected_value === undefined || ai.expected_value === null
      ? baselineEV
      : CLAMP_MONEY(ai.expected_value);
  if (adjustedEV > baselineEV) adjustedEV = baselineEV;
  adjustedEV = Math.round(adjustedEV * 100) / 100;

  let evConfidence = CLAMP_INT(ai.expected_value_confidence);

  // Guardrails on confidence.
  const assumptions = CAP_ARR<string>(ai.assumptions, 5).map((s) =>
    String(s).slice(0, 240),
  );
  const risk_factors = CAP_ARR<string>(ai.risk_factors, 5).map((s) =>
    String(s).slice(0, 240),
  );
  const upside_factors = CAP_ARR<string>(ai.upside_factors, 5).map((s) =>
    String(s).slice(0, 240),
  );

  if (!isQualified) evConfidence = Math.min(evConfidence, 40);
  if (opportunityConfidence > 0 && opportunityConfidence < 50) {
    evConfidence = Math.min(evConfidence, 50);
  }
  // Weak evidence => cap at 40.
  const weakEvidence =
    historyCount === 0 ||
    enrichmentConfidence < 40 ||
    assumptions.length === 0;
  if (weakEvidence) evConfidence = Math.min(evConfidence, 40);
  // No history at all => extra-conservative.
  if (historyCount === 0) evConfidence = Math.min(evConfidence, 35);

  // Flag review-worthy if estimated_value far exceeds history.
  let reviewWorthy = false;
  if (historyMax !== null && estimated_value > historyMax * 3 && historyCount >= 3) {
    reviewWorthy = true;
  }
  if (historyAvg !== null && estimated_value > historyAvg * 5 && historyCount >= 3) {
    reviewWorthy = true;
  }

  let value_reasoning = CAP_STR(ai.value_reasoning, 1200) ??
    `Baseline ${baselineEV} = ${deal_probability} × ${estimated_value}.`;
  if (reviewWorthy && !/review/i.test(value_reasoning)) {
    value_reasoning = `[review-worthy: estimate exceeds historical norms] ${value_reasoning}`.slice(
      0,
      1200,
    );
  }
  if (historyCount === 0 && !/assumption/i.test(value_reasoning)) {
    value_reasoning = `[no prior revenue history — conservative defaults] ${value_reasoning}`.slice(
      0,
      1200,
    );
  }

  const ccyRaw = (ai.value_currency || defaultCurrency || "EUR").toUpperCase();
  const value_currency = ALLOWED_CCY.has(ccyRaw) ? ccyRaw : defaultCurrency;

  // Never overwrite actual_value/outcome — we only update value-estimation fields.
  const updates: Record<string, unknown> = {
    deal_probability,
    estimated_value,
    expected_value: adjustedEV,
    expected_value_confidence: evConfidence,
    value_currency,
    value_reasoning,
  };

  const { data: updated, error: uErr } = await admin
    .from("prospects")
    .update(updates)
    .eq("id", prospect_id)
    .eq("user_id", auth.id)
    .select()
    .maybeSingle();
  if (uErr) return errorResponse(`update failed: ${uErr.message}`, 500);

  try {
    await admin.from("automation_audit_log").insert({
      user_id: auth.id,
      action_type: "prospect_value_estimated",
      entity_type: "prospect",
      entity_id: prospect_id,
      metadata: {
        rule_version: RULE_VERSION,
        baseline_expected_value: baselineEV,
        adjusted_expected_value: adjustedEV,
        deal_probability,
        estimated_value,
        value_currency,
        expected_value_confidence: evConfidence,
        assumptions,
        risk_factors,
        upside_factors,
        review_worthy: reviewWorthy,
        history: {
          count: historyCount,
          avg: historyAvg,
          max: historyMax,
        },
        qualification: {
          opportunity_score: opportunityScore,
          opportunity_confidence: opportunityConfidence,
          segment,
        },
      },
    });
  } catch (e) {
    console.warn("[estimate-value] audit log failed", e);
  }

  return jsonResponse({
    ok: true,
    prospect: updated,
    deal_probability,
    estimated_value,
    baseline_expected_value: baselineEV,
    expected_value: adjustedEV,
    expected_value_confidence: evConfidence,
    value_currency,
    value_reasoning,
    assumptions,
    risk_factors,
    upside_factors,
    review_worthy: reviewWorthy,
    rule_version: RULE_VERSION,
  });
});
