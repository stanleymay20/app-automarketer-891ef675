// Generates personalized Letter-of-Intent email drafts for up to N prospects.
//
// SAFETY: This function NEVER sends email. Every row is inserted into
// prospect_messages with status='pending_approval'. Sending requires the
// existing send-outreach function with `approved: true`, per the project's
// hard approval gate.
//
// Inputs:
//   { app_id?: string, target_count?: number (default 200, capped at 200),
//     category?: 'customer' | 'partner' | 'investor' | 'grant' | 'community' }
//
// Behaviour:
//   1) Pulls eligible prospects for the user: matching category, has
//      contact_email, has no prior prospect_messages row, status != dismissed.
//   2) For each (up to target_count), calls the Lovable AI gateway to draft
//      a personalized email + subject grounded in the prospect's evidence
//      and the user's offering.
//   3) Inserts drafts into prospect_messages with status='pending_approval'.
//
// Returns metrics: { eligible, drafted, skipped, errors }.

import {
  handlePreflight,
  requireUser,
  adminClient,
  checkRateLimit,
  jsonResponse,
  errorResponse,
  safeJson,
} from "../_shared/guard.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const MAX_TARGET = 200;
const ALLOWED_CATEGORIES = new Set([
  "customer",
  "partner",
  "investor",
  "grant",
  "community",
]);

interface BulkBody {
  app_id?: string;
  target_count?: number;
  category?: string;
}

interface ProspectRow {
  id: string;
  name: string | null;
  description: string | null;
  url: string | null;
  contact_email: string | null;
  contact_name: string | null;
  category: string;
  match_reason: string | null;
  evidence_summary: string | null;
  signals: unknown;
}

interface AppContext {
  productName: string;
  productDescription: string;
  audience: string;
  goal: string;
  websiteUrl: string;
  senderName: string;
}

interface AiDraft {
  subject: string;
  body: string;
}

