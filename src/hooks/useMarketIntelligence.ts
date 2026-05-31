import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const tables = [
  "market_signals",
  "competitor_signals",
  "opportunities",
  "customer_signals",
  "growth_recommendations",
] as const;

export function useMarketIntelligence(appId?: string) {
  return useQuery({
    queryKey: ["market-intelligence", appId ?? "all"],
    queryFn: async () => {
      const fetchTable = async (t: typeof tables[number]) => {
        let q = supabase.from(t).select("*");
        if (appId) q = q.eq("app_id", appId);
        const { data, error } = await q.order("created_at", { ascending: false }).limit(50);
        if (error) throw error;
        return data ?? [];
      };
      const [market, competitors, opportunities, customers, recommendations] = await Promise.all(
        tables.map(fetchTable)
      );

      // Real attribution evidence for display
      const baseFilter = (q: any) => (appId ? q.eq("app_id", appId) : q);
      const [postsRes, clicksRes, leadsRes, convsRes] = await Promise.all([
        baseFilter(supabase.from("content").select("id", { count: "exact", head: true }).eq("status", "published")),
        baseFilter(supabase.from("click_events").select("id", { count: "exact", head: true })),
        baseFilter(supabase.from("leads").select("id", { count: "exact", head: true })),
        baseFilter(supabase.from("conversions").select("amount")),
      ]);
      const evidence = {
        posts_analyzed: postsRes.count ?? 0,
        clicks: clicksRes.count ?? 0,
        leads: leadsRes.count ?? 0,
        conversions: convsRes.data?.length ?? 0,
        revenue: (convsRes.data ?? []).reduce((s: number, c: any) => s + Number(c.amount ?? 0), 0),
      };

      return { market, competitors, opportunities, customers, recommendations, evidence };
    },
  });
}

export function useGenerateGrowthIntelligence() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (appId?: string) => {
      const { data, error } = await supabase.functions.invoke("generate-growth-intelligence", {
        body: appId ? { app_id: appId } : {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["market-intelligence"] });
      toast({ title: "Intelligence refreshed", description: "New market signals and recommendations are ready." });
    },
    onError: (e: any) =>
      toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });
}
