import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Decay first (cheap)
    await admin.rpc("decay_distribution_recommendations").catch((e) => console.warn("decay error", e));

    // Find distinct (user_id, app_id) pairs whose latest target is >7 days old
    const { data: stale } = await admin
      .from("distribution_targets")
      .select("user_id, app_id, updated_at")
      .lt("updated_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
      .order("updated_at", { ascending: true })
      .limit(500);

    const seen = new Set<string>();
    const pairs: { user_id: string; app_id: string | null }[] = [];
    for (const r of stale ?? []) {
      const k = `${r.user_id}|${r.app_id ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push({ user_id: r.user_id, app_id: r.app_id });
    }

    let invoked = 0;
    for (const p of pairs.slice(0, 25)) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/discover-distribution`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ internal_user_id: p.user_id, internal_app_id: p.app_id }),
        });
        if (res.ok) invoked++;
      } catch (e) { console.warn("rediscover invoke failed", e); }
    }

    return new Response(JSON.stringify({ pairs: pairs.length, invoked }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("rediscover-distribution", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
