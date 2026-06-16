import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature",
};

// Constant-time hex compare
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
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
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// POST body: { email, amount, currency?, notes?, slug? }
// Required header: X-Signature: sha256=<hex hmac of raw body using CONVERSION_WEBHOOK_SECRET>
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const secret = Deno.env.get("CONVERSION_WEBHOOK_SECRET");
    if (!secret) {
      return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await req.text();
    const sigHeader = req.headers.get("x-signature") || req.headers.get("X-Signature") || "";
    const provided = sigHeader.startsWith("sha256=") ? sigHeader.slice(7) : sigHeader;
    if (!provided) {
      return new Response(JSON.stringify({ error: "Missing X-Signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const expected = await hmacSha256Hex(secret, raw);
    if (!timingSafeEqualHex(provided.toLowerCase(), expected)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any;
    try { body = JSON.parse(raw); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = (body.email || "").toString().trim().toLowerCase();
    const amount = Number(body.amount || 0);
    const currency = (body.currency || "USD").toString().toUpperCase().slice(0, 8);
    const notes = body.notes ? String(body.notes).slice(0, 1000) : null;
    const slug = body.slug ? String(body.slug).slice(0, 200) : null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !isFinite(amount) || amount < 0) {
      return new Response(JSON.stringify({ error: "valid email and non-negative amount required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let appId: string | null = null;
    if (slug) {
      const { data: app } = await supabase
        .from("apps").select("id").eq("landing_slug", slug).maybeSingle();
      appId = app?.id || null;
    }

    const leadQuery = supabase
      .from("leads")
      .select("id, user_id, app_id, source_content_id")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1);
    if (appId) leadQuery.eq("app_id", appId);

    const { data: leads } = await leadQuery;
    const lead = leads?.[0];

    if (!lead) {
      return new Response(JSON.stringify({ error: "no matching lead" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conv, error } = await supabase.from("conversions").insert({
      user_id: lead.user_id,
      lead_id: lead.id,
      app_id: lead.app_id,
      source_content_id: lead.source_content_id,
      amount,
      currency,
      source: "webhook",
      notes,
    }).select().single();
    if (error) throw error;

    await supabase.from("leads")
      .update({ status: "converted", lead_score: 100 })
      .eq("id", lead.id);

    return new Response(JSON.stringify({ ok: true, conversion_id: conv.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("conversion-webhook error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
