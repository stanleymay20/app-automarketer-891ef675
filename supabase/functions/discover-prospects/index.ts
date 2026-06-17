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
    const metrics = {
      dropped_no_url: 0,
      dropped_no_evidence: 0,
      dropped_duplicate: 0,
      dropped_wrong_size: 0,
      low_confidence: 0,
      confidence_sum: 0,
      confidence_count: 0,
    };

    // Known large/public enterprises — used to filter customer prospects when ICP targets SMB.
    const LARGE_COMPANY_BLOCKLIST = new Set([
      "siemens","sap","salesforce","oracle","microsoft","google","alphabet","amazon","aws","meta","facebook",
      "apple","ibm","cisco","intel","nvidia","adobe","atlassian","servicenow","workday","hubspot","shopify",
      "stripe","square","block","paypal","netflix","uber","lyft","airbnb","tesla","spacex","walmart","target",
      "costco","fedex","ups","dhl","mckinsey","bcg","bain","deloitte","accenture","kpmg","ey","pwc","ernst & young",
      "jpmorgan","goldman sachs","morgan stanley","citi","bank of america","wells fargo","hsbc","bnp paribas",
      "santander","barclays","ubs","credit suisse","allianz","axa","aig","prudential","bosch","ge","general electric",
      "honeywell","3m","caterpillar","john deere","boeing","airbus","lockheed","raytheon","exxon","shell","bp",
      "chevron","total","totalenergies","saudi aramco","pfizer","novartis","roche","merck","johnson & johnson",
      "abbvie","astrazeneca","gsk","bayer","unilever","nestle","procter & gamble","coca-cola","pepsi","pepsico",
      "loreal","l'oreal","lvmh","kering","nike","adidas","puma","zara","inditex","h&m","disney","warner","comcast",
      "att","verizon","t-mobile","vodafone","deutsche telekom","orange","telefonica","samsung","lg","sony",
      "panasonic","toyota","honda","ford","gm","volkswagen","bmw","mercedes","daimler","stellantis","renault",
      "byd","tencent","alibaba","baidu","jd.com","bytedance","tiktok","snapchat","pinterest","twitter","x corp",
      "linkedin","zoom","slack","dropbox","box","okta","datadog","snowflake","databricks","mongodb","palantir",
    ]);

    function isLikelyLargeCompany(name: string): boolean {
      const lc = name.toLowerCase().trim();
      if (LARGE_COMPANY_BLOCKLIST.has(lc)) return true;
      for (const big of LARGE_COMPANY_BLOCKLIST) {
        // word-boundary-ish match: "Siemens Energy" -> hits "siemens"
        if (lc === big || lc.startsWith(big + " ") || lc.endsWith(" " + big) || lc.includes(" " + big + " ")) return true;
      }
      return false;
    }

    // Parse ICP company_size text into a numeric range (employees).
    function parseSizeRange(size: string | null | undefined): { min: number; max: number } | null {
      if (!size) return null;
      const s = size.toLowerCase().replace(/,/g, "");
      // e.g. "20-200", "20 to 200", "20–200", "<50", "under 100", "1000+"
      const range = s.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/);
      if (range) return { min: parseInt(range[1]), max: parseInt(range[2]) };
      const under = s.match(/(?:<|under|less than|up to)\s*(\d+)/);
      if (under) return { min: 1, max: parseInt(under[1]) };
      const plus = s.match(/(\d+)\s*\+/);
      if (plus) return { min: parseInt(plus[1]), max: 1_000_000 };
      const single = s.match(/(\d+)/);
      if (single) { const n = parseInt(single[1]); return { min: Math.max(1, Math.floor(n / 2)), max: n * 2 }; }
      return null;
    }

    // Build the list of discovery "tasks". For "customer", one task per ICP (size-aware).
    type Task = {
      category: Category;
      brief: string;
      searchQuery: string;
      matched_icp_id: string | null;
      icp_label: string | null;
      sizeRange: { min: number; max: number } | null;
    };

    const productName = context.product?.name ?? "an AI marketing platform";
    const productDesc = context.product?.description ?? "";
    const audience = context.product?.audience ?? "founders, marketers";
    const icpsRaw = (icpsRes.data ?? []) as any[];

    const tasks: Task[] = [];

    for (const category of requestedCats) {
      if (category === "customer") {
        // Per-ICP iteration with hard size constraint.
        const icpList = icpsRaw.length > 0 ? icpsRaw : [null];
        for (const icp of icpList) {
          const size = icp?.company_size as string | null;
          const industry = icp?.industry as string | null;
          const segment = icp?.segment as string | null;
          const range = parseSizeRange(size);
          const sizeText = range
            ? `approximately ${range.min}-${range.max} employees`
            : size
              ? `company size: ${size}`
              : "any size";
          const industryText = industry ? ` in the ${industry} industry` : "";
          const segmentText = segment ? ` (segment: "${segment}")` : "";
          const sizeHardRule = range && range.max < 500
            ? `\n\nHARD CONSTRAINT: Return ONLY companies with ${sizeText}${industryText}. Do NOT return well-known enterprise companies, Fortune 500s, or companies with 1000+ employees, EVEN IF they are a strong thematic fit. Explicitly forbidden examples: Siemens, SAP, Salesforce, Microsoft, Google, Atlassian, McKinsey, Deloitte, Accenture, IBM, Oracle, Adobe, HubSpot, Shopify, Stripe, and similar large public companies. If you cannot find 5 verifiable real companies in this exact size range, RETURN FEWER rather than substituting a larger company.`
            : "";

          const brief = `5 real companies${industryText} of size ${sizeText} that would buy this product${segmentText}.${sizeHardRule}`;
          const searchQuery = `Real, specific small/mid-market companies${industryText}, ${sizeText}${segmentText}, that would buy a product like: ${productName} (${productDesc}). Audience: ${audience}. Avoid Fortune 500 and well-known enterprises. Return each with name, URL, employee count if known, one-line fit reason.`;
          tasks.push({
            category,
            brief,
            searchQuery,
            matched_icp_id: icp?.id ?? null,
            icp_label: segment ?? null,
            sizeRange: range,
          });
        }
      } else {
        const briefMap: Record<Exclude<Category, "customer">, string> = {
          grant: "5 real, currently-open grants, accelerator programs, or innovation funding (EXIST, EU Horizon, AI grants, university programs, regional innovation funds).",
          partner: "5 real strategic partners — distributors, implementation agencies, consultancies, complementary tools — that serve the same audience.",
          investor: "5 real angel investors, accelerators, or VCs that invest in this domain/stage.",
          community: "5 real communities — LinkedIn groups, Slack groups, subreddits, industry associations — where the target persona is active.",
        };
        const brief = briefMap[category as Exclude<Category, "customer">];
        tasks.push({
          category,
          brief,
          searchQuery: `For a product: ${productName} (${productDesc}). Audience: ${audience}. ${brief} Return each with name, URL, one-line reason it's a fit.`,
          matched_icp_id: null,
          icp_label: null,
          sizeRange: null,
        });
      }
    }

    for (const task of tasks) {
      const { category, brief, searchQuery, matched_icp_id, icp_label, sizeRange } = task;
      const search = await perplexitySearch(searchQuery);

      const aiPrompt = `Given this intelligence context and live web research, generate prospects.

CONTEXT:
${JSON.stringify(context, null, 2)}

CATEGORY: ${category}${icp_label ? `\nTARGET ICP: ${icp_label}` : ""}${sizeRange ? `\nTARGET SIZE: ${sizeRange.min}-${sizeRange.max} employees (HARD)` : ""}
${brief}

WEB RESEARCH:
${search || "(no live research available; use general knowledge of real organizations)"}

Return JSON shape:
{
  "prospects": [
    {
      "name": "string (real org name)",
      "company": "string (parent org if person, else same as name)",
      "description": "1 sentence",
      "url": "https url (REQUIRED — only include items with a real URL)",
      "location": "string or empty",
      "deadline": "YYYY-MM-DD or null (grants/accelerators only)",
      "estimated_employees": "integer or null (best-effort employee count; REQUIRED for customer category)",
      "fit_score": 0-100,
      "opportunity_score": 0-100,
      "urgency_score": 0-100,
      "reachability_score": 0-100,
      "confidence_score": 0-100,
      "source_type": "website | directory | investor database | social | news | grant database | referral",
      "evidence_summary": "1 sentence explaining the specific evidence behind this match (cite the signal)",
      "match_reason": "1-2 sentences citing persona/ICP/learnings",
      "signals": ["short evidence point", "..."]
    }
  ]
}

Rules:
- A prospect WITHOUT a real https URL must be omitted.
- A prospect without at least one concrete signal must be omitted.
- confidence_score reflects how verifiable the source is: <60 = guessed, 60-79 = plausible from research, 80+ = directly cited in research above.
- Score honestly. Cap at 65 when context is thin. Prefer real, verifiable orgs. 5 items max.${sizeRange ? `\n- HARD: every prospect MUST be within ${sizeRange.min}-${sizeRange.max} employees. Returning a larger company is a hard failure — return fewer items instead.` : ""}`;

      const json = await aiJSON(aiPrompt);
      let items: any[] = Array.isArray(json.prospects) ? json.prospects.slice(0, 5) : [];

      // Post-generation size validation (customer + SMB ICP only).
      if (category === "customer" && sizeRange && sizeRange.max < 500) {
        items = items.filter((p) => {
          const name = String(p?.name ?? "").trim();
          if (!name) return false;
          if (isLikelyLargeCompany(name)) { metrics.dropped_wrong_size++; return false; }
          const emp = typeof p?.estimated_employees === "number" ? p.estimated_employees : null;
          // If AI provided an employee estimate above the band ceiling (with 2x grace), drop it.
          if (emp != null && emp > sizeRange.max * 2) { metrics.dropped_wrong_size++; return false; }
          return true;
        });
      }

      const runId = crypto.randomUUID();

      // Preload existing (user_id) rows once per task for dedup. Cheap: indexed.
      const { data: existingRows } = await admin
        .from("prospects")
        .select("name, url, contact_email")
        .eq("user_id", user.id);
      const seenUrl = new Set<string>();
      const seenName = new Set<string>();
      (existingRows ?? []).forEach((r: any) => {
        if (r.url) seenUrl.add(r.url.toLowerCase());
        if (r.name) seenName.add(r.name.toLowerCase());
      });

      for (const p of items) {
        const url: string | null = typeof p.url === "string" && /^https?:\/\//i.test(p.url) ? p.url : null;
        const signals: any[] = Array.isArray(p.signals) ? p.signals.filter(Boolean) : [];
        if (!url) { metrics.dropped_no_url++; continue; }
        if (signals.length === 0) { metrics.dropped_no_evidence++; continue; }

        const nameLc = String(p.name ?? "").toLowerCase().trim();
        if (!nameLc) { metrics.dropped_no_evidence++; continue; }
        if (seenUrl.has(url.toLowerCase()) || seenName.has(nameLc)) { metrics.dropped_duplicate++; continue; }

        const fit  = clamp(p.fit_score ?? 50);
        const opp  = clamp(p.opportunity_score ?? 50);
        const urg  = clamp(p.urgency_score ?? 50);
        const reach= clamp(p.reachability_score ?? 50);
        const conf = clamp(p.confidence_score ?? (search ? 70 : 55));
        const overall = clamp(fit * 0.4 + opp * 0.3 + urg * 0.15 + reach * 0.15);
        const status = conf >= 80 ? "saved" : conf >= 60 ? "new" : "low_confidence";
        const stage  = conf >= 80 ? "saved" : "new";

        if (conf < 60) metrics.low_confidence++;

        const sourceType = typeof p.source_type === "string"
          ? p.source_type.toLowerCase().slice(0, 40)
          : (search ? "directory" : "ai");

        const { data: row, error } = await admin
          .from("prospects")
          .insert({
            user_id: user.id,
            app_id: appId ?? null,
            category,
            matched_icp_id,
            name: String(p.name ?? "Unnamed").slice(0, 200),
            description: p.description ?? null,
            url,
            location: p.location ?? null,
            deadline: p.deadline || null,
            fit_score: fit,
            opportunity_score: opp,
            urgency_score: urg,
            reachability_score: reach,
            prospect_score: overall,
            source_confidence: conf,
            match_reason: p.match_reason ?? null,
            evidence_summary: p.evidence_summary ?? null,
            signals,
            evidence: {
              context_size: context.conversions,
              has_web: !!search,
              run_id: runId,
              icp_label,
              size_range: sizeRange,
              estimated_employees: typeof p.estimated_employees === "number" ? p.estimated_employees : null,
            },
            source: search ? "perplexity+ai" : "ai_only",
            source_type: sourceType,
            stage,
            status,
            discovery_run_id: runId,
          })
          .select()
          .single();
        if (!error && row) {
          created.push(row);
          seenUrl.add(url.toLowerCase());
          seenName.add(nameLc);
          metrics.confidence_sum += conf;
          metrics.confidence_count++;
        }
      }
    }

    const avgConfidence = metrics.confidence_count > 0
      ? Math.round(metrics.confidence_sum / metrics.confidence_count)
      : 0;

    return new Response(JSON.stringify({
      created: created.length,
      prospects: created,
      metrics: {
        created: created.length,
        dropped_no_url: metrics.dropped_no_url,
        dropped_no_evidence: metrics.dropped_no_evidence,
        dropped_duplicate: metrics.dropped_duplicate,
        dropped_wrong_size: metrics.dropped_wrong_size,
        low_confidence: metrics.low_confidence,
        average_confidence: avgConfidence,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("discover-prospects", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
