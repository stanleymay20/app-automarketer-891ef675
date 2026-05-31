import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

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
          content:
            "You are a senior growth strategist. Return ONLY valid JSON. Be specific and evidence-backed. Never give generic advice like 'post more often'. Cite the supporting signal in every recommendation.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const appId: string | undefined = body.app_id;

    // Load app + audience context
    let appQ = supabase.from("apps").select("*").eq("user_id", user.id);
    if (appId) appQ = appQ.eq("id", appId);
    const { data: apps } = await appQ.limit(1);
    const app = apps?.[0];
    if (!app) {
      return new Response(JSON.stringify({ error: "No app found. Create an app first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: icps }, { data: personas }, { data: insights }] = await Promise.all([
      supabase.from("icps").select("segment,industry").eq("app_id", app.id).limit(5),
      supabase.from("personas").select("title,pains,triggers").eq("app_id", app.id).limit(5),
      supabase.from("learning_insights").select("insight_text,confidence").eq("app_id", app.id).order("created_at", { ascending: false }).limit(8),
    ]);

    const prompt = `Analyze the GTM intelligence landscape for this product and produce specific, evidence-backed signals.

PRODUCT
Name: ${app.name}
Description: ${app.description ?? ""}
Audience: ${app.target_audience ?? ""}
Website: ${app.website_url ?? ""}

ICPs: ${JSON.stringify(icps ?? [])}
Personas: ${JSON.stringify(personas ?? [])}
Prior learning insights: ${JSON.stringify(insights ?? [])}

Generate a JSON object with this exact shape:
{
  "market_signals": [{"signal_type":"trend|adoption|tech_shift","title":"...","description":"why it matters in 1 sentence","source":"e.g. Gartner, industry report","confidence_score":0-100,"impact_score":0-100}],
  "competitor_signals": [{"competitor_name":"...","signal_type":"funding|launch|pricing|hiring|partnership|acquisition","description":"...","impact_score":0-100,"recommended_response":"specific campaign action"}],
  "opportunities": [{"title":"...","category":"grant|accelerator|partnership|procurement|investor|university","description":"...","deadline":"YYYY-MM-DD or null","relevance_score":0-100,"recommendation":"specific next action","url":"https://... or null"}],
  "customer_signals": [{"audience":"e.g. Operations Leaders","topic":"...","sentiment":"positive|neutral|negative|mixed","trend_score":0-100,"recommendation":"specific campaign angle"}],
  "growth_recommendations": [{"recommendation_type":"campaign|positioning|channel|offer","title":"...","explanation":"why, tied to a specific signal above","confidence_score":0-100,"expected_impact":"high|medium|low"}]
}

Rules:
- 3-5 items per array
- Every item must be specific to THIS product/audience, not generic
- Recommendations must reference patterns from the signals (e.g. "Competitor X's enterprise launch + rising AI Governance discussion = ...")
- No filler. No "post more often". No "increase engagement".`;

    const ai = await callAI(prompt);

    // Wipe prior auto-generated signals for this app/user (simple refresh model)
    if (app.id) {
      await Promise.all([
        supabase.from("market_signals").delete().eq("user_id", user.id).eq("app_id", app.id),
        supabase.from("competitor_signals").delete().eq("user_id", user.id).eq("app_id", app.id),
        supabase.from("opportunities").delete().eq("user_id", user.id).eq("app_id", app.id),
        supabase.from("customer_signals").delete().eq("user_id", user.id).eq("app_id", app.id),
        supabase.from("growth_recommendations").delete().eq("user_id", user.id).eq("app_id", app.id),
      ]);
    }

    const base = { user_id: user.id, app_id: app.id };
    const inserts: any[] = [];

    if (Array.isArray(ai.market_signals)) {
      inserts.push(supabase.from("market_signals").insert(ai.market_signals.map((s: any) => ({ ...base, ...s }))));
    }
    if (Array.isArray(ai.competitor_signals)) {
      inserts.push(supabase.from("competitor_signals").insert(ai.competitor_signals.map((s: any) => ({ ...base, ...s }))));
    }
    if (Array.isArray(ai.opportunities)) {
      inserts.push(
        supabase.from("opportunities").insert(
          ai.opportunities.map((s: any) => ({
            ...base,
            ...s,
            deadline: s.deadline && /^\d{4}-\d{2}-\d{2}$/.test(s.deadline) ? s.deadline : null,
          }))
        )
      );
    }
    if (Array.isArray(ai.customer_signals)) {
      inserts.push(supabase.from("customer_signals").insert(ai.customer_signals.map((s: any) => ({ ...base, ...s }))));
    }
    if (Array.isArray(ai.growth_recommendations)) {
      inserts.push(supabase.from("growth_recommendations").insert(ai.growth_recommendations.map((s: any) => ({ ...base, ...s }))));
    }

    await Promise.all(inserts);

    return new Response(
      JSON.stringify({
        ok: true,
        counts: {
          market: ai.market_signals?.length ?? 0,
          competitors: ai.competitor_signals?.length ?? 0,
          opportunities: ai.opportunities?.length ?? 0,
          customers: ai.customer_signals?.length ?? 0,
          recommendations: ai.growth_recommendations?.length ?? 0,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("generate-growth-intelligence error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
