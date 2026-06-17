// Enrich a single prospect using Firecrawl + Perplexity + Lovable AI (Gemini).
// Safe defaults: never overwrites manual fields unless new confidence is higher,
// never marks an email as "verified" (uses email_confidence instead).
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

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const CAP = (s: unknown, n: number) =>
  typeof s === "string" ? s.slice(0, n) : s;

async function firecrawlScrape(url: string): Promise<string | null> {
  if (!FIRECRAWL_API_KEY) return null;
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      console.warn("[enrich] firecrawl failed", r.status, d?.error);
      return null;
    }
    const md = d.markdown ?? d.data?.markdown ?? null;
    return typeof md === "string" ? md.slice(0, 8000) : null;
  } catch (e) {
    console.warn("[enrich] firecrawl error", e);
    return null;
  }
}

async function perplexityResearch(query: string): Promise<{ content: string; citations: string[] } | null> {
  if (!PERPLEXITY_API_KEY) return null;
  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a B2B research analyst. Return concise, factual findings. If something is unknown, say 'unknown'. Do not invent emails or names.",
          },
          { role: "user", content: query },
        ],
        max_tokens: 900,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      console.warn("[enrich] perplexity failed", r.status, d?.error);
      return null;
    }
    return {
      content: d.choices?.[0]?.message?.content ?? "",
      citations: Array.isArray(d.citations) ? d.citations.slice(0, 10) : [],
    };
  } catch (e) {
    console.warn("[enrich] perplexity error", e);
    return null;
  }
}

interface EnrichedJson {
  company_name?: string | null;
  industry?: string | null;
  employee_count?: number | null;
  revenue_band?: string | null;
  location?: string | null;
  linkedin_url?: string | null;
  contact_email?: string | null;
  email_confidence?: number | null;
  technology_stack?: string[];
  recent_news?: { title: string; url?: string; date?: string }[];
  hiring_signals?: { role?: string; url?: string; note?: string }[];
  funding_signals?: { round?: string; amount?: string; date?: string; source?: string }[];
  decision_makers?: { name: string; title?: string; linkedin_url?: string }[];
  enrichment_confidence?: number | null;
  notes?: string;
}

