import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const ALLOWED_RECOMMENDATIONS = new Set(["test", "research", "wait", "deprioritize"]);

function asStringArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean).slice(0, max);
}

function clamp(value: unknown, fallback = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function callAI(prompt: string) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: [
            "You are ScrollMarketer's market-ranking interpretation engine.",
            "Return ONLY valid JSON.",
            "The deterministic rank supplied by the system is authoritative and MUST NOT be changed.",
            "A market with rank_state=insufficient_evidence is not numerically ranked.",
            "Use only the supplied controlled context. Never invent demand, competition, regulation, pricing, customer behavior, or source references.",
            "Validated observations are facts; assumptions/inferences are not facts; reviewed memory is permitted context but not automatically causal truth.",
            "Recommend research/wait/reversible testing when evidence is weak.",
            "This is recommendation-only. Never authorize market entry, spending, pricing changes, partnerships, or execution.",
          ].join(" "),
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, serviceKey, { global: { headers: { Authorization: authorization } } });
    const adminClient = createClient(url, serviceKey);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { checkRateLimit } = await import("../_shared/guard.ts");
    const rateLimited = await checkRateLimit(user.id, "rank-strategic-markets", 3, 60);
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => ({}));
    const appId = String(body.app_id ?? "").trim();
    const objectiveId = body.objective_id ? String(body.objective_id).trim() : null;
    if (!appId) return new Response(JSON.stringify({ error: "app_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: envelopeRaw, error: contextError } = await userClient.rpc("create_market_ranking_context_snapshot", {
      p_app_id: appId,
      p_objective_id: objectiveId,
    });
    if (contextError) throw new Error(`Market ranking context failed: ${contextError.message}`);

    const envelope = envelopeRaw as { snapshot_id?: string; context_fingerprint?: string; context?: Record<string, any> } | null;
    const snapshotId = envelope?.snapshot_id;
    const context = envelope?.context;
    if (!snapshotId || !context) throw new Error("Market-ranking context snapshot was not returned");

    const basis = Array.isArray(context.phase9?.market_ranking_basis) ? context.phase9.market_ranking_basis : [];
    if (!basis.length) throw new Error("No market options exist for the selected scope");

    const evidence = Array.isArray(context.verified_observations) ? context.verified_observations : [];
    const memories = Array.isArray(context.approved_strategic_memories) ? context.approved_strategic_memories : [];
    const questions = Array.isArray(context.unresolved_uncertainty?.questions) ? context.unresolved_uncertainty.questions : [];
    const unknowns = Array.isArray(context.unresolved_uncertainty?.unknown_evidence) ? context.unresolved_uncertainty.unknown_evidence : [];

    const marketById = new Map(basis.map((x: any) => [String(x.market_option_id), x]));
    const evidenceIds = new Set(evidence.map((x: any) => String(x.id)));
    const memoryIds = new Set(memories.map((x: any) => String(x.learning_event_id)));
    const questionIds = new Set(questions.map((x: any) => String(x.id)));
    const unknownIds = new Set(unknowns.map((x: any) => String(x.id)));

    const prompt = `Interpret this deterministic market ranking. Do not change rank positions or system scores.\n\nCONTROLLED MARKET-RANKING CONTEXT\n${JSON.stringify(context, null, 2)}\n\nReturn exactly:\n{\n  "summary":"brief portfolio-level interpretation",\n  "markets":[{\n    "market_option_id":"existing id",\n    "recommendation":"test|research|wait|deprioritize",\n    "rationale":"why, preserving unknowns",\n    "confidence":0-100,\n    "evidence_refs":["validated observation ids actually used"],\n    "memory_refs":["approved learning ids actually used"],\n    "question_refs":["open question ids"],\n    "unknown_refs":["unknown evidence ids"],\n    "next_information_needed":"single next question or null"\n  }]\n}\nRules:\n- Include every market option exactly once.\n- Never supply or alter a rank number.\n- rank_state=insufficient_evidence should normally lead to research/wait, not confident market entry advice.\n- entered/rejected options are excluded from active ranking; do not recommend testing them as if they were new candidates.\n- Cite only IDs present in the corresponding controlled-context arrays.\n- Do not equate decision_readiness_score with ROI or probability of success.\n- Recommendations remain non-executable.`;

    const ai = await callAI(prompt);
    const rawItems = Array.isArray(ai.markets) ? ai.markets : [];
    const aiByMarket = new Map<string, any>();
    for (const item of rawItems) {
      const id = String(item?.market_option_id ?? "").trim();
      if (marketById.has(id) && !aiByMarket.has(id)) aiByMarket.set(id, item);
    }

    const annotations = basis.map((market: any) => {
      const id = String(market.market_option_id);
      const item = aiByMarket.get(id) ?? {};
      const evidenceRefs = asStringArray(item.evidence_refs).filter((x) => evidenceIds.has(x));
      const memoryRefs = asStringArray(item.memory_refs).filter((x) => memoryIds.has(x));
      const questionRefs = asStringArray(item.question_refs).filter((x) => questionIds.has(x));
      const unknownRefs = asStringArray(item.unknown_refs).filter((x) => unknownIds.has(x));

      let recommendation = ALLOWED_RECOMMENDATIONS.has(String(item.recommendation)) ? String(item.recommendation) : null;
      if (market.rank_state === "insufficient_evidence" && recommendation === "test" && Number(market.evidence_coverage ?? 0) < 40) recommendation = "research";
      if (market.rank_state === "excluded") recommendation = "deprioritize";

      let confidence = clamp(item.confidence);
      if (market.rank_state === "insufficient_evidence") confidence = Math.min(confidence, 60);
      if (Number(market.evidence_coverage ?? 0) < 70 || Number(market.evidence_confidence ?? 0) < 70) confidence = Math.min(confidence, 80);
      if (evidenceRefs.length === 0 && memoryRefs.length === 0) confidence = Math.min(confidence, 60);

      return {
        market_option_id: id,
        recommendation,
        rationale: String(item.rationale ?? "").trim() || null,
        confidence,
        evidence_refs: evidenceRefs,
        memory_refs: memoryRefs,
        question_refs: questionRefs,
        unknown_refs: unknownRefs,
        next_information_needed: item.next_information_needed == null ? null : String(item.next_information_needed).trim() || null,
      };
    });

    const { data: runId, error: recordError } = await adminClient.rpc("record_strategic_market_ranking_run", {
      p_user_id: user.id,
      p_app_id: appId,
      p_objective_id: objectiveId,
      p_snapshot_id: snapshotId,
      p_summary: String(ai.summary ?? "").trim() || null,
      p_annotations: annotations,
    });
    if (recordError) throw new Error(`Could not record market ranking: ${recordError.message}`);

    const top = basis.find((x: any) => x.rank_state === "ranked" && Number(x.deterministic_rank) === 1) ?? null;
    return new Response(JSON.stringify({
      success: true,
      recommendation_only: true,
      run_id: runId,
      snapshot_id: snapshotId,
      context_fingerprint: envelope?.context_fingerprint,
      deterministic_top_market: top,
      annotations,
      summary: String(ai.summary ?? "").trim() || null,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("rank-strategic-markets error", error);
    return new Response(JSON.stringify({ error: error?.message ?? "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
