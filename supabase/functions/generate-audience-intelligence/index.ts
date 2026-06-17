// Generates the full Audience Intelligence pack for an app:
// ICPs, Personas, Customer Journey, Messaging Angles.
// Uses Perplexity (sonar) for grounded market research, then Gemini for
// structured generation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

const JOURNEY_STAGES = [
  "awareness",
  "consideration",
  "evaluation",
  "conversion",
  "retention",
] as const;

async function research(app: any): Promise<string> {
  if (!PERPLEXITY_API_KEY) return "";
  try {
    const prompt = `You are a B2B market research analyst. Research the audience and market context for this product:

Product: ${app.name}
Description: ${app.description || "(none)"}
Stated target audience: ${app.target_audience || "(none)"}
Website: ${app.website_url || "(none)"}

Produce a concise 400-word briefing covering:
1. Who realistically buys this kind of product (titles, company size, industry)
2. What pains drive them to look for a solution
3. What objections they typically raise
4. What channels they actually consume (LinkedIn? niche communities? podcasts?)
5. 2-3 competitive or adjacent products and how they position

Be specific. No fluff.`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 700,
      }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      console.warn("[audience] Perplexity non-ok:", res.status);
      return "";
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  } catch (e) {
    console.error("[audience] Perplexity research failed (continuing without research):", (e as Error).message);
    return "";
  }
}

