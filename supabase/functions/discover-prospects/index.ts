import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

const CATEGORIES = ["customer", "grant", "partner", "investor", "community"] as const;
type Category = typeof CATEGORIES[number];

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function perplexitySearch(query: string): Promise<string> {
  if (!PERPLEXITY_API_KEY) return "";
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "Return concrete, real organizations with names and URLs. Be specific. No fluff." },
          { role: "user", content: query },
        ],
        max_tokens: 1200,
      }),
    });
    if (!res.ok) return "";
    const j = await res.json();
    return j.choices?.[0]?.message?.content ?? "";
  } catch {
    return "";
  }
}

async function aiJSON(prompt: string): Promise<any> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You return ONLY valid JSON. No prose, no markdown fences." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { checkRateLimit } = await import("../_shared/guard.ts");
    const rl = await checkRateLimit(user.id, "discover-prospects", 5, 60);
    if (rl) return rl;


    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const appId: string | undefined = body.app_id;
    const requestedCats: Category[] = (body.categories && body.categories.length ? body.categories : CATEGORIES).filter((c: string) => CATEGORIES.includes(c as Category));

    // Pull intelligence context
    const [appRes, icpsRes, personasRes, journeyRes, anglesRes, learnRes, convRes] = await Promise.all([
      appId ? admin.from("apps").select("*").eq("id", appId).maybeSingle() : Promise.resolve({ data: null } as any),
      admin.from("icps").select("*").eq("user_id", user.id).limit(10),
      admin.from("personas").select("*").eq("user_id", user.id).limit(10),
      admin.from("journey_stages").select("*").eq("user_id", user.id).limit(10),
      admin.from("messaging_angles").select("*").eq("user_id", user.id).limit(10),
      admin.from("learning_insights").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      admin.from("conversions").select("amount, source_content_id").eq("user_id", user.id).limit(50),
    ]);

    const app = appRes.data;
    const context = {
      product: app ? { name: app.name, description: app.description, audience: app.target_audience, goal: app.primary_goal, website: app.website_url } : null,
      icps: (icpsRes.data ?? []).map((i: any) => ({ segment: i.segment, industry: i.industry, size: i.company_size })),
      personas: (personasRes.data ?? []).map((p: any) => ({ title: p.title, pains: p.pains, channels: p.channels })),
      journey: (journeyRes.data ?? []).map((j: any) => ({ stage: j.stage, channels: j.channels })),
      angles: (anglesRes.data ?? []).map((a: any) => a.angle_name),
      learnings: (learnRes.data ?? []).map((l: any) => l.insight_text),
      conversions: convRes.data?.length ?? 0,
    };

    const created: any[] = [];

    for (const category of requestedCats) {
      const catBrief: Record<Category, string> = {
        customer: "5 real companies/organizations that would buy this product (universities, SaaS, manufacturers, agencies, etc.) — match ICP and persona above.",
        grant: "5 real, currently-open grants, accelerator programs, or innovation funding (EXIST, EU Horizon, AI grants, university programs, regional innovation funds).",
        partner: "5 real strategic partners — distributors, implementation agencies, consultancies, complementary tools — that serve the same audience.",
        investor: "5 real angel investors, accelerators, or VCs that invest in this domain/stage.",
        community: "5 real communities — LinkedIn groups, Slack groups, subreddits, industry associations — where the target persona is active.",
      };

      const search = await perplexitySearch(
        `For a product: ${context.product?.name ?? "an AI marketing platform"} (${context.product?.description ?? ""}). Audience: ${context.product?.audience ?? "founders, marketers"}. ${catBrief[category]} Return each with name, URL, one-line reason it's a fit.`
      );

      const aiPrompt = `Given this intelligence context and live web research, generate prospects.

CONTEXT:
${JSON.stringify(context, null, 2)}

CATEGORY: ${category}
${catBrief[category]}

WEB RESEARCH:
${search || "(no live research available; use general knowledge of real organizations)"}

Return JSON shape:
{
  "prospects": [
    {
      "name": "string (real org name)",
      "description": "1 sentence",
      "url": "https url or empty",
      "location": "string or empty",
      "deadline": "YYYY-MM-DD or null (grants/accelerators only)",
      "fit_score": 0-100,
      "opportunity_score": 0-100,
      "urgency_score": 0-100,
      "reachability_score": 0-100,
      "match_reason": "1-2 sentences citing persona/ICP/learnings",
      "signals": ["short evidence point", "..."]
    }
  ]
}

Score honestly. Cap at 65 when context is thin. Prefer real, verifiable orgs. 5 items max.`;

      const json = await aiJSON(aiPrompt);
      const items: any[] = Array.isArray(json.prospects) ? json.prospects.slice(0, 5) : [];

      for (const p of items) {
        const fit = clamp(p.fit_score ?? 50);
        const opp = clamp(p.opportunity_score ?? 50);
        const urg = clamp(p.urgency_score ?? 50);
        const reach = clamp(p.reachability_score ?? 50);
        const overall = clamp(fit * 0.4 + opp * 0.3 + urg * 0.15 + reach * 0.15);

        const { data: row, error } = await admin
          .from("prospects")
          .insert({
            user_id: user.id,
            app_id: appId ?? null,
            category,
            name: String(p.name ?? "Unnamed").slice(0, 200),
            description: p.description ?? null,
            url: p.url ?? null,
            location: p.location ?? null,
            deadline: p.deadline || null,
            fit_score: fit,
            opportunity_score: opp,
            urgency_score: urg,
            reachability_score: reach,
            prospect_score: overall,
            match_reason: p.match_reason ?? null,
            signals: p.signals ?? [],
            evidence: { context_size: context.conversions, has_web: !!search },
            source: search ? "perplexity+ai" : "ai_only",
          })
          .select()
          .single();
        if (!error && row) created.push(row);
      }
    }

    return new Response(JSON.stringify({ created: created.length, prospects: created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("discover-prospects", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