function safeFirstName(contactName: string | null, email: string | null): string {
  if (contactName) {
    const first = contactName.trim().split(/\s+/)[0];
    if (first) return first;
  }
  if (email) {
    const local = email.split("@")[0] ?? "";
    const cleaned = local.replace(/[._-]+/g, " ").trim();
    if (cleaned) {
      return cleaned
        .split(/\s+/)[0]
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return "there";
}

async function aiDraftLoi(
  prospect: ProspectRow,
  app: AppContext,
): Promise<AiDraft> {
  const signalsText = Array.isArray(prospect.signals)
    ? (prospect.signals as unknown[])
        .map((s) => (typeof s === "string" ? s : JSON.stringify(s)))
        .filter(Boolean)
        .slice(0, 5)
        .join("; ")
    : "";

  const firstName = safeFirstName(prospect.contact_name, prospect.contact_email);

  const prompt = `You are drafting a single short outbound email + non-binding Letter of Intent ask. Output STRICT JSON only.

OFFERING:
- Name: ${app.productName}
- One-liner: ${app.productDescription}
- Audience: ${app.audience}
- Primary goal: ${app.goal}
- Website: ${app.websiteUrl}
- Sender: ${app.senderName}

PROSPECT:
- Company: ${prospect.name ?? "(unknown)"}
- Recipient first name: ${firstName}
- Category: ${prospect.category}
- About: ${prospect.description ?? "(none)"}
- URL: ${prospect.url ?? ""}
- Why they may fit: ${prospect.match_reason ?? prospect.evidence_summary ?? ""}
- Signals: ${signalsText || "(none)"}

INSTRUCTIONS:
- One short cold email, plain text, 110-160 words.
- Open with one specific, evidence-grounded reason this company / person was chosen (cite a signal if available). Do not invent facts.
- Briefly state what the offering does and the concrete pain it solves for this audience.
- Ask for either (a) a 15-minute discovery call, OR (b) willingness to sign a short non-binding Letter of Intent supporting the work. Frame the LOI as non-binding and explicitly state it creates no purchase obligation.
- Polite, direct, no hype. No emojis. No fake urgency. No claims of prior contact.
- Subject line: under 60 chars, specific to their context, not clickbait.
- Sign-off uses "${app.senderName}".

Return JSON exactly:
{ "subject": "string", "body": "string with \\n line breaks" }`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You return ONLY valid JSON. No prose, no markdown fences." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = await res.json();
  const text = (j.choices?.[0]?.message?.content ?? "").replace(/```json|```/g, "").trim();
  let parsed: Partial<AiDraft> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  }
  const subject = String(parsed.subject ?? "").trim();
  const body = String(parsed.body ?? "").trim();
  if (!subject || body.length < 40) {
    throw new Error("AI returned an empty or too-short draft");
  }
  return { subject: subject.slice(0, 180), body };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    // Conservative rate limit: bulk drafting is expensive (200 LLM calls).
    const rl = await checkRateLimit(auth.id, "bulk-loi-outreach", 2, 600);
    if (rl) return rl;

    const body = await safeJson<BulkBody>(req);
    const targetCount = Math.max(1, Math.min(MAX_TARGET, Number(body.target_count ?? MAX_TARGET) | 0));
    const category = ALLOWED_CATEGORIES.has(String(body.category ?? ""))
      ? String(body.category)
      : "customer";
    const appId = typeof body.app_id === "string" && body.app_id ? body.app_id : null;

    const admin = adminClient();

    // Load offering context (best-effort) from the user's primary app.
    let app: AppContext = {
      productName: "our product",
      productDescription: "",
      audience: "founders and operators",
      goal: "evaluate pilot interest",
      websiteUrl: "",
      senderName: auth.email?.split("@")[0] ?? "the founder",
    };
    {
      let appRow: Record<string, unknown> | null = null;
      if (appId) {
        const { data } = await admin
          .from("apps").select("*").eq("id", appId).eq("user_id", auth.id).maybeSingle();
        appRow = data ?? null;
      }
      if (!appRow) {
        const { data } = await admin
          .from("apps").select("*").eq("user_id", auth.id)
          .order("created_at", { ascending: true }).limit(1).maybeSingle();
        appRow = data ?? null;
      }
      if (appRow) {
        app = {
          productName: String(appRow.name ?? app.productName),
          productDescription: String(appRow.description ?? ""),
          audience: String(appRow.target_audience ?? app.audience),
          goal: String(appRow.primary_goal ?? app.goal),
          websiteUrl: String(appRow.website_url ?? ""),
          senderName: app.senderName,
        };
      }
    }

    // Eligible prospects: have an email, in the requested category, not dismissed,
    // and never previously drafted/sent. Newest-first, capped at target_count.
    const { data: drafted, error: draftedErr } = await admin
      .from("prospect_messages")
      .select("prospect_id")
      .eq("user_id", auth.id);
    if (draftedErr) throw draftedErr;
    const draftedSet = new Set<string>((drafted ?? []).map((r: { prospect_id: string }) => r.prospect_id));

    const prospectQuery = admin
      .from("prospects")
      .select("id,name,description,url,contact_email,contact_name,category,match_reason,evidence_summary,signals,status")
      .eq("user_id", auth.id)
      .eq("category", category)
      .not("contact_email", "is", null)
      .neq("status", "dismissed")
      .order("prospect_score", { ascending: false })
      .limit(targetCount + draftedSet.size + 50);
    if (appId) prospectQuery.eq("app_id", appId);
    const { data: candidates, error: candErr } = await prospectQuery;
    if (candErr) throw candErr;

    const eligible: ProspectRow[] = (candidates ?? [])
      .filter((p: ProspectRow) => p.contact_email && !draftedSet.has(p.id))
      .slice(0, targetCount);

    if (eligible.length === 0) {
      return jsonResponse({
        ok: true,
        eligible: 0,
        drafted: 0,
        skipped: 0,
        errors: 0,
        message:
          "No eligible prospects (need category match, contact_email, and no prior message). Run discover-prospects first, then retry.",
      });
    }

    let draftedCount = 0;
    let errorCount = 0;
    const errors: { prospect_id: string; error: string }[] = [];

    // Sequential to respect AI gateway quotas; 200 calls is fine within a function timeout
    // if each completes quickly. Keep timing in mind — caller may need to retry.
    for (const p of eligible) {
      try {
        const draft = await aiDraftLoi(p, app);
        const { error: insErr } = await admin.from("prospect_messages").insert({
          user_id: auth.id,
          prospect_id: p.id,
          channel: "email",
          subject: draft.subject,
          body: draft.body,
          from_address: null,
          to_address: p.contact_email!,
          provider: "resend",
          status: "pending_approval",
          metadata: {
            generator: "bulk-loi-outreach",
            generated_at: new Date().toISOString(),
            category: p.category,
          },
        });
        if (insErr) {
          errorCount++;
          errors.push({ prospect_id: p.id, error: insErr.message });
        } else {
          draftedCount++;
        }
      } catch (e) {
        errorCount++;
        errors.push({ prospect_id: p.id, error: (e as Error).message });
      }
    }

    return jsonResponse({
      ok: true,
      eligible: eligible.length,
      drafted: draftedCount,
      skipped: eligible.length - draftedCount - errorCount,
      errors: errorCount,
      error_samples: errors.slice(0, 5),
      note: "All drafts are pending_approval. No emails were sent.",
    });
  } catch (e) {
    console.error("bulk-loi-outreach", e);
    return errorResponse((e as Error).message || "Unknown error", 500);
  }
});
