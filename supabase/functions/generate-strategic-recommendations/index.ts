import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const ALLOWED_DECISION_TYPES = new Set([
  "research", "wait", "test", "partner", "reposition", "product", "price",
  "enter", "exit", "advertise", "scale", "other",
]);
const ALLOWED_REVERSIBILITY = new Set(["reversible", "partly_reversible", "hard_to_reverse"]);
const ALLOWED_FOCUS_TYPES = new Set(["app", "objective", "decision", "market_option", "scenario"]);

function asStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function safeAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function callAI(prompt: string) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: [
            "You are ScrollMarketer's strategic recommendation engine.",
            "Return ONLY valid JSON.",
            "Use ONLY the supplied controlled decision context.",
            "Treat verified_observations as facts only when they appear there.",
            "Treat epistemic_context as assumptions or inferences, never as observations.",
            "Approved strategic memories are permitted context, not automatically proven causation; preserve causal_status.",
            "Graph relationships show relationships, not causality.",
            "Unresolved uncertainty must remain visible. If evidence is insufficient, recommend research, waiting, or a reversible test instead of pretending certainty.",
            "Never invent competitor actions, market data, prices, regulation, customer demand, ROI, or source references.",
            "Do not authorize or execute anything. Produce recommendation-only proposed decisions.",
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { checkRateLimit } = await import("../_shared/guard.ts");
    const rateLimited = await checkRateLimit(user.id, "generate-strategic-recommendations", 3, 60);
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => ({}));
    const appId = String(body.app_id ?? "").trim();
    const focusType = String(body.focus_type ?? "app").trim();
    const focusId = String(body.focus_id ?? appId).trim();

    if (!appId) {
      return new Response(JSON.stringify({ error: "app_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_FOCUS_TYPES.has(focusType)) {
      return new Response(JSON.stringify({ error: "Unsupported strategic focus type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: snapshotEnvelope, error: snapshotError } = await supabase.rpc(
      "create_strategic_context_snapshot",
      {
        p_app_id: appId,
        p_purpose: "strategy_recommendation",
        p_focus_type: focusType,
        p_focus_id: focusId,
        p_node_limit: 40,
        p_evidence_limit: 20,
        p_question_limit: 10,
        p_memory_limit: 10,
      },
    );
    if (snapshotError) throw new Error(`Context assembly failed: ${snapshotError.message}`);

    const envelope = snapshotEnvelope as {
      snapshot_id?: string;
      context_fingerprint?: string;
      context?: Record<string, any>;
    } | null;
    const snapshotId = envelope?.snapshot_id;
    const contextFingerprint = envelope?.context_fingerprint;
    const context = envelope?.context;
    if (!snapshotId || !contextFingerprint || !context) {
      throw new Error("Controlled context snapshot was not returned");
    }

    const verifiedObservations = Array.isArray(context.verified_observations) ? context.verified_observations : [];
    const approvedMemories = Array.isArray(context.approved_strategic_memories) ? context.approved_strategic_memories : [];
    const objectives = Array.isArray(context.objectives) ? context.objectives : [];
    const openQuestions = Array.isArray(context.unresolved_uncertainty?.questions)
      ? context.unresolved_uncertainty.questions
      : [];
    const unknownEvidence = Array.isArray(context.unresolved_uncertainty?.unknown_evidence)
      ? context.unresolved_uncertainty.unknown_evidence
      : [];

    const verifiedEvidenceById = new Map(verifiedObservations.map((item: any) => [String(item.id), item]));
    const approvedMemoryById = new Map(approvedMemories.map((item: any) => [String(item.learning_event_id), item]));
    const objectiveById = new Map(objectives.map((item: any) => [String(item.id), item]));
    const questionById = new Map(openQuestions.map((item: any) => [String(item.id), item]));
    const unknownById = new Map(unknownEvidence.map((item: any) => [String(item.id), item]));

    const prompt = `Create 2-4 strategic recommendations from this controlled context.

CONTROLLED DECISION CONTEXT
${JSON.stringify(context, null, 2)}

Return exactly:
{
  "recommendations": [{
    "objective_id": "existing objective id from context or null",
    "decision_type": "research|wait|test|partner|reposition|product|price|enter|exit|advertise|scale|other",
    "title": "short decision title",
    "recommendation": "specific recommended next move",
    "rationale": "why this follows from the supplied context",
    "confidence": 0-100,
    "reversibility": "reversible|partly_reversible|hard_to_reverse",
    "commitment_amount": null,
    "currency": "EUR",
    "evidence_refs": ["validated observation ids actually used"],
    "memory_refs": ["approved strategic learning ids actually used"],
    "question_refs": ["open strategic question ids relevant to the decision"],
    "unknown_refs": ["unknown evidence ids relevant to the decision"],
    "assumptions": ["assumptions that remain assumptions"],
    "next_information_needed": "single highest-value next question or null",
    "success_conditions": ["observable success condition"],
    "kill_conditions": ["observable stop/kill condition"]
  }]
}

Rules:
- Cite only IDs that exist in the corresponding context arrays.
- Do not turn graph relationships, assumptions, inferences, or memories into observed facts.
- Do not claim a strategic memory proves causation; preserve its causal_status qualification.
- When validated observations are sparse, prefer reversible research/test/wait decisions.
- A hard-to-reverse recommendation must clearly justify why a reversible test is insufficient.
- If the context contains unresolved high-value questions, surface them in question_refs/next_information_needed.
- Do not produce duplicate recommendations.
- Recommendation is not approval and not execution.`;

    const ai = await callAI(prompt);
    const candidates = Array.isArray(ai.recommendations) ? ai.recommendations.slice(0, 4) : [];
    if (!candidates.length) throw new Error("AI returned no strategic recommendations");

    const rows = candidates
      .map((candidate: any) => {
        const title = String(candidate.title ?? "").trim();
        const recommendation = String(candidate.recommendation ?? "").trim();
        if (!title || !recommendation) return null;

        const decisionType = ALLOWED_DECISION_TYPES.has(String(candidate.decision_type))
          ? String(candidate.decision_type)
          : "research";
        const reversibility = ALLOWED_REVERSIBILITY.has(String(candidate.reversibility))
          ? String(candidate.reversibility)
          : "reversible";

        const evidenceRefs = asStringArray(candidate.evidence_refs, 12)
          .filter((id) => verifiedEvidenceById.has(id));
        const memoryRefs = asStringArray(candidate.memory_refs, 10)
          .filter((id) => approvedMemoryById.has(id));
        const questionRefs = asStringArray(candidate.question_refs, 10)
          .filter((id) => questionById.has(id));
        const unknownRefs = asStringArray(candidate.unknown_refs, 10)
          .filter((id) => unknownById.has(id));

        const citedMemories = memoryRefs.map((id) => approvedMemoryById.get(id));
        const hasSupportedMemory = citedMemories.some((item: any) => item?.causal_status === "supported");

        let confidence = clampConfidence(candidate.confidence);
        if (evidenceRefs.length === 0 && memoryRefs.length === 0) confidence = Math.min(confidence, 60);
        if (evidenceRefs.length < 2 && !hasSupportedMemory) confidence = Math.min(confidence, 80);

        const objectiveId = objectiveById.has(String(candidate.objective_id ?? ""))
          ? String(candidate.objective_id)
          : null;

        const referencedUnknowns = [
          ...questionRefs.map((id) => String(questionById.get(id)?.question ?? "").trim()),
          ...unknownRefs.map((id) => String(unknownById.get(id)?.claim ?? "").trim()),
        ].filter(Boolean);

        const nextInformationRaw = candidate.next_information_needed;
        const nextInformation = nextInformationRaw === null || nextInformationRaw === undefined
          ? null
          : String(nextInformationRaw).trim() || null;

        return {
          user_id: user.id,
          app_id: appId,
          goal_id: objectiveId,
          decision_type: decisionType,
          title,
          recommendation,
          rationale: String(candidate.rationale ?? "").trim() || null,
          evidence: { verified_observation_ids: evidenceRefs },
          assumptions: asStringArray(candidate.assumptions, 10),
          unknowns: referencedUnknowns.slice(0, 12),
          sensitivities: {},
          confidence,
          expected_upside: null,
          expected_downside: null,
          reversibility,
          commitment_amount: safeAmount(candidate.commitment_amount),
          currency: /^[A-Z]{3}$/.test(String(candidate.currency ?? "EUR").toUpperCase())
            ? String(candidate.currency ?? "EUR").toUpperCase()
            : "EUR",
          authority_level: reversibility === "hard_to_reverse" ? "executive_approval" : "recommend",
          status: "proposed",
          execution_mode: "manual",
          next_information_needed: nextInformation,
          success_conditions: asStringArray(candidate.success_conditions, 8),
          kill_conditions: asStringArray(candidate.kill_conditions, 8),
          context_snapshot_id: snapshotId,
        };
      })
      .filter(Boolean);

    if (!rows.length) throw new Error("No valid strategic recommendation rows were produced");

    const { data: decisions, error: insertError } = await supabase
      .from("strategic_decisions")
      .insert(rows)
      .select("*");
    if (insertError) throw insertError;

    return new Response(JSON.stringify({
      success: true,
      recommendation_only: true,
      snapshot_id: snapshotId,
      context_fingerprint: contextFingerprint,
      decisions: decisions ?? [],
      provenance: {
        validated_observation_count: verifiedObservations.length,
        approved_memory_count: approvedMemories.length,
        open_question_count: openQuestions.length,
        unknown_evidence_count: unknownEvidence.length,
        warnings: Array.isArray(context.warnings) ? context.warnings : [],
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("generate-strategic-recommendations error", error);
    return new Response(JSON.stringify({ error: error?.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
