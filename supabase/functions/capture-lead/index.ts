import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { slug, email, name, source_content_id, platform } = await req.json();

    if (!slug || !email) {
      return new Response(JSON.stringify({ error: "slug and email required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return new Response(JSON.stringify({ error: "invalid email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: app } = await supabase
      .from("apps")
      .select("id, user_id, landing_enabled")
      .eq("landing_slug", slug)
      .maybeSingle();

    if (!app || !app.landing_enabled) {
      return new Response(JSON.stringify({ error: "app not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Score: base 50, +15 if came from a tracked post, +10 if name provided
    let score = 50;
    if (source_content_id) score += 15;
    if (name && name.trim().length > 1) score += 10;

    const { data: lead, error } = await supabase
      .from("leads")
      .insert({
        user_id: app.user_id,
        app_id: app.id,
        source_content_id: source_content_id || null,
        email: email.trim().toLowerCase(),
        name: name?.trim() || null,
        platform: platform || null,
        status: "new",
        lead_score: score,
      })
      .select()
      .single();

    if (error) {
      // unique violation = duplicate email per app — treat as success
      if ((error as any).code === "23505") {
        return new Response(JSON.stringify({ ok: true, duplicate: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw error;
    }

    return new Response(JSON.stringify({ ok: true, lead_id: lead.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("capture-lead error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
