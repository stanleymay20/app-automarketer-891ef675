import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const ALLOWED_RECOMMENDATIONS = new Set(["holds", "changes", "needs_more_evidence"]);

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
            "You are ScrollMarketer's scenario-planning assessment engine.",
            "Return ONLY valid JSON.",
            "Use only the supplied controlled context and scenario branches/sensitivities.",
            "Unknown likelihood stays unknown. A manual-assumption percentage is an assumption, not an observed probability.",
            "Observed-frequency likelihood is descriptive history, and if its linked evidence is not validated it must be treated as unverified.",
            "Stress scores are prioritisation proxies, not expected loss.",
            "Do not invent competitor responses or future probabilities.",
            "This is recommendation-only. Never modify the scenario, approve a decision, or execute a response.",
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
    const rateLimited = await checkRateLimit(user.id, "assess-strategic-scenario", 3, 60);
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => ({}));
    const appId = String(body.app_id ?? "").trim();
    const scenarioId = String(body.scenario_id ?? "").trim();
    if (!appId || !scenarioId) return new Response(JSON.stringify({ error: "app_id and scenario_id are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: envelopeRaw, error: contextError } = await userClient.rpc("create_scenario_planning_context_snapshot", {
      p_app_id: appId,
      p_scenario_id: scenarioId,
    });
    if (contextError) throw new Error(`Scenario planning context failed: ${contextError.message}`);

    const envelope = envelopeRaw as { snapshot_id?: string; context_fingerprint?: string; context?: Record<string, any> } | null;
    const snapshotId = envelope?.snapshot_id;
    const context = envelope?.context;
    if (!snapshotId || !context) throw new Error("Scenario-planning context snapshot was not returned");

    const phase9 = context.phase9 ?? {};
    const branches = Array.isArray(phase9.branches) ? phase9.branches : [];
    const summary = phase9.deterministic_summary ?? {};
    const evidence = Array.isArray(context.verified_observations) ? context.verified_observations : [];
    const memories = Array.isArray(context.approved_strategic_memories) ? context.approved_strategic_memories : [];
    const questions = Array.isArray(context.unresolved_uncertainty?.questions) ? context.unresolved_uncertainty.questions : [];
    const unknowns = Array.isArray(context.unresolved_uncertainty?.unknown_evidence) ? context.unresolved_uncertainty.unknown_evidence : [];

    const branchIds = new Set(branches.map((x: any) => String(x.id)));
    const evidenceIds = new Set(evidence.map((x: any) => String(x.id)));
    const memoryIds = new Set(memories.map((x: any) => String(x.learning_event_id)));
    const questionIds = new Set(questions.map((x: any) => String(x.id)));
    const unknownIds = new Set(unknowns.map((x: any) => String(x.id)));

    const prompt = `Assess whether the strategic decision/base move remains robust under this explicit scenario.\n\nCONTROLLED SCENARIO-PLANNING CONTEXT\n${JSON.stringify(context, null, 2)}\n\nReturn exactly:\n{\n  "recommendation":"holds|changes|needs_more_evidence",\n  "confidence":0-100,\n  "rationale":"brief explanation that preserves uncertainty",\n  "branch_refs":["scenario branch ids actually relied on"],\n  "evidence_refs":["validated observation ids actually relied on"],\n  "memory_refs":["approved strategic learning ids actually relied on"],\n  "question_refs":["open question ids"],\n  "unknown_refs":["unknown evidence ids"],\n  "next_information_needed":"single next question or null"\n}\nRules:\n- Cite only IDs present in the controlled context.\n- Do not infer probabilities for branches whose likelihood is unknown.\n- Manual likelihood is an explicit assumption.\n- Unverified observed-frequency evidence cannot be treated as verified history.\n- If branches are absent or most decision effects remain unknown, choose needs_more_evidence.\n- Sensitivity cases are explicit stored assumptions/results; do not invent missing values.\n- Recommendation is not a mutation of scenario.conclusion and is not execution.`;

    const ai = await callAI(prompt);
    let recommendation = ALLOWED_RECOMMENDATIONS.has(String(ai.recommendation)) ? String(ai.recommendation) : "needs_more_evidence";
    let confidence = clamp(ai.confidence);

    const branchCount = Number(summary.branch_count ?? 0);
    const assessedCount = Number(summary.assessed_branch_count ?? 0);
    const unknownEffects = Number(summary.unknown_effect_count ?? 0);
    const unknownLikelihoods = Number(summary.unknown_likelihood_count ?? 0);
    if (branchCount === 0 || assessedCount === 0) {
      recommendation = "needs_more_evidence";
      confidence = Math.min(confidence, 50);
    } else {
      const assessedCoverage = assessedCount / Math.max(1, branchCount);
      if (assessedCoverage < 0.5) confidence = Math.min(confidence, 60);
      if (unknownEffects > branchCount / 2 || unknownLikelihoods === branchCount) confidence = Math.min(confidence, 70);
    }

    const branchRefs = asStringArray(ai.branch_refs).filter((x) => branchIds.has(x));
    const evidenceRefs = asStringArray(ai.evidence_refs).filter((x) => evidenceIds.has(x));
    const memoryRefs = asStringArray(ai.memory_refs).filter((x) => memoryIds.has(x));
    const questionRefs = asStringArray(ai.question_refs).filter((x) => questionIds.has(x));
    const unknownRefs = asStringArray(ai.unknown_refs).filter((x) => unknownIds.has(x));
    if (branchRefs.length === 0 && evidenceRefs.length === 0 && memoryRefs.length === 0) confidence = Math.min(confidence, 60);

    const { data: runId, error: recordError } = await adminClient.rpc("record_strategic_scenario_assessment_run", {
      p_user_id: user.id,
      p_app_id: appId,
      p_scenario_id: scenarioId,
      p_snapshot_id: snapshotId,
      p_recommendation: recommendation,
      p_confidence: confidence,
      p_rationale: String(ai.rationale ?? "").trim() || null,
      p_branch_refs: branchRefs,
      p_evidence_refs: evidenceRefs,
      p_memory_refs: memoryRefs,
      p_question_refs: questionRefs,
      p_unknown_refs: unknownRefs,
      p_next_information_needed: ai.next_information_needed == null ? null : String(ai.next_information_needed).trim() || null,
    });
    if (recordError) throw new Error(`Could not record scenario assessment: ${recordError.message}`);

    return new Response(JSON.stringify({
      success: true,
      recommendation_only: true,
      run_id: runId,
      snapshot_id: snapshotId,
      context_fingerprint: envelope?.context_fingerprint,
      recommendation,
      confidence,
      rationale: String(ai.rationale ?? "").trim() || null,
      deterministic_summary: summary,
      refs: { branch_refs: branchRefs, evidence_refs: evidenceRefs, memory_refs: memoryRefs, question_refs: questionRefs, unknown_refs: unknownRefs },
      next_information_needed: ai.next_information_needed == null ? null : String(ai.next_information_needed).trim() || null,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("assess-strategic-scenario error", error);
    return new Response(JSON.stringify({ error: error?.message ?? "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
