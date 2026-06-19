// gmail-check-replies — cron/service-role only.
// For each user with gmail_reply_sync_enabled=true and the project Gmail
// Standard Connector linked, scan recent inbox messages and write inbound
// prospect replies (matched by sender email -> prospects.contact_email).
//
// Read-only against Gmail; uses gmail.readonly scope. Never sends.
// Inserts go through prospect_replies; the on_prospect_reply_inbound trigger
// advances the prospect stage and pauses scheduled sequences — same path as
// record-reply uses for manual entries.
import {
  adminClient,
  corsHeaders,
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireCron,
  safeJson,
} from "../_shared/guard.ts";

const GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GMAIL_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY");
const RULE_VERSION = "gmail-reply-sync-v1";

interface UserSetting {
  user_id: string;
  gmail_reply_sync_enabled: boolean;
  gmail_last_synced_at: string | null;
}

function gmailHeaders() {
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GMAIL_KEY!,
    "Content-Type": "application/json",
  };
}

// Extract a plain email from a "Name <email@x.com>" string.
function parseEmail(headerValue: string | null): { email: string | null; name: string | null } {
  if (!headerValue) return { email: null, name: null };
  const m = headerValue.match(/^\s*(?:"?([^"<]*?)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?\s*$/);
  if (!m) return { email: null, name: null };
  return { email: (m[2] || "").toLowerCase(), name: (m[1] || "").trim() || null };
}

