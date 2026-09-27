import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

const TYPES = ["channel", "community", "influencer", "event"] as const;
type TargetType = typeof TYPES[number];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

async function perplexity(query: string): Promise<string> {
  if (!PERPLEXITY_API_KEY) return "";
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "Return real, named places/people/events with URLs. Be specific. No fluff." },
          { role: "user", content: query },
        ],
        max_tokens: 1200,
      }),
    });
    if (!res.ok) return "";
    const j = await res.json();
    return j.choices?.[0]?.message?.content ?? "";
  } catch { return ""; }
}

async function aiJSON(prompt: string): Promise<any> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Return ONLY valid JSON. No prose, no markdown fences." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text = (j.choices?.[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim();
  try { return JSON.parse(text); }
  catch { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const body = await req.json().catch(() => ({}));

    // Service-role internal invocation (used by weekly rediscovery cron)
    let user: { id: string } | null = null;
    const isService = authHeader.includes(SUPABASE_SERVICE_ROLE_KEY);
    if (isService && body.internal_user_id) {
      user = { id: String(body.internal_user_id) };
    } else {
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await userClient.auth.getUser();
      user = userData.user ? { id: userData.user.id } : null;
    }
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { checkRateLimit } = await import("../_shared/guard.ts");
    const rl = await checkRateLimit(user.id, "discover-distribution", 5, 60);
    if (rl) return rl;


    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const appId: string | undefined = body.app_id ?? body.internal_app_id;
    const requested: TargetType[] = (body.types?.length ? body.types : TYPES).filter((t: string) => TYPES.includes(t as TargetType));


    const [appRes, icpsRes, personasRes, anglesRes, learnRes] = await Promise.all([
      appId ? admin.from("apps").select("*").eq("id", appId).maybeSingle() : Promise.resolve({ data: null } as any),
      admin.from("icps").select("*").eq("user_id", user.id).limit(10),
      admin.from("personas").select("*").eq("user_id", user.id).limit(10),
      admin.from("messaging_angles").select("*").eq("user_id", user.id).limit(10),
      admin.from("learning_insights").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
    ]);

    const baseFilter = (q: any) => (appId ? q.eq("app_id", appId) : q.eq("user_id", user.id));
    const [contentRes, clicksRes, leadsRes, convsRes] = await Promise.all([
      baseFilter(admin.from("content").select("platform, status")),
      baseFilter(admin.from("click_events").select("content_id")),
      baseFilter(admin.from("leads").select("platform")),
      baseFilter(admin.from("conversions").select("amount, source_content_id")),
    ]);
    const contentById: Record<string, string> = {};
    const platformPosts: Record<string, number> = {};
    for (const c of contentRes.data ?? []) {
      const p = (c.platform ?? "").toLowerCase();
      if (c.status === "published") platformPosts[p] = (platformPosts[p] ?? 0) + 1;
    }
    const allContentRes = await baseFilter(admin.from("content").select("id, platform"));
    for (const c of allContentRes.data ?? []) contentById[c.id] = (c.platform ?? "").toLowerCase();
    const platformClicks: Record<string, number> = {};
    for (const c of clicksRes.data ?? []) { const p = contentById[c.content_id]; if (p) platformClicks[p] = (platformClicks[p] ?? 0) + 1; }
    const platformLeads: Record<string, number> = {};
    for (const l of leadsRes.data ?? []) { const p = (l.platform ?? "").toLowerCase(); if (p) platformLeads[p] = (platformLeads[p] ?? 0) + 1; }
    const platformRevenue: Record<string, number> = {};
    const platformConvs: Record<string, number> = {};
    for (const c of convsRes.data ?? []) {
      const p = contentById[c.source_content_id] ?? "";
      if (p) { platformRevenue[p] = (platformRevenue[p] ?? 0) + Number(c.amount ?? 0); platformConvs[p] = (platformConvs[p] ?? 0) + 1; }
    }

    const attribution = { platformPosts, platformClicks, platformLeads, platformConvs, platformRevenue };

    const app = appRes.data;
    let bookProfile: any = null;
    if (app?.offering_type === "Book" && appId) {
      const { data } = await admin
        .from("book_marketing_profiles")
        .select("title,subtitle,author_name,asin,isbn_paperback,isbn_hardcover,isbn_epub,primary_conversion_url,genres,themes,markets,launch_stage,launch_date,review_goal,sales_goal")
        .eq("app_id", appId)
        .maybeSingle();
      bookProfile = data ?? null;
    }

    const context = {
      product: app ? {
        name: app.name,
        description: app.description,
        audience: app.target_audience,
        goal: app.primary_goal,
        goal_type: app.goal_type,
        offering_type: app.offering_type,
        website: app.website_url,
      } : null,
      book: bookProfile,
      icps: (icpsRes.data ?? []).map((i: any) => ({ segment: i.segment, industry: i.industry, size: i.company_size })),
      personas: (personasRes.data ?? []).map((p: any) => ({ title: p.title, pains: p.pains, channels: p.channels })),
      angles: (anglesRes.data ?? []).map((a: any) => a.angle_name),
      learnings: (learnRes.data ?? []).map((l: any) => l.insight_text),
      attribution,
    };

    const genericBriefs: Record<TargetType, string> = {
      channel: "10 best owned/social/distribution channels: LinkedIn, X, Reddit, Facebook, Instagram, TikTok, YouTube, Email, Medium, Hacker News, Product Hunt, Discord, Slack communities. Pick the 6-10 most relevant for this audience.",
      community: "8 real, specific communities the persona is active in: named subreddits (r/...), Facebook groups, LinkedIn groups, Discord servers, Slack communities, forums.",
      influencer: "6 real industry creators, thought leaders, newsletter writers or podcast hosts with reach to this persona. Include handle/URL.",
      event: "6 upcoming conferences, meetups, industry events, startup events or webinars (next 6 months) where this audience attends.",
    };

    const bookBriefs: Record<TargetType, string> = {
      channel: "Find the best reader-acquisition channels for this specific book. Consider Goodreads, BookBub, The StoryGraph, Amazon/retailer merchandising surfaces, author newsletters, podcasts, YouTube/BookTube, TikTok/BookTok, Instagram/Bookstagram, Facebook, Reddit, LinkedIn where relevant, libraries, bookstores, book clubs, church/faith networks, academic/professional communities, diaspora communities and direct email. Rank by audience fit and likely conversion, not headline audience size. Do not recommend a channel merely because it is large.",
      community: "Find 8 real, specific reader communities for this book's genres, themes, markets and audience: named Facebook groups, subreddits, LinkedIn groups, Goodreads groups, book clubs, library communities, faith communities, academic/professional groups, diaspora communities, forums or Discord/Slack groups. Prefer communities with clear relevance and legitimate promotion/recommendation rules. Avoid generic mass-promotion groups unless there is evidence of real engagement.",
      influencer: "Find 6 real people or media outlets that could credibly put this book in front of relevant readers: book reviewers, BookTok/Bookstagram/BookTube creators, podcasters, newsletter writers, librarians, academics, pastors/faith leaders, historians, subject-matter creators or journalists as appropriate to the book. Include a real profile/channel URL and why their audience matches the book.",
      event: "Find 6 real upcoming opportunities in the next 6 months where this book could reach qualified readers: book fairs, literary festivals, author events, library programs, book-club events, conferences, church/fellowship events, academic panels, diaspora/community events or relevant webinars. Prefer events with a plausible author/book participation path.",
    };

    const isBook = app?.offering_type === "Book";
    const briefs = isBook ? bookBriefs : genericBriefs;

    const created: any[] = [];

    for (const type of requested) {
      const search = await perplexity(
        isBook
          ? `BOOK DISTRIBUTION RESEARCH. Title: ${context.book?.title ?? context.product?.name ?? "book"}. Subtitle: ${context.book?.subtitle ?? ""}. Author: ${context.book?.author_name ?? ""}. Description: ${context.product?.description ?? ""}. Audience: ${context.product?.audience ?? ""}. Genres: ${(context.book?.genres ?? []).join(", ")}. Themes: ${(context.book?.themes ?? []).join(", ")}. Priority markets: ${(context.book?.markets ?? []).join(", ")}. Launch stage: ${context.book?.launch_stage ?? "unknown"}. TASK: ${briefs[type]} Return real names and URLs. Distinguish verified facts from estimates. Do not equate group membership with actual reach.`
          : `For: ${context.product?.name ?? "an AI growth platform"} — ${context.product?.description ?? ""}. Audience: ${context.product?.audience ?? "founders, marketers, operators"}. ${briefs[type]} Return each with name, URL, 1-line reason it fits.`
      );

      const prompt = `Discover ${type}s for distribution.\n\nCONTEXT:\n${JSON.stringify(context, null, 2)}\n\nTASK: ${briefs[type]}\n\nWEB RESEARCH:\n${search || "(no live research; rely on general knowledge of real " + type + "s)"}\n\nFor each item return:\n{\n  "name": "string",\n  "platform": "lowercase platform slug if applicable (linkedin/x/reddit/discord/slack/youtube/podcast/event/email/medium/hackernews/producthunt/...) or 'other'",\n  "description": "1 sentence",\n  "url": "https url or empty",\n  "audience": "who is there",\n  "event_date": "YYYY-MM-DD or null (events only)",\n  "audience_fit": 0-100,\n  "reach_potential": 0-100,\n  "competition_level": 0-100 (higher = more saturated/competitive),\n  "cost_score": 0-100 (higher = cheaper/free),\n  "conversion_potential": 0-100,\n  "rationale": "1-2 sentences citing persona/channels/learnings/attribution",\n  "signals": ["short evidence point", "..."]\n}\n\nIf attribution shows clicks/conversions for a platform, weight conversion_potential up; if zero across the board, cap conversion_potential at 65. Return JSON: { "items": [...] } max 8 items.`;

      const json = await aiJSON(prompt);
      const items: any[] = Array.isArray(json.items) ? json.items.slice(0, 10) : [];

      for (const it of items) {
        const fit = clamp(it.audience_fit ?? 50);
        const reach = clamp(it.reach_potential ?? 50);
        const comp = clamp(it.competition_level ?? 50);
        const cost = clamp(it.cost_score ?? 50);
        const conv = clamp(it.conversion_potential ?? 50);
        const overall = clamp(fit * 0.3 + conv * 0.3 + reach * 0.2 + (100 - comp) * 0.1 + cost * 0.1);

        const { data: row } = await admin.from("distribution_targets").insert({
          user_id: user.id,
          app_id: appId ?? null,
          target_type: type,
          platform: (it.platform ?? "").toString().toLowerCase() || null,
          name: String(it.name ?? "Unnamed").slice(0, 200),
          description: it.description ?? null,
          url: it.url ?? null,
          audience: it.audience ?? null,
          event_date: it.event_date || null,
          audience_fit: fit,
          reach_potential: reach,
          competition_level: comp,
          cost_score: cost,
          conversion_potential: conv,
          distribution_score: overall,
          rationale: it.rationale ?? null,
          signals: it.signals ?? [],
          metadata: { has_web: !!search, discovery_mode: isBook ? "book" : "general" },
          source: search ? "perplexity+ai" : "ai_only",
        }).select().single();
        if (row) created.push(row);
      }
    }

    const recPrompt = `Based on this attribution data and intelligence, write 3-5 short, plainspoken distribution insights (1 sentence each) plus a one-line recommendation. Use real attribution numbers when present.\n\nATTRIBUTION:\n${JSON.stringify(attribution, null, 2)}\n\nPERSONAS: ${JSON.stringify(context.personas)}\nLEARNINGS: ${JSON.stringify(context.learnings)}\n\nReturn JSON:\n{\n  "recommendations": [\n    {\n      "insight": "string",\n      "recommendation": "string",\n      "basis": "attribution | signal | hypothesis",\n      "confidence": 0-100,\n      "related_platform": "lowercase platform or null"\n    }\n  ]\n}\n\nCap confidence at 60 when basis is 'hypothesis'. Be concrete. No buzzwords.`;
    try {
      const recJson = await aiJSON(recPrompt);
      const recs: any[] = Array.isArray(recJson.recommendations) ? recJson.recommendations.slice(0, 6) : [];
      const delQ = admin.from("distribution_recommendations").delete().eq("user_id", user.id);
      if (appId) await delQ.eq("app_id", appId); else await delQ.is("app_id", null);
      for (const r of recs) {
        await admin.from("distribution_recommendations").insert({
          user_id: user.id,
          app_id: appId ?? null,
          insight: r.insight ?? "",
          recommendation: r.recommendation ?? null,
          basis: ["attribution", "signal", "hypothesis"].includes(r.basis) ? r.basis : "hypothesis",
          confidence: clamp(r.confidence ?? 50),
          related_platform: (r.related_platform ?? "").toString().toLowerCase() || null,
        });
      }
    } catch (e) { console.warn("rec generation failed", e); }

    return new Response(JSON.stringify({ created: created.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("discover-distribution", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
