import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { CommitmentClass } from "@/hooks/useStrategy";

export type EntryMode =
  | "unknown"
  | "digital_direct"
  | "export"
  | "partner"
  | "license"
  | "franchise"
  | "joint_venture"
  | "owned_operation"
  | "other";

export type TimingPosture = "unknown" | "first_mover" | "fast_follower" | "wait";
export type MarketOptionStatus = "draft" | "assessing" | "candidate" | "testing" | "entered" | "rejected";

export interface StrategicMarketOption {
  id: string;
  user_id: string;
  app_id: string;
  goal_id: string | null;
  market_name: string;
  segment_name: string | null;
  unmet_need: string | null;
  competitor_gap: string | null;
  white_space_hypothesis: string | null;
  route_to_market: string | null;
  distribution_constraints: string | null;
  entry_mode: EntryMode;
  timing_posture: TimingPosture;
  commitment_class: CommitmentClass;
  estimated_commitment_amount: number | null;
  currency: string;
  demand_score: number | null;
  growth_score: number | null;
  customer_value_score: number | null;
  strategic_fit_score: number | null;
  accessibility_score: number | null;
  distribution_readiness_score: number | null;
  competition_intensity_score: number | null;
  regulatory_risk_score: number | null;
  pioneering_cost_score: number | null;
  capital_intensity_score: number | null;
  evidence_confidence: number | null;
  evidence_coverage: number;
  attractiveness_score: number | null;
  decision_readiness_score: number | null;
  white_space_score: number | null;
  status: MarketOptionStatus;
  next_test: string | null;
  evidence_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketOptionInput {
  app_id: string;
  goal_id?: string;
  market_name: string;
  segment_name?: string;
  unmet_need?: string;
  competitor_gap?: string;
  white_space_hypothesis?: string;
  route_to_market?: string;
  distribution_constraints?: string;
  entry_mode?: EntryMode;
  timing_posture?: TimingPosture;
  commitment_class?: CommitmentClass;
  estimated_commitment_amount?: number;
  currency?: string;
  demand_score?: number;
  growth_score?: number;
  customer_value_score?: number;
  strategic_fit_score?: number;
  accessibility_score?: number;
  distribution_readiness_score?: number;
  competition_intensity_score?: number;
  regulatory_risk_score?: number;
  pioneering_cost_score?: number;
  capital_intensity_score?: number;
  evidence_confidence?: number;
  status?: MarketOptionStatus;
  next_test?: string;
  evidence_notes?: string;
}

export interface DistributionContext {
  total_targets: number;
  activated_targets: number;
  average_distribution_score: number | null;
}

const db = supabase as any;

export function useMarketOptions(appId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["strategic-market-options", user?.id, appId ?? "all"],
    enabled: !!user && !!appId,
    queryFn: async () => {
      if (!user || !appId) {
        return { options: [] as StrategicMarketOption[], distribution: { total_targets: 0, activated_targets: 0, average_distribution_score: null } as DistributionContext };
      }

      const [optionsRes, distributionRes] = await Promise.all([
        db
          .from("strategic_market_options")
          .select("*")
          .eq("user_id", user.id)
          .eq("app_id", appId)
          .order("decision_readiness_score", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }),
        db
          .from("distribution_targets")
          .select("status,distribution_score")
          .eq("user_id", user.id)
          .eq("app_id", appId)
          .limit(300),
      ]);

      if (optionsRes.error) throw optionsRes.error;
      if (distributionRes.error) throw distributionRes.error;

      const targets = distributionRes.data ?? [];
      const scoredTargets = targets
        .map((item: any) => Number(item.distribution_score))
        .filter((value: number) => Number.isFinite(value));

      return {
        options: (optionsRes.data ?? []) as StrategicMarketOption[],
        distribution: {
          total_targets: targets.length,
          activated_targets: targets.filter((item: any) => item.status === "active" || item.status === "activated").length,
          average_distribution_score: scoredTargets.length
            ? Math.round(scoredTargets.reduce((sum: number, value: number) => sum + value, 0) / scoredTargets.length)
            : null,
        } as DistributionContext,
      };
    },
  });
}

export function useCreateMarketOption() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: MarketOptionInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("strategic_market_options")
        .insert({
          ...input,
          user_id: user.id,
          entry_mode: input.entry_mode ?? "unknown",
          timing_posture: input.timing_posture ?? "unknown",
          commitment_class: input.commitment_class ?? "reversible",
          currency: input.currency ?? "EUR",
          status: input.status ?? "draft",
        })
        .select()
        .single();
      if (error) throw error;
      return data as StrategicMarketOption;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategic-market-options"] });
      toast({ title: "Market option recorded", description: "Unknown factors remain unscored until evidence is added." });
    },
    onError: (error: Error) =>
      toast({ title: "Could not record market option", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateMarketOption() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<MarketOptionInput> }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("strategic_market_options")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single();
      if (error) throw error;
      return data as StrategicMarketOption;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategic-market-options"] });
      toast({ title: "Market assessment updated" });
    },
    onError: (error: Error) =>
      toast({ title: "Could not update market assessment", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateMarketOptionStatus() {
  const update = useUpdateMarketOption();
  return {
    ...update,
    mutate: ({ id, status }: { id: string; status: MarketOptionStatus }) => update.mutate({ id, patch: { status } }),
    mutateAsync: ({ id, status }: { id: string; status: MarketOptionStatus }) => update.mutateAsync({ id, patch: { status } }),
  };
}
