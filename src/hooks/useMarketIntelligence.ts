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
      return { market, competitors, opportunities, customers, recommendations };
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