async function normalizeWithAI(payload: {
  prospect: Record<string, unknown>;
  scraped?: string | null;
  research?: { content: string; citations: string[] } | null;
}): Promise<EnrichedJson | null> {
  if (!LOVABLE_API_KEY) return null;
  const system = `You normalize raw web research into a strict JSON profile for a B2B prospect.
Rules:
- Only fill a field if evidence supports it. Use null when unknown.
- NEVER invent an email address. Only include contact_email if it appears verbatim in the provided text.
- email_confidence: 0-100. Use <=40 for pattern-guessed, 60-80 for found-on-site, 90+ only if explicitly listed as the company contact.
- enrichment_confidence: 0-100 overall confidence in the profile.
- employee_count: integer best-estimate.
- revenue_band: one of "<$1M","$1-10M","$10-50M","$50-250M","$250M-1B",">$1B" or null.
- Keep arrays <= 5 items. Keep strings concise.`;

  const user = `PROSPECT:
${JSON.stringify(payload.prospect, null, 2)}

WEBSITE_MARKDOWN (truncated):
${payload.scraped ?? "(none)"}

WEB_RESEARCH:
${payload.research?.content ?? "(none)"}

CITATIONS:
${(payload.research?.citations ?? []).join("\n")}

Return JSON only.`;

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
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (r.status === 429) return null;
    if (r.status === 402) return null;
    const d = await r.json();
    if (!r.ok) {
      console.warn("[enrich] AI normalize failed", r.status, d);
      return null;
    }
    const content = d.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
  } catch (e) {
    console.warn("[enrich] AI normalize error", e);
    return null;
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const rl = await checkRateLimit(auth.id, "enrich-prospect", 20, 60);
  if (rl) return rl;

  const body = await safeJson<{ prospect_id?: string }>(req);
  const prospect_id = body.prospect_id;
  if (!prospect_id || typeof prospect_id !== "string") {
    return errorResponse("prospect_id is required", 400);
  }

  const admin = adminClient();
  const { data: prospect, error: fetchErr } = await admin
    .from("prospects")
    .select("*")
    .eq("id", prospect_id)
    .eq("user_id", auth.id)
    .maybeSingle();

  if (fetchErr) return errorResponse(`fetch failed: ${fetchErr.message}`, 500);
  if (!prospect) return errorResponse("Prospect not found", 404);

  // Gather sources
  const url: string | null = prospect.url ?? null;
  const scraped = url ? await firecrawlScrape(url) : null;

  const researchQuery = `Research the company "${prospect.company_name ?? prospect.name}" ${
    url ? `(website: ${url})` : ""
  }. Find: industry, approximate employee count, revenue band, HQ location, LinkedIn URL, recent news (last 12 months), hiring signals, funding signals, and 1-3 decision makers (name, title, LinkedIn). Cite sources.`;
  const research = await perplexityResearch(researchQuery);

  const sources: string[] = [];
  if (scraped) sources.push("firecrawl");
  if (research) sources.push("perplexity");
  if (LOVABLE_API_KEY) sources.push("gemini");

  const ai = await normalizeWithAI({
    prospect: {
      name: prospect.name,
      company_name: prospect.company_name,
      description: prospect.description,
      url: prospect.url,
    },
    scraped,
    research,
  });

  if (!ai) {
    return errorResponse(
      "Enrichment produced no results (missing API keys or all sources failed)",
      503,
      { sources_attempted: sources },
    );
  }

  // Build update with safety rules
  const updates: Record<string, unknown> = {
    enriched_at: new Date().toISOString(),
    enrichment_source: sources.join("+") || "ai",
    enrichment_confidence: Math.max(0, Math.min(100, Math.round(ai.enrichment_confidence ?? 50))),
  };

  const setIfBetter = (
    field: string,
    newVal: unknown,
    opts: { existing: unknown; manualField?: boolean; newConfidence?: number; existingConfidence?: number } = { existing: null },
  ) => {
    if (newVal === null || newVal === undefined || newVal === "") return;
    const existing = opts.existing;
    if (existing === null || existing === undefined || existing === "") {
      updates[field] = newVal;
      return;
    }
    if (opts.manualField) {
      // Only overwrite if explicit confidence is higher
      if ((opts.newConfidence ?? 0) > (opts.existingConfidence ?? 0)) {
        updates[field] = newVal;
      }
      return;
    }
    updates[field] = newVal;
  };

  setIfBetter("company_name", CAP(ai.company_name, 200), { existing: prospect.company_name });
  setIfBetter("industry", CAP(ai.industry, 120), { existing: prospect.industry });
  if (typeof ai.employee_count === "number" && ai.employee_count > 0) {
    updates.employee_count = Math.round(ai.employee_count);
  }
  setIfBetter("revenue_band", CAP(ai.revenue_band, 40), { existing: prospect.revenue_band });
  setIfBetter("location", CAP(ai.location, 160), { existing: prospect.location });
  setIfBetter("linkedin_url", CAP(ai.linkedin_url, 300), { existing: prospect.linkedin_url });

  // Contact email: treat as manual field, only overwrite if higher confidence
  const newEmailConf = Math.max(0, Math.min(100, Math.round(ai.email_confidence ?? 0)));
  if (ai.contact_email && typeof ai.contact_email === "string" && ai.contact_email.includes("@")) {
    setIfBetter("contact_email", CAP(ai.contact_email, 200).toLowerCase(), {
      existing: prospect.contact_email,
      manualField: true,
      newConfidence: newEmailConf,
      existingConfidence: prospect.email_confidence ?? 0,
    });
    if (updates.contact_email !== undefined || !prospect.contact_email) {
      updates.email_confidence = newEmailConf;
    }
  }

  const cleanArr = <T>(a: unknown, n = 5): T[] =>
    Array.isArray(a) ? (a.slice(0, n) as T[]) : [];

  updates.technology_stack = cleanArr<string>(ai.technology_stack, 20);
  updates.recent_news = cleanArr(ai.recent_news, 5);
  updates.hiring_signals = cleanArr(ai.hiring_signals, 5);
  updates.funding_signals = cleanArr(ai.funding_signals, 5);
  updates.decision_makers = cleanArr(ai.decision_makers, 5);

  const { data: updated, error: updErr } = await admin
    .from("prospects")
    .update(updates)
    .eq("id", prospect_id)
    .eq("user_id", auth.id)
    .select()
    .maybeSingle();

  if (updErr) return errorResponse(`update failed: ${updErr.message}`, 500);

  // Audit log
  try {
    await admin.from("automation_audit_log").insert({
      user_id: auth.id,
      action_type: "prospect_enriched",
      entity_type: "prospect",
      entity_id: prospect_id,
      metadata: {
        sources,
        confidence: updates.enrichment_confidence,
        fields_updated: Object.keys(updates),
        citations: research?.citations ?? [],
        notes: CAP(ai.notes, 500) ?? null,
      },
    });
  } catch (e) {
    console.warn("[enrich] audit log failed", e);
  }

  return jsonResponse({
    ok: true,
    prospect: updated,
    sources,
    confidence: updates.enrichment_confidence,
  });
});
