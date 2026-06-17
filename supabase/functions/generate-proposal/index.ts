// Generates a structured proposal draft for a prospect using Lovable AI Gateway.
// SAFETY: writes a draft row only — never sends, never auto-accepts, never
// changes pricing without a human. Caller must be authenticated and own the prospect.
import {
  adminClient,
  checkRateLimit,
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireUser,
  safeJson,
} from "../_shared/guard.ts";

const RULE_VERSION = "proposal-v1";
const MODEL = "google/gemini-3-flash-preview";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface Input {
  prospect_id: string;
  app_id?: string | null;
  meeting_id?: string | null;
  proposal_title?: string;
  notes?: string;
}

function safeStr(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const rateLimited = await checkRateLimit(auth.id, "generate-proposal", 10, 60);
  if (rateLimited) return rateLimited;

  const body = await safeJson<Input>(req);
  if (!body?.prospect_id) return errorResponse("prospect_id is required");

  const admin = adminClient();
  const { data: prospect, error: pErr } = await admin
    .from("prospects")
    .select(
      "id,user_id,app_id,name,company_name,contact_email,segment,segment_reason,opportunity_score,opportunity_confidence,expected_value,expected_value_confidence,value_currency,value_reasoning,icp_fit_reasoning,buying_signal_reasoning,urgency_reasoning,reachability_reasoning,icp_fit_evidence,buying_signal_evidence",
    )
    .eq("id", body.prospect_id)
    .maybeSingle();
  if (pErr || !prospect) return errorResponse("Prospect not found", 404);
  if (prospect.user_id !== auth.id) return errorResponse("Forbidden", 403);

  // Optional context
  let appCtx: any = null;
  const appId = body.app_id || prospect.app_id;
  if (appId) {
    const { data: app } = await admin.from("apps").select("id,name,description,landing_headline,category").eq("id", appId).maybeSingle();
    appCtx = app;
  }

  let meetingNotes: string | null = null;
  let meetingObjections: string[] = [];
  if (body.meeting_id) {
    const { data: m } = await admin.from("meetings").select("id,user_id,notes,agenda").eq("id", body.meeting_id).maybeSingle();
    if (m && m.user_id === auth.id) {
      meetingNotes = [m.agenda, m.notes].filter(Boolean).join("\n\n");
      const { data: outs } = await admin.from("meeting_outcomes")
        .select("summary,objections,opportunities,next_action")
        .eq("meeting_id", body.meeting_id)
        .order("created_at", { ascending: false }).limit(1);
      if (outs?.[0]) {
        if (Array.isArray(outs[0].objections)) meetingObjections = outs[0].objections;
        meetingNotes = [meetingNotes, outs[0].summary, outs[0].next_action ? `Next: ${outs[0].next_action}` : null]
          .filter(Boolean).join("\n\n");
      }
    }
  }

  const sys = `You draft B2B service proposals. Output STRICT JSON only — no prose, no markdown. The proposal must be honest, evidence-based, and never invent capabilities. Currency must match input. Pricing values must be plain numbers.`;

  const schemaHint = {
    proposal_title: "string (<=120 chars)",
    proposal_text: "string (3-6 short paragraphs, plain text)",
    scope: "string (what's included)",
    deliverables: "string[] (3-7 items)",
    timeline: "string (e.g. '6 weeks, 3 milestones')",
    pricing_model: "one of: fixed, hourly, retainer, value_based",
    pricing_options: "[{name,price,currency,includes:string[]}] (1-3 options)",
    proposal_value: "number (the primary/recommended price)",
    currency: "string (ISO, e.g. EUR)",
    roi_estimate: "string (1-2 sentences, conservative)",
    next_steps: "string (single short paragraph)",
    reasoning: "string (why this proposal fits THIS prospect — cite evidence)",
    confidence: "integer 0-100 (your confidence the prospect will accept)",
  };

  const prompt = `Prospect:
  name: ${prospect.name ?? "—"}
  company: ${prospect.company_name ?? "—"}
  segment: ${prospect.segment ?? "—"} (${prospect.segment_reason ?? "no reason"})
  opportunity_score: ${prospect.opportunity_score ?? "—"} (conf ${prospect.opportunity_confidence ?? "—"}%)
  expected_value: ${prospect.expected_value ?? "—"} ${prospect.value_currency ?? "EUR"} (conf ${prospect.expected_value_confidence ?? "—"}%)
  value_reasoning: ${safeStr(prospect.value_reasoning, 600)}
  icp_fit: ${safeStr(prospect.icp_fit_reasoning, 400)}
  buying_signal: ${safeStr(prospect.buying_signal_reasoning, 400)}
  evidence (icp): ${(prospect.icp_fit_evidence ?? []).slice(0,4).join(" | ")}
  evidence (signals): ${(prospect.buying_signal_evidence ?? []).slice(0,4).join(" | ")}

Offering: ${appCtx ? `${appCtx.name} — ${appCtx.landing_headline ?? appCtx.description ?? ""}` : "—"}

Meeting context: ${safeStr(meetingNotes, 1500) || "—"}
Known objections: ${meetingObjections.join("; ") || "—"}

Caller notes: ${safeStr(body.notes, 1000) || "—"}

Suggested proposal title: ${safeStr(body.proposal_title, 120) || "(invent one)"}

Return ONLY a JSON object with exactly these fields:
${JSON.stringify(schemaHint, null, 2)}`;

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return errorResponse("LOVABLE_API_KEY not configured", 500);

  let aiJson: any = null;
  let aiError: string | null = null;
  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    });
    if (res.status === 429) return errorResponse("AI rate limit (429). Try again in a minute.", 429);
    if (res.status === 402) return errorResponse("Workspace AI credits exhausted (402). Add credits in Settings.", 402);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AI gateway ${res.status}: ${txt.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    aiJson = JSON.parse(content);
  } catch (e) {
    aiError = (e as Error).message;
  }
  if (!aiJson) return errorResponse(`AI generation failed: ${aiError}`, 502);

  // Coerce and clamp
  const title = safeStr(aiJson.proposal_title, 120) || safeStr(body.proposal_title, 120) ||
    `Proposal for ${prospect.company_name ?? prospect.name ?? "prospect"}`;
  const currency = (typeof aiJson.currency === "string" && aiJson.currency.length <= 6)
    ? aiJson.currency.toUpperCase() : (prospect.value_currency || "EUR");
  const proposal_value = Number.isFinite(Number(aiJson.proposal_value)) ? Number(aiJson.proposal_value) : null;
  const confidence = Math.max(0, Math.min(100, Math.round(Number(aiJson.confidence ?? 50))));
  const deliverables = Array.isArray(aiJson.deliverables) ? aiJson.deliverables.slice(0, 10).map((d: any) => safeStr(d, 200)) : [];
  const pricing_options = Array.isArray(aiJson.pricing_options) ? aiJson.pricing_options.slice(0, 5) : [];

  const insertRow = {
    user_id: auth.id,
    prospect_id: prospect.id,
    app_id: appId ?? null,
    meeting_id: body.meeting_id ?? null,
    proposal_title: title,
    proposal_value,
    currency,
    proposal_text: safeStr(aiJson.proposal_text, 6000),
    scope: safeStr(aiJson.scope, 2000),
    deliverables,
    timeline: safeStr(aiJson.timeline, 400),
    pricing_model: safeStr(aiJson.pricing_model, 40),
    pricing_options,
    roi_estimate: safeStr(aiJson.roi_estimate, 600),
    next_steps: safeStr(aiJson.next_steps, 600),
    reasoning: safeStr(aiJson.reasoning, 2000),
    confidence,
    status: "draft",
    evidence: {
      icp_fit_evidence: prospect.icp_fit_evidence ?? [],
      buying_signal_evidence: prospect.buying_signal_evidence ?? [],
      meeting_objections: meetingObjections,
    },
    ai_model: MODEL,
    ai_prompt_version: RULE_VERSION,
  };

  const { data: inserted, error: insErr } = await admin.from("proposals").insert(insertRow).select().single();
  if (insErr) return errorResponse(`Save failed: ${insErr.message}`, 500);

  try {
    await admin.from("automation_audit_log").insert({
      user_id: auth.id,
      action_type: "proposal_generated",
      entity_type: "proposal",
      entity_id: inserted.id,
      details: { rule_version: RULE_VERSION, prospect_id: prospect.id, proposal_value, currency, confidence },
    });
  } catch { /* swallow */ }

  return jsonResponse({ ok: true, proposal: inserted, rule_version: RULE_VERSION });
});
