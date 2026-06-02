// Computes the entire Reality Dashboard payload in one call:
// - Publish SLOs (success rate, latency, recovery)
// - Funnel (clicks → leads → conversions → revenue)
// - Attribution coverage (% of rows linked)
// - Intelligence utilization + health score
// - Adoption (generated vs used)
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

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
    const uid = user.id;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- Publish SLOs ---
    const { data: content } = await db
      .from("content")
      .select("id, status, platform, retry_count, publish_latency_ms, persona_id, distribution_target_id, seed_recommendation_id, campaign_id")
      .eq("user_id", uid)
      .limit(10000);

    const c = content ?? [];
    const total = c.length;
    const published = c.filter((r) => r.status === "published").length;
    const failed = c.filter((r) => r.status === "failed").length;
    const pending = total - published - failed;
    const recovered = c.filter((r) => r.status === "published" && (r.retry_count ?? 0) > 0).length;
    const latencies = c.map((r) => r.publish_latency_ms).filter((x): x is number => typeof x === "number" && x > 0);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
    const successRate = pct(published, published + failed);

    // Fix 3: per-platform breakdown so 100% LinkedIn isn't dragged down by 0% X.
    const byPlatformMap = new Map<string, { published: number; failed: number }>();
    for (const r of c) {
      const plat = (r.platform || "unknown").toLowerCase().replace("x (twitter)", "x").replace("twitter", "x");
      const slot = byPlatformMap.get(plat) ?? { published: 0, failed: 0 };
      if (r.status === "published") slot.published += 1;
      else if (r.status === "failed") slot.failed += 1;
      byPlatformMap.set(plat, slot);
    }
    const byPlatform = Array.from(byPlatformMap.entries())
      .map(([platform, v]) => ({
        platform,
        published: v.published,
        failed: v.failed,
        success_rate: pct(v.published, v.published + v.failed),
      }))
      .sort((a, b) => (b.published + b.failed) - (a.published + a.failed));

    // --- Attribution coverage ---
    const contentToPersona = pct(c.filter((r) => r.persona_id).length, total);
    const contentToDistribution = pct(c.filter((r) => r.distribution_target_id).length, total);
    const contentToRecommendation = pct(c.filter((r) => r.seed_recommendation_id).length, total);
    const contentToCampaign = pct(c.filter((r) => r.campaign_id).length, total);

    const [{ count: leadsTotal }, { count: leadsLinked }, { count: convTotal }, { count: convLinked }] = await Promise.all([
      db.from("leads").select("*", { count: "exact", head: true }).eq("user_id", uid),
      db.from("leads").select("*", { count: "exact", head: true }).eq("user_id", uid).not("source_content_id", "is", null),
      db.from("conversions").select("*", { count: "exact", head: true }).eq("user_id", uid),
      db.from("conversions").select("*", { count: "exact", head: true }).eq("user_id", uid).not("source_content_id", "is", null),
    ]);
    const leadsToContent = pct(leadsLinked ?? 0, leadsTotal ?? 0);
    const revenueToContent = pct(convLinked ?? 0, convTotal ?? 0);

    // --- Funnel ---
    const [{ count: clicksCount }, { data: convRows }] = await Promise.all([
      db.from("click_events").select("*", { count: "exact", head: true }).eq("user_id", uid),
      db.from("conversions").select("amount").eq("user_id", uid),
    ]);
    const revenue = (convRows ?? []).reduce((s, r: any) => s + Number(r.amount ?? 0), 0);

    // --- Intelligence utilization (rows + last activity) ---
    const engineSpecs: { key: string; table: string; label: string; tsCol?: string }[] = [
      { key: "audience", table: "personas", label: "Audience (personas)" },
      { key: "distribution", table: "distribution_targets", label: "Distribution targets" },
      { key: "prospects", table: "prospects", label: "Prospects" },
      { key: "signals", table: "market_signals", label: "Market signals" },
      { key: "portfolio", table: "portfolio_snapshots", label: "Content portfolio", tsCol: "computed_at" },
      { key: "grants", table: "grants", label: "Grants" },
      { key: "campaigns", table: "campaigns", label: "Campaigns" },
      { key: "recommendations", table: "growth_recommendations", label: "Recommendations" },
    ];

    const engines = await Promise.all(
      engineSpecs.map(async (e) => {
        const ts = e.tsCol ?? "created_at";
        const { count } = await db.from(e.table).select("*", { count: "exact", head: true }).eq("user_id", uid);
        const { data: last } = await db.from(e.table).select(ts).eq("user_id", uid).order(ts, { ascending: false }).limit(1).maybeSingle();
        return {
          key: e.key,
          label: e.label,
          rows: count ?? 0,
          last_activity: (last as any)?.[ts] ?? null,
        };
      })
    );

    // --- Adoption (generated vs used) ---
    const [{ count: campaignsTotal }, { count: campaignsUsed }, { count: distGen }, { count: distUsed }, { count: recsTotal }, { count: recsExec }] = await Promise.all([
      db.from("campaigns").select("*", { count: "exact", head: true }).eq("user_id", uid),
      db.from("campaigns").select("*", { count: "exact", head: true }).eq("user_id", uid).eq("active", true),
      db.from("distribution_targets").select("*", { count: "exact", head: true }).eq("user_id", uid),
      db.from("distribution_targets").select("*", { count: "exact", head: true }).eq("user_id", uid).in("status", ["active", "contacted", "converted"]),
      db.from("growth_recommendations").select("*", { count: "exact", head: true }).eq("user_id", uid),
      db.from("growth_recommendations").select("*", { count: "exact", head: true }).eq("user_id", uid).in("status", ["generated", "accepted"]),
    ]);

    const { count: personasTotal } = await db.from("personas").select("*", { count: "exact", head: true }).eq("user_id", uid);
    const personasUsed = new Set(c.filter((r) => r.persona_id).map((r) => r.persona_id)).size;

    const adoption = [
      { name: "Audience (personas)", generated: personasTotal ?? 0, used: personasUsed },
      { name: "Campaigns", generated: campaignsTotal ?? 0, used: campaignsUsed ?? 0 },
      { name: "Distribution targets", generated: distGen ?? 0, used: distUsed ?? 0 },
      { name: "Recommendations", generated: recsTotal ?? 0, used: recsExec ?? 0 },
    ];

    // --- Health score (0-100) ---
    // 25% engines active (rows > 0), 25% recent activity (<7d), 25% attribution avg, 25% adoption avg
    const enginesActive = engines.filter((e) => e.rows > 0).length;
    const enginesScore = pct(enginesActive, engines.length);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentScore = pct(engines.filter((e) => e.last_activity && new Date(e.last_activity).getTime() > weekAgo).length, engines.length);
    const attrScore = (contentToPersona + contentToDistribution + contentToCampaign + leadsToContent + revenueToContent) / 5;
    const adoptionScore =
      adoption.reduce((s, a) => s + pct(a.used, a.generated), 0) / Math.max(adoption.length, 1);
    const healthScore = Math.round(0.25 * enginesScore + 0.25 * recentScore + 0.25 * attrScore + 0.25 * adoptionScore);

    return new Response(
      JSON.stringify({
        publish: {
          total,
          published,
          failed,
          pending,
          success_rate: successRate,
          avg_latency_ms: avgLatency,
          recovered_by_retry: recovered,
          by_platform: byPlatform,
        },
        funnel: {
          clicks: clicksCount ?? 0,
          leads: leadsTotal ?? 0,
          conversions: convTotal ?? 0,
          revenue,
        },
        attribution: {
          content_to_persona: contentToPersona,
          content_to_distribution: contentToDistribution,
          content_to_campaign: contentToCampaign,
          content_to_recommendation: contentToRecommendation,
          leads_to_content: leadsToContent,
          revenue_to_content: revenueToContent,
        },
        engines,
        adoption,
        health_score: healthScore,
        health_breakdown: {
          engines_active: Math.round(enginesScore),
          recent_activity: Math.round(recentScore),
          attribution: Math.round(attrScore),
          adoption: Math.round(adoptionScore),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("reality-snapshot", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
