// Compute Marketing Intelligence readiness & health score.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const WEIGHTS = {
  spend_coverage: 0.25,
  conversion_coverage: 0.25,
  campaign_mapping: 0.15,
  attribution_coverage: 0.15,
  data_freshness: 0.10,
  connector_reliability: 0.10,
};

const THRESHOLDS = {
  spend_history_days: 30,
  conversions: 100,
  active_channels: 3,
  attribution_coverage: 0.90,
  spend_completeness: 0.95,
  missing_campaign_ids_max: 0.05,
  fit_quality: 0.70,
};

function pct(num: number, den: number) {
  if (!den) return 0;
  return Math.max(0, Math.min(1, num / den));
}

function label(score: number) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Needs Improvement";
  return "Critical";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const url = new URL(req.url);
    const appId = url.searchParams.get("app_id");
    const windowDays = 30;
    const sinceIso = new Date(Date.now() - windowDays * 86400_000).toISOString();
    const sinceDate = sinceIso.slice(0, 10);

    const scope = <T,>(q: T & { eq: any }) => (appId ? q.eq("app_id", appId) : q);

    // Spend
    const spendQ = scope(supabase.from("channel_spend").select("date, channel, normalized_spend, campaign_id"))
      .gte("date", sinceDate);
    const { data: spendRows = [] } = await spendQ;

    const spendDays = new Set((spendRows ?? []).map((r: any) => r.date)).size;
    const activeChannels = new Set((spendRows ?? []).map((r: any) => r.channel)).size;
    const spendRowsWithCampaign = (spendRows ?? []).filter((r: any) => r.campaign_id).length;
    const totalSpendRows = spendRows?.length ?? 0;

    // Conversions
    const convQ = scope(supabase.from("conversions").select("id, distribution_target_id, source_content_id, converted_at, amount"))
      .gte("converted_at", sinceIso);
    const { data: convs = [] } = await convQ;

    const totalConv = convs?.length ?? 0;
    const attributedConv = (convs ?? []).filter((c: any) => c.distribution_target_id || c.source_content_id).length;

    // Content w/ cost
    const contentQ = scope(supabase.from("content").select("id, cost_estimated, published_at"))
      .eq("status", "published")
      .gte("published_at", sinceIso);
    const { data: content = [] } = await contentQ;
    const contentWithCost = (content ?? []).filter((c: any) => Number(c.cost_estimated ?? 0) > 0).length;

    // Platform connections
    const { data: conns = [] } = await supabase.from("platform_connections").select("id, connection_status");
    const connOk = (conns ?? []).filter((c: any) => c.connection_status === "connected").length;
    const connTotal = conns?.length ?? 0;

    // Freshness — latest spend + conversion timestamps
    const latestSpend = (spendRows ?? []).reduce((m: string, r: any) => r.date > m ? r.date : m, "");
    const daysSinceSpend = latestSpend ? Math.floor((Date.now() - new Date(latestSpend).getTime()) / 86400_000) : 999;
    const freshness = daysSinceSpend <= 2 ? 1 : daysSinceSpend <= 7 ? 0.8 : daysSinceSpend <= 14 ? 0.5 : 0.2;

    // Coverage metrics
    const spend_coverage = pct(spendDays, windowDays);
    const conversion_coverage = pct(totalConv, THRESHOLDS.conversions);
    const campaign_mapping = pct(spendRowsWithCampaign, Math.max(totalSpendRows, 1));
    const attribution_coverage = pct(attributedConv, Math.max(totalConv, 1));
    const data_freshness = freshness;
    const connector_reliability = connTotal ? connOk / connTotal : 0;

    const score01 =
      spend_coverage * WEIGHTS.spend_coverage +
      conversion_coverage * WEIGHTS.conversion_coverage +
      campaign_mapping * WEIGHTS.campaign_mapping +
      attribution_coverage * WEIGHTS.attribution_coverage +
      data_freshness * WEIGHTS.data_freshness +
      connector_reliability * WEIGHTS.connector_reliability;

    const score = Math.round(score01 * 100);

    // Gate
    const missingCampaignPct = 1 - campaign_mapping;
    const gates = {
      spend_history_days: { ok: spendDays >= THRESHOLDS.spend_history_days, actual: spendDays, target: THRESHOLDS.spend_history_days },
      conversions: { ok: totalConv >= THRESHOLDS.conversions, actual: totalConv, target: THRESHOLDS.conversions },
      active_channels: { ok: activeChannels >= THRESHOLDS.active_channels, actual: activeChannels, target: THRESHOLDS.active_channels },
      attribution_coverage: { ok: attribution_coverage >= THRESHOLDS.attribution_coverage, actual: Number(attribution_coverage.toFixed(3)), target: THRESHOLDS.attribution_coverage },
      spend_completeness: { ok: spend_coverage >= THRESHOLDS.spend_completeness, actual: Number(spend_coverage.toFixed(3)), target: THRESHOLDS.spend_completeness },
      missing_campaign_ids: { ok: missingCampaignPct <= THRESHOLDS.missing_campaign_ids_max, actual: Number(missingCampaignPct.toFixed(3)), target: THRESHOLDS.missing_campaign_ids_max },
    };
    const mmm_ready = Object.values(gates).every((g) => g.ok);

    // Attribution audit report
    const orphanedConversions = totalConv - attributedConv;
    const spendWithoutCampaign = totalSpendRows - spendRowsWithCampaign;
    const contentWithoutCost = (content?.length ?? 0) - contentWithCost;

    // Estimated days to ready — very rough
    const daysToReady = mmm_ready ? 0 : Math.max(
      THRESHOLDS.spend_history_days - spendDays,
      Math.ceil((THRESHOLDS.conversions - totalConv) / Math.max(totalConv / Math.max(spendDays, 1), 0.5)),
      0
    );

    return new Response(JSON.stringify({
      window_days: windowDays,
      metrics: {
        spend_coverage: Number((spend_coverage * 100).toFixed(1)),
        conversion_coverage: Number((conversion_coverage * 100).toFixed(1)),
        campaign_mapping: Number((campaign_mapping * 100).toFixed(1)),
        attribution_coverage: Number((attribution_coverage * 100).toFixed(1)),
        data_freshness: Number((data_freshness * 100).toFixed(1)),
        connector_reliability: Number((connector_reliability * 100).toFixed(1)),
      },
      totals: {
        spend_days: spendDays,
        active_channels: activeChannels,
        total_spend_rows: totalSpendRows,
        total_conversions: totalConv,
        attributed_conversions: attributedConv,
        content_published: content?.length ?? 0,
        content_with_cost: contentWithCost,
      },
      audit: {
        orphaned_conversions: orphanedConversions,
        spend_without_campaign: spendWithoutCampaign,
        content_without_cost: contentWithoutCost,
        stale_spend_days: daysSinceSpend,
      },
      score,
      label: label(score),
      mmm_ready,
      gates,
      thresholds: THRESHOLDS,
      weights: WEIGHTS,
      estimated_days_to_ready: daysToReady,
      generated_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("marketing-readiness error", e);
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
