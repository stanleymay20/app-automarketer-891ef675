import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REMEDIATION: Record<string, string> = {
  token_expired: "Reconnect the platform account in Settings → Connections.",
  account_no_credits: "Top up the platform API credits (e.g. X paid tier).",
  content_too_long: "Shorten post to fit platform limits before re-queueing.",
  rate_limit: "Auto-retry will pick this up on the next publish cycle.",
  platform_5xx: "Transient platform error — auto-retry on next cycle.",
  validation: "Post failed pre-flight validation (length, missing media).",
  no_connection: "Connect the platform in Settings before scheduling posts.",
  platform_error: "Inspect the raw error string for platform-specific guidance.",
  unknown: "No failure reason captured — investigate logs.",
};

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

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: rows, error } = await admin
      .from("content")
      .select("id, platform, failure_category, failure_reason, created_at")
      .eq("user_id", user.id)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw error;

    const total = rows?.length ?? 0;
    const buckets = new Map<string, { count: number; reasons: Map<string, number>; samples: string[]; platforms: Set<string> }>();
    for (const r of rows ?? []) {
      const cat = (r.failure_category as string) || "unknown";
      const b = buckets.get(cat) ?? { count: 0, reasons: new Map(), samples: [], platforms: new Set() };
      b.count++;
      const reason = (r.failure_reason as string) ?? "(no reason)";
      b.reasons.set(reason, (b.reasons.get(reason) ?? 0) + 1);
      if (b.samples.length < 3) b.samples.push(r.id as string);
      if (r.platform) b.platforms.add(r.platform as string);
      buckets.set(cat, b);
    }

    const groups = Array.from(buckets.entries())
      .map(([category, b]) => {
        const topReason = Array.from(b.reasons.entries()).sort((a, z) => z[1] - a[1])[0]?.[0] ?? null;
        return {
          category,
          count: b.count,
          pct: total ? Math.round((b.count / total) * 1000) / 10 : 0,
          platforms: Array.from(b.platforms),
          top_reason: topReason,
          sample_ids: b.samples,
          remediation: REMEDIATION[category] ?? "Investigate logs.",
        };
      })
      .sort((a, z) => z.count - a.count)
      .slice(0, 20);

    return new Response(JSON.stringify({ total_failed: total, groups }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("analyze-publish-failures", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
