// Qualify a prospect: scores ICP fit, buying signal, urgency, reachability,
// computes weighted opportunity score + segment, writes back to prospects row,
// and logs to automation_audit_log. NO sending, NO review queue (yet).
import {
  corsHeaders,
  handlePreflight,
  requireUser,
  adminClient,
  checkRateLimit,
  errorResponse,
  jsonResponse,
  safeJson,
} from "../_shared/guard.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const RULE_VERSION = "qualify-v1";

const CAP_STR = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : null);
const CAP_ARR = <T>(a: unknown, n: number): T[] =>
  Array.isArray(a) ? (a.slice(0, n) as T[]) : [];
const CLAMP = (n: unknown, lo = 0, hi = 100) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
};

function segmentFor(opp: number): "hot" | "warm" | "nurture" | "disqualify" {
  if (opp >= 90) return "hot";
  if (opp >= 75) return "warm";
  if (opp >= 50) return "nurture";
  return "disqualify";
}

function weightedOpportunity(icp: number, buying: number, urg: number, reach: number) {
  return Math.round(0.4 * icp + 0.25 * buying + 0.2 * urg + 0.15 * reach);
}

interface QualJson {
  icp_fit_score?: number;
  icp_fit_reasoning?: string;
  icp_fit_evidence?: string[];
  icp_fit_confidence?: number;
  buying_signal_score?: number;
  buying_signal_reasoning?: string;
  buying_signal_evidence?: string[];
  buying_signal_confidence?: number;
  urgency_score?: number;
  urgency_reasoning?: string;
  urgency_evidence?: string[];
  urgency_confidence?: number;
  reachability_score?: number;
  reachability_reasoning?: string;
  reachability_evidence?: string[];
  reachability_confidence?: number;
  segment_reason?: string;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const rl = await checkRateLimit(auth.id, "qualify-prospect", 30, 60);
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

  // Load context in parallel
  const appId = prospect.app_id ?? null;
  const [appRes, icpsRes, personasRes, audienceRes, anglesRes, insightsRes, conversionsRes] =
    await Promise.all([
      appId
        ? admin.from("apps").select("*").eq("id", appId).maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
      admin.from("icps").select("*").eq("user_id", auth.id).eq(appId ? "app_id" : "user_id", appId ?? auth.id),
      admin.from("personas").select("*").eq("user_id", auth.id).limit(10),
      admin.from("audience_profiles").select("*").eq("user_id", auth.id).limit(3),
      admin.from("messaging_angles").select("*").eq("user_id", auth.id).limit(10),
      admin.from("learning_insights").select("*").eq("user_id", auth.id).limit(10),
      admin.from("conversions").select("amount,source_content_id,created_at").eq("user_id", auth.id).limit(20),
    ]);

  const enrichmentConfidence = Number(prospect.enrichment_confidence ?? 0);
  const isEnriched = !!prospect.enriched_at && enrichmentConfidence >= 40;

  const system = `You are a senior B2B sales analyst. Score a prospect along four dimensions
on a 0-100 scale, with short reasoning and concrete evidence pulled from the provided context.
RULES:
- Use null/0 when you have no evidence. Do NOT fabricate.
- Each *_evidence must be 2-5 short bullet strings citing facts from the context.
- Each *_confidence is 0-100 reflecting how strong the evidence is.
- If a dimension has no evidence, its confidence MUST be <= 30.
- icp_fit_score: how well company matches the offering's ICP (size, industry, geography, persona).
- buying_signal_score: hiring, funding, product launches, public pain, recent news.
- urgency_score: time-bound triggers (funding just closed, churn risk, public RFP).
- reachability_score: presence of verified contact channels and decision-maker access.
- segment_reason: one sentence explaining final tier.
Return JSON only.`;

  const ctx = {
    offering: appRes.data
      ? {
          name: appRes.data.name,
          description: appRes.data.description,
          target_audience: appRes.data.target_audience,
          value_props: appRes.data.value_props,
        }
      : null,
    icps: (icpsRes.data ?? []).slice(0, 10).map((i: any) => ({
      segment: i.segment,
      company_size: i.company_size,
      industry: i.industry,
      geography: i.geography,
      pain_points: i.pain_points,
      buying_triggers: i.buying_triggers,
    })),
    personas: (personasRes.data ?? []).slice(0, 5).map((p: any) => ({
      role: p.role,
      seniority: p.seniority,
      pains: p.pains,
      goals: p.goals,
    })),
    audience: (audienceRes.data ?? []).slice(0, 2),
    messaging_angles: (anglesRes.data ?? []).slice(0, 5).map((a: any) => ({
      angle: a.angle,
      hook: a.hook,
    })),
    learning_insights: (insightsRes.data ?? []).slice(0, 5).map((l: any) => ({
      title: l.title,
      summary: l.summary,
    })),
    prior_conversions_count: (conversionsRes.data ?? []).length,
    prospect: {
      name: prospect.name,
      description: prospect.description,
      url: prospect.url,
      company_name: prospect.company_name,
      industry: prospect.industry,
      employee_count: prospect.employee_count,
      revenue_band: prospect.revenue_band,
      location: prospect.location,
      linkedin_url: prospect.linkedin_url,
      contact_email: prospect.contact_email,
      email_confidence: prospect.email_confidence,
      technology_stack: prospect.technology_stack,
      recent_news: prospect.recent_news,
      hiring_signals: prospect.hiring_signals,
      funding_signals: prospect.funding_signals,
      decision_makers: prospect.decision_makers,
      enrichment_confidence: prospect.enrichment_confidence,
      enriched_at: prospect.enriched_at,
      matched_icp_id: prospect.matched_icp_id,
      matched_persona_id: prospect.matched_persona_id,
    },
  };

