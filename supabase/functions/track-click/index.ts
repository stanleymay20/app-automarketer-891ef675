import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    // Path: /track-click/<content_id>
    const parts = url.pathname.split("/").filter(Boolean);
    const contentId = parts[parts.length - 1];

    if (!contentId || contentId === "track-click") {
      return new Response("Missing content id", { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch content to resolve app + user + landing slug
    const { data: content } = await supabase
      .from("content")
      .select("id, app_id, user_id, apps:app_id(landing_slug, landing_enabled)")
      .eq("id", contentId)
      .maybeSingle();

    if (!content) {
      return new Response("Not found", { status: 404, headers: corsHeaders });
    }

    // Record click (fire and forget)
    const ua = req.headers.get("user-agent") || null;
    const referrer = req.headers.get("referer") || null;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    // simple non-crypto hash
    let ipHash: string | null = null;
    if (ip) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
      ipHash = Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    supabase.from("click_events").insert({
      content_id: content.id,
      app_id: content.app_id,
      user_id: content.user_id,
      user_agent: ua,
      referrer,
      ip_hash: ipHash,
    }).then(() => {});

    // Also bump the content.clicks counter
    supabase.rpc as unknown; // not using rpc; do manual increment via select+update
    supabase
      .from("content")
      .select("clicks")
      .eq("id", content.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          supabase.from("content").update({ clicks: (data.clicks || 0) + 1 }).eq("id", content.id).then(() => {});
        }
      });

    // Resolve redirect target
    const appUrl = Deno.env.get("APP_URL") || "https://app-automarketer.lovable.app";
    const slug = (content.apps as any)?.landing_slug;
    const enabled = (content.apps as any)?.landing_enabled;
    const target = slug && enabled
      ? `${appUrl}/lp/${slug}?c=${content.id}`
      : appUrl;

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: target },
    });
  } catch (err) {
    console.error("track-click error:", err);
    return new Response("Error", { status: 500, headers: corsHeaders });
  }
});
