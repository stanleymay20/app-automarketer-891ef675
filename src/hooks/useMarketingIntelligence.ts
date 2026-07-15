import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type ReadinessResponse = {
  window_days: number;
  metrics: {
    spend_coverage: number;
    conversion_coverage: number;
    campaign_mapping: number;
    attribution_coverage: number;
    data_freshness: number;
    connector_reliability: number;
  };
  totals: Record<string, number>;
  audit: {
    orphaned_conversions: number;
    spend_without_campaign: number;
    content_without_cost: number;
    stale_spend_days: number;
  };
  score: number;
  label: "Excellent" | "Good" | "Needs Improvement" | "Critical";
  mmm_ready: boolean;
  gates: Record<string, { ok: boolean; actual: number; target: number }>;
  thresholds: Record<string, number>;
  weights: Record<string, number>;
  estimated_days_to_ready: number;
  generated_at: string;
};

export function useMarketingReadiness(appId?: string) {
  return useQuery({
    queryKey: ["marketing-readiness", appId ?? "all"],
    queryFn: async (): Promise<ReadinessResponse> => {
      const { data, error } = await supabase.functions.invoke("marketing-readiness", {
        body: appId ? { app_id: appId } : {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    staleTime: 60_000,
  });
}

export function useChannelSpend(appId?: string) {
  return useQuery({
    queryKey: ["channel-spend", appId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("channel_spend").select("*").order("date", { ascending: false }).limit(200);
      if (appId) q = q.eq("app_id", appId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAddChannelSpend() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (row: {
      date: string; channel: string; spend_amount: number; currency?: string;
      exchange_rate?: number; campaign_id?: string | null; campaign_name?: string | null;
      app_id?: string | null; source?: string; notes?: string | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase.from("channel_spend").insert({
        user_id: user.id,
        currency: "USD",
        source: "manual",
        exchange_rate: 1,
        ...row,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-spend"] });
      qc.invalidateQueries({ queryKey: ["marketing-readiness"] });
      toast({ title: "Spend recorded" });
    },
    onError: (e: any) => toast({ title: "Failed to add spend", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteChannelSpend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("channel_spend").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-spend"] });
      qc.invalidateQueries({ queryKey: ["marketing-readiness"] });
    },
  });
}

export function useMmmRuns(appId?: string) {
  return useQuery({
    queryKey: ["mmm-runs", appId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("mmm_runs").select("*").order("generated_at", { ascending: false }).limit(100);
      if (appId) q = q.eq("app_id", appId);
      const { data, error } = await q;
      if (error) throw error;
      // Keep only the latest run per channel
      const latest = new Map<string, any>();
      for (const r of data ?? []) if (!latest.has(r.channel)) latest.set(r.channel, r);
      return [...latest.values()];
    },
  });
}

export function useComputeMmm() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ appId, force }: { appId?: string; force?: boolean } = {}) => {
      const { data, error } = await supabase.functions.invoke("compute-mmm", {
        body: { app_id: appId ?? null, force: !!force },
      });
      if (error) throw error;
      if (data?.error === "readiness_gate_blocked") {
        throw new Error(data.message || "Readiness gate blocked");
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["mmm-runs"] });
      toast({ title: "MMM refreshed", description: `${d.runs ?? 0} channel estimates recomputed` });
    },
    onError: (e: any) => toast({ title: "MMM run blocked", description: e.message, variant: "destructive" }),
  });
}
