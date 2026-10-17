import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };

const ALLOWED_EVENTS = new Set([
  "book_generated",
  "chapter_completed",
  "quiz_completed",
  "certificate_issued",
  "second_book",
  "upgrade_clicked",
  "paid_conversion",
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function textOrNull(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).slice(0, max);
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const secret = Deno.env.get("PRODUCT_EVENT_INGEST_SECRET");
    const appId = Deno.env.get("SCROLLLIBRARY_APP_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!secret || !appId || !supabaseUrl || !serviceKey) {
      console.error("[ingest-product-event] required server configuration missing");
      return json({ error: "ingest_not_configured" }, 503);
    }

    const raw = await req.text();
    if (raw.length > 32_768) return json({ error: "payload_too_large" }, 413);

    const signatureHeader = req.headers.get("x-signature") ?? "";
    const provided = signatureHeader.startsWith("sha256=")
      ? signatureHeader.slice(7)
      : signatureHeader;

    if (!provided) return json({ error: "missing_signature" }, 401);

    const expected = await hmacSha256Hex(secret, raw);
    if (!timingSafeEqualHex(provided.toLowerCase(), expected)) {
      return json({ error: "invalid_signature" }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const productKey = textOrNull(body.product_key, 64);
    const externalEventId = textOrNull(body.external_event_id, 128);
    const eventType = textOrNull(body.event_type, 64);
    const occurredAtRaw = textOrNull(body.occurred_at, 64);

    if (productKey !== "scrolllibrary") {
      return json({ error: "unsupported_product" }, 400);
    }
    if (!externalEventId || !eventType || !ALLOWED_EVENTS.has(eventType)) {
      return json({ error: "invalid_event" }, 400);
    }

    const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date();
    if (!Number.isFinite(occurredAt.getTime())) {
      return json({ error: "invalid_occurred_at" }, 400);
    }

    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata as Record<string, unknown>
        : {};
    if (JSON.stringify(metadata).length > 8_192) {
      return json({ error: "metadata_too_large" }, 413);
    }

    const attribution =
      body.attribution && typeof body.attribution === "object" && !Array.isArray(body.attribution)
        ? body.attribution as Record<string, unknown>
        : {};

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: app, error: appError } = await supabase
      .from("apps")
      .select("id, user_id")
      .eq("id", appId)
      .maybeSingle();

    if (appError || !app) {
      console.error("[ingest-product-event] configured app not found", appError);
      return json({ error: "configured_app_not_found" }, 503);
    }

    const row = {
      app_id: app.id,
      user_id: app.user_id,
      product_key: productKey,
      external_event_id: externalEventId,
      external_user_key: textOrNull(body.external_user_key, 128),
      session_id: textOrNull(body.session_id, 128),
      event_type: eventType,
      source: textOrNull(attribution.source, 256),
      medium: textOrNull(attribution.medium, 256),
      campaign: textOrNull(attribution.campaign, 256),
      term: textOrNull(attribution.term, 256),
      content: textOrNull(attribution.content, 256),
      referrer: textOrNull(attribution.referrer, 2_048),
      landing_path: textOrNull(attribution.landing_path, 2_048),
      metadata,
      occurred_at: occurredAt.toISOString(),
    };

    const { data: inserted, error } = await supabase
      .from("product_events")
      .insert(row)
      .select("id")
      .single();

    if (error?.code === "23505") {
      return json({ ok: true, duplicate: true });
    }
    if (error) throw error;

    await supabase.from("automation_audit_log").insert({
      user_id: app.user_id,
      action_type: "product_event_ingested",
      entity_type: "product_event",
      entity_id: inserted.id,
      details: {
        product_key: productKey,
        event_type: eventType,
        source: row.source,
        medium: row.medium,
        campaign: row.campaign,
      },
    });

    return json({ ok: true, event_id: inserted.id });
  } catch (error) {
    console.error("[ingest-product-event] fatal", error);
    return json({ error: "internal_error" }, 500);
  }
});