async function generateIntelligence(
  app: any,
  researchMd: string,
  opts: { mode: "replace" | "append"; instruction?: string; existingIcps?: any[]; existingPersonas?: any[] } = { mode: "replace" },
) {
  const isAppend = opts.mode === "append";
  const systemPrompt = `You are a senior B2B growth strategist. Output ONLY a JSON object matching the requested schema. No prose. No markdown fences.

You must be specific, opinionated, and grounded. Avoid generic AI phrasing. Never use words like "revolutionize", "unlock", "leverage", "synergy", "cutting-edge", "in today's fast-paced world".`;

  const existingContext = isAppend ? `

EXISTING ICPs (do NOT duplicate or contradict these — generate only NEW segments that complement them):
${JSON.stringify(opts.existingIcps || [], null, 2)}

EXISTING PERSONAS (do NOT duplicate — generate only NEW personas tied to the new segment):
${JSON.stringify(opts.existingPersonas || [], null, 2)}

USER INSTRUCTION FOR THE NEW SEGMENT:
${opts.instruction || "(none)"}
` : "";

  const appendShape = `
{
  "icps": [
    { "segment": "string", "company_size": "string", "industry": "string", "signals": ["string"], "notes": "string" }
  ],  // 1 to 2 NEW entries, distinct from existing
  "personas": [
    {
      "title": "string", "company_size": "string",
      "responsibilities": ["string"], "pains": ["string"], "goals": ["string"],
      "triggers": ["string"], "objections": ["string"], "channels": ["string"],
      "content_style": "string"
    }
  ]  // 1 to 2 NEW entries, distinct from existing
}

Rules:
- Do NOT regenerate the customer journey or messaging angles in append mode.
- Do NOT duplicate or rename existing ICPs/personas — produce genuinely new segments.
- Follow the user instruction above as the brief for what new segment(s) to add.`;

  const fullShape = `
{
  "icps": [
    { "segment": "string", "company_size": "string", "industry": "string", "signals": ["string"], "notes": "string" }
  ],  // 1 to 3 entries
  "personas": [
    {
      "title": "string",
      "company_size": "string",
      "responsibilities": ["string"],
      "pains": ["string"],
      "goals": ["string"],
      "triggers": ["string"],
      "objections": ["string"],
      "channels": ["string"],
      "content_style": "string"
    }
  ],  // 2 to 4 entries
  "journey": [
    {
      "stage": "awareness" | "consideration" | "evaluation" | "conversion" | "retention",
      "customer_thinking": "string (1-2 sentences in the customer's voice)",
      "pains": ["string"],
      "best_content": "string (specific formats)",
      "best_cta": "string",
      "channels": ["string"]
    }
  ],  // exactly 5 entries, one per stage in order
  "angles": [
    { "angle_name": "string", "hook_template": "string", "when_to_use": "string", "example": "string" }
  ]  // 4 to 6 entries
}

Rules:
- Personas must be specific job titles, not "decision-maker".
- Pains must be concrete frustrations, not vague problems.
- Hook templates must be reusable patterns with [brackets] for variables.
- Channels must be specific (e.g. "LinkedIn", "Indie Hackers", "r/SaaS"), not "social media".`;

  const userPrompt = `${isAppend ? "Add a NEW audience segment to this product's existing audience intelligence." : "Build the complete audience intelligence pack for this product."}

PRODUCT
Name: ${app.name}
Description: ${app.description || "(none)"}
Stated target audience: ${app.target_audience || "(none)"}
Brand tone: ${app.brand_tone || "professional"}
Website: ${app.website_url || "(none)"}

GROUNDED MARKET RESEARCH
${researchMd || "(no external research available — rely on your training)"}
${existingContext}
Return a JSON object with this exact shape:
${isAppend ? appendShape : fullShape}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 110_000);
  let res: Response;
  try {
    res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("AI took too long to respond. Please try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    const status = res.status;
    if (status === 429) throw new Error("AI is rate-limited. Try again in a moment.");
    if (status === 402) throw new Error("AI credits exhausted. Add credits in Settings.");
    throw new Error(`AI gateway error ${status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("AI returned malformed JSON. Please try again.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let admin: ReturnType<typeof createClient> | null = null;
  let userId: string | null = null;
  let appId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Unauthorized");
    userId = userData.user.id;

    const { checkRateLimit } = await import("../_shared/guard.ts");
    const rl = await checkRateLimit(userId, "generate-audience-intelligence", 3, 60);
    if (rl) return rl;


    const body = await req.json().catch(() => ({}));
    appId = body?.app_id ?? null;
    const mode: "replace" | "append" = body?.mode === "append" ? "append" : "replace";
    const instruction: string = typeof body?.instruction === "string" ? body.instruction.trim() : "";
    if (!appId) throw new Error("app_id is required");
    if (mode === "append" && !instruction) throw new Error("instruction is required in append mode");

    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: app, error: appErr } = await admin
      .from("apps")
      .select("*")
      .eq("id", appId)
      .eq("user_id", userId)
      .single();
    if (appErr || !app) throw new Error("App not found");

    console.log(`[audience] start app=${appId} mode=${mode} name="${app.name}"`);

    await admin.from("audience_profiles").upsert({
      user_id: userId,
      app_id: appId,
      status: "generating",
    }, { onConflict: "app_id" });

    // For append mode, load existing ICPs/personas as context.
    let existingIcps: any[] = [];
    let existingPersonas: any[] = [];
    if (mode === "append") {
      const [{ data: ei }, { data: ep }] = await Promise.all([
        admin.from("icps").select("segment,company_size,industry,signals,notes").eq("app_id", appId),
        admin.from("personas").select("title,company_size,pains,goals,channels").eq("app_id", appId),
      ]);
      existingIcps = ei || [];
      existingPersonas = ep || [];
    }

    const researchMd = mode === "append" ? "" : await research(app);
    console.log(`[audience] research len=${researchMd.length}`);
    const pack = await generateIntelligence(app, researchMd, {
      mode, instruction, existingIcps, existingPersonas,
    });
    console.log(`[audience] AI returned icps=${pack?.icps?.length ?? 0} personas=${pack?.personas?.length ?? 0} journey=${pack?.journey?.length ?? 0} angles=${pack?.angles?.length ?? 0}`);

    // Existing counts to compute sort_order offset in append mode.
    let icpOffset = 0, personaOffset = 0;
    if (mode === "replace") {
      await Promise.all([
        admin.from("icps").delete().eq("app_id", appId),
        admin.from("personas").delete().eq("app_id", appId),
        admin.from("journey_stages").delete().eq("app_id", appId),
        admin.from("messaging_angles").delete().eq("app_id", appId),
      ]);
    } else {
      const [{ count: ic }, { count: pc }] = await Promise.all([
        admin.from("icps").select("id", { count: "exact", head: true }).eq("app_id", appId),
        admin.from("personas").select("id", { count: "exact", head: true }).eq("app_id", appId),
      ]);
      icpOffset = ic || 0;
      personaOffset = pc || 0;
    }

    const icpRows = (pack.icps || []).slice(0, mode === "append" ? 2 : 3).map((i: any, idx: number) => ({
      user_id: userId, app_id: appId,
      segment: i.segment || "Unnamed segment",
      company_size: i.company_size || null,
      industry: i.industry || null,
      signals: Array.isArray(i.signals) ? i.signals : [],
      notes: i.notes || null,
      sort_order: icpOffset + idx,
    }));
    if (icpRows.length) await admin.from("icps").insert(icpRows);

    const personaRows = (pack.personas || []).slice(0, mode === "append" ? 2 : 4).map((p: any, idx: number) => ({
      user_id: userId, app_id: appId,
      title: p.title || "Persona",
      company_size: p.company_size || null,
      responsibilities: p.responsibilities || [],
      pains: p.pains || [], goals: p.goals || [],
      triggers: p.triggers || [], objections: p.objections || [],
      channels: p.channels || [],
      content_style: p.content_style || null,
      sort_order: personaOffset + idx,
    }));
    if (personaRows.length) await admin.from("personas").insert(personaRows);

    let journeyRowsLen = 0;
    let angleRowsLen = 0;
    if (mode === "replace") {
      const journeyByStage = new Map<string, any>();
      for (const j of pack.journey || []) {
        if (j?.stage) journeyByStage.set(String(j.stage).toLowerCase(), j);
      }
      const journeyRows = JOURNEY_STAGES.map((stage, idx) => {
        const j = journeyByStage.get(stage) || {};
        return {
          user_id: userId, app_id: appId, stage, stage_order: idx,
          customer_thinking: j.customer_thinking || null,
          pains: j.pains || [],
          best_content: j.best_content || null,
          best_cta: j.best_cta || null,
          channels: j.channels || [],
        };
      });
      await admin.from("journey_stages").insert(journeyRows);
      journeyRowsLen = journeyRows.length;

      const angleRows = (pack.angles || []).slice(0, 6).map((a: any, idx: number) => ({
        user_id: userId, app_id: appId,
        angle_name: a.angle_name || "Angle",
        hook_template: a.hook_template || null,
        when_to_use: a.when_to_use || null,
        example: a.example || null,
        sort_order: idx,
      }));
      if (angleRows.length) await admin.from("messaging_angles").insert(angleRows);
      angleRowsLen = angleRows.length;
    }

    await admin.from("audience_profiles").upsert({
      user_id: userId, app_id: appId,
      status: "ready",
      last_generated_at: new Date().toISOString(),
      raw_research: researchMd || null,
    }, { onConflict: "app_id" });

    console.log(`[audience] ✓ done app=${appId} mode=${mode}`);
    return new Response(
      JSON.stringify({
        success: true,
        mode,
        counts: {
          icps: icpRows.length,
          personas: personaRows.length,
          journey: journeyRowsLen,
          angles: angleRowsLen,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    const msg = (e as Error).message || "Unknown error";
    console.error("[audience] error:", msg);
    // Always clear stuck "generating" so the user can retry.
    if (admin && userId && appId) {
      try {
        await admin.from("audience_profiles").upsert({
          user_id: userId, app_id: appId, status: "failed",
        }, { onConflict: "app_id" });
      } catch (resetErr) {
        console.error("[audience] failed to reset status:", (resetErr as Error).message);
      }
    }
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
