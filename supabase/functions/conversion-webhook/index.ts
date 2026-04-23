import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// POST body: { email, amount, currency?, notes?, slug? }
// Matches most-recent lead by email (scoped to slug if provided).
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const email = (body.email || "").toString().trim().toLowerCase();
    const amount = Number(body.amount || 0);
    const currency = (body.currency || "USD").toString().toUpperCase();
    const notes = body.notes ? String(body.notes) : null;
    const slug = body.slug ? String(body.slug) : null;

    if (!email || !isFinite(amount)) {
      return new Response(JSON.stringify({ error: "email and amount required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve app (optional) then find matching lead
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