  let ai: QualJson | null = null;
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

  if (!ai) return errorResponse("AI returned no qualification", 502);

  // Clamp + cap arrays
  const icp = CLAMP(ai.icp_fit_score);
  const buying = CLAMP(ai.buying_signal_score);
  const urg = CLAMP(ai.urgency_score);
  const reach = CLAMP(ai.reachability_score);
  const opp = weightedOpportunity(icp, buying, urg, reach);

  let icpConf = CLAMP(ai.icp_fit_confidence);
  let buyingConf = CLAMP(ai.buying_signal_confidence);
  let urgConf = CLAMP(ai.urgency_confidence);
  let reachConf = CLAMP(ai.reachability_confidence);

  const icpEv = CAP_ARR<string>(ai.icp_fit_evidence, 5);
  const buyingEv = CAP_ARR<string>(ai.buying_signal_evidence, 5);
  const urgEv = CAP_ARR<string>(ai.urgency_evidence, 5);
  const reachEv = CAP_ARR<string>(ai.reachability_evidence, 5);

  // Confidence guard: if evidence array is empty, cap that dimension's confidence.
  if (icpEv.length === 0) icpConf = Math.min(icpConf, 30);
  if (buyingEv.length === 0) buyingConf = Math.min(buyingConf, 30);
  if (urgEv.length === 0) urgConf = Math.min(urgConf, 30);
  if (reachEv.length === 0) reachConf = Math.min(reachConf, 30);

  // Composite opportunity confidence = weighted avg of dimension confidences
  let oppConf = Math.round(0.4 * icpConf + 0.25 * buyingConf + 0.2 * urgConf + 0.15 * reachConf);

  // Cap by enrichment confidence and overall evidence volume.
  if (!isEnriched) oppConf = Math.min(oppConf, 50);
  oppConf = Math.min(oppConf, Math.max(20, enrichmentConfidence + 10));
  const totalEvidence = icpEv.length + buyingEv.length + urgEv.length + reachEv.length;
  if (totalEvidence < 3) oppConf = Math.min(oppConf, 40);
  if (totalEvidence === 0) oppConf = Math.min(oppConf, 15);

  const segment = segmentFor(opp);

  const updates: Record<string, unknown> = {
    // Map icp_fit_score -> existing fit_score column (no icp_fit_score column exists)
    fit_score: icp,
    icp_fit_reasoning: CAP_STR(ai.icp_fit_reasoning, 1000),
    icp_fit_evidence: icpEv,
    icp_fit_confidence: icpConf,
    buying_signal_score: buying,
    buying_signal_reasoning: CAP_STR(ai.buying_signal_reasoning, 1000),
    buying_signal_evidence: buyingEv,
    buying_signal_confidence: buyingConf,
    urgency_score: urg,
    urgency_reasoning: CAP_STR(ai.urgency_reasoning, 1000),
    urgency_evidence: urgEv,
    urgency_confidence: urgConf,
    reachability_score: reach,
    reachability_reasoning: CAP_STR(ai.reachability_reasoning, 1000),
    reachability_evidence: reachEv,
    reachability_confidence: reachConf,
    opportunity_score: opp,
    opportunity_confidence: oppConf,
    segment,
    segment_reason: CAP_STR(ai.segment_reason, 400) ??
      `${segment} (opportunity ${opp}, confidence ${oppConf})`,
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
      action_type: "prospect_qualified",
      entity_type: "prospect",
      entity_id: prospect_id,
      metadata: {
        rule_version: RULE_VERSION,
        scores: { icp_fit: icp, buying_signal: buying, urgency: urg, reachability: reach, opportunity: opp },
        confidence: {
          icp_fit: icpConf, buying_signal: buyingConf, urgency: urgConf,
          reachability: reachConf, opportunity: oppConf,
        },
        segment,
        evidence_summary: {
          icp_fit: icpEv, buying_signal: buyingEv, urgency: urgEv, reachability: reachEv,
        },
        enriched: isEnriched,
        enrichment_confidence: enrichmentConfidence,
      },
    });
  } catch (e) {
    console.warn("[qualify] audit log failed", e);
  }

  return jsonResponse({
    ok: true,
    prospect: updated,
    opportunity_score: opp,
    opportunity_confidence: oppConf,
    segment,
    rule_version: RULE_VERSION,
  });
});