function headerOf(headers: Array<{ name: string; value: string }>, name: string): string | null {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

// Walk Gmail payload to find the first text/plain body, falling back to text/html stripped.
function extractBody(payload: any): string {
  if (!payload) return "";
  const parts: any[] = [];
  const stack = [payload];
  while (stack.length) {
    const p = stack.pop();
    if (!p) continue;
    if (p.parts) for (const c of p.parts) stack.push(c);
    else parts.push(p);
  }
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  const pick = plain ?? html;
  if (!pick?.body?.data) return "";
  try {
    const b64 = pick.body.data.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    const text = pick.mimeType === "text/html" ? raw.replace(/<[^>]+>/g, " ") : raw;
    return text.replace(/\s+\n/g, "\n").trim().slice(0, 20_000);
  } catch {
    return "";
  }
}

async function syncUser(setting: UserSetting): Promise<{ ok: boolean; scanned: number; matched: number; recorded: number; deduped: number; errors: string[] }> {
  const admin = adminClient();
  const userId = setting.user_id;
  const result = { ok: true, scanned: 0, matched: 0, recorded: 0, deduped: 0, errors: [] as string[] };

  // Determine fetch window: since last sync, capped at 7 days, min 2 days back.
  const sinceMs = setting.gmail_last_synced_at
    ? Math.max(Date.now() - 7 * 86_400_000, new Date(setting.gmail_last_synced_at).getTime() - 2 * 86_400_000)
    : Date.now() - 2 * 86_400_000;
  const afterSec = Math.floor(sinceMs / 1000);

  // 1) List recent inbox messages
  const q = encodeURIComponent(`in:inbox -from:me after:${afterSec}`);
  const listRes = await fetch(`${GATEWAY}/users/me/messages?maxResults=50&q=${q}`, { headers: gmailHeaders() });
  if (!listRes.ok) {
    const body = await listRes.text();
    result.ok = false;
    result.errors.push(`list ${listRes.status}: ${body.slice(0, 300)}`);
    return result;
  }
  const listJson = await listRes.json();
  const ids: string[] = (listJson.messages ?? []).map((m: any) => m.id);
  result.scanned = ids.length;
  if (ids.length === 0) return result;

  // 2) Pre-load this user's prospect emails so we can match locally
  const { data: prospects } = await admin
    .from("prospects")
    .select("id, contact_email")
    .eq("user_id", userId)
    .not("contact_email", "is", null);

  const byEmail = new Map<string, string>();
  for (const p of (prospects ?? []) as Array<{ id: string; contact_email: string }>) {
    if (p.contact_email) byEmail.set(p.contact_email.toLowerCase().trim(), p.id);
  }
  if (byEmail.size === 0) return result;

  // 3) For each message, fetch metadata first (cheap), match, then fetch full body if needed
  for (const id of ids) {
    try {
      const metaRes = await fetch(
        `${GATEWAY}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`,
        { headers: gmailHeaders() },
      );
      if (!metaRes.ok) {
        result.errors.push(`meta ${id} ${metaRes.status}`);
        continue;
      }
      const meta = await metaRes.json();
      const headers = meta.payload?.headers ?? [];
      const fromRaw = headerOf(headers, "From");
      const subject = headerOf(headers, "Subject");
      const dateHeader = headerOf(headers, "Date");
      const messageIdHeader = headerOf(headers, "Message-ID") || headerOf(headers, "Message-Id");
      const { email: fromEmail, name: fromName } = parseEmail(fromRaw);
      if (!fromEmail) continue;
      const prospectId = byEmail.get(fromEmail);
      if (!prospectId) continue;
      result.matched++;

      // Full body fetch only when matched
      const fullRes = await fetch(`${GATEWAY}/users/me/messages/${id}?format=full`, { headers: gmailHeaders() });
      let body = "";
      if (fullRes.ok) {
        const full = await fullRes.json();
        body = extractBody(full.payload) || meta.snippet || "";
      } else {
        body = meta.snippet || "";
      }

      const external_id = `gmail:${id}`; // unique key inside source='gmail'
      const received_at = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

      const { error } = await admin.from("prospect_replies").insert({
        user_id: userId,
        prospect_id: prospectId,
        channel: "email",
        direction: "inbound",
        source: "gmail",
        from_address: fromEmail,
        from_name: fromName,
        subject,
        body: body.slice(0, 20_000) || "(empty)",
        received_at,
        external_id,
        metadata: {
          gmail_message_id: id,
          rfc_message_id: messageIdHeader,
          thread_id: meta.threadId ?? null,
          label_ids: meta.labelIds ?? [],
          synced_by: "gmail-check-replies",
        },
      });

      if (error) {
        if (
          String(error.message).includes("prospect_replies_source_external_uq") ||
          String(error.code) === "23505"
        ) {
          result.deduped++;
        } else {
          result.errors.push(`insert ${id}: ${error.message}`);
        }
      } else {
        result.recorded++;
      }
    } catch (e: any) {
      result.errors.push(`msg ${id}: ${e?.message ?? String(e)}`);
    }
  }

  // 4) Bookkeeping + audit
  await admin
    .from("autopilot_settings")
    .update({ gmail_last_synced_at: new Date().toISOString() })
    .eq("user_id", userId);

  try {
    await admin.from("automation_audit_log").insert({
      user_id: userId,
      action_type: "gmail_reply_sync",
      decision: result.errors.length ? "partial" : "ok",
      rule_version: RULE_VERSION,
      context: result,
    });
  } catch { /* audit best-effort */ }

  return result;
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req); if (pf) return pf;
  const cronCheck = requireCron(req); if (cronCheck) return cronCheck;

  if (!LOVABLE_API_KEY) return errorResponse("LOVABLE_API_KEY not configured", 500);
  if (!GMAIL_KEY) {
    return jsonResponse({
      ok: false,
      error: "GOOGLE_MAIL_API_KEY not present — connect the Gmail Standard Connector in Project Settings → Connectors first.",
    }, 200);
  }

  const body = await safeJson<{ user_id?: string }>(req);
  const admin = adminClient();

  let q = admin
    .from("autopilot_settings")
    .select("user_id, gmail_reply_sync_enabled, gmail_last_synced_at")
    .eq("gmail_reply_sync_enabled", true);
  if (body.user_id) q = q.eq("user_id", body.user_id);

  const { data: users, error } = await q.limit(200);
  if (error) return errorResponse(error.message, 500);

  const results: any[] = [];
  for (const u of (users ?? []) as UserSetting[]) {
    try {
      const r = await syncUser(u);
      results.push({ user_id: u.user_id, ...r });
    } catch (e: any) {
      results.push({ user_id: u.user_id, ok: false, errors: [e?.message ?? String(e)] });
    }
  }

  return jsonResponse({ ok: true, processed: results.length, results });
});
