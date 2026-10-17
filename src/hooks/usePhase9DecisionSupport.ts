import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type MarketRankingRecommendation = "test" | "research" | "wait" | "deprioritize";
export type ScenarioAssessmentRecommendation = "holds" | "changes" | "needs_more_evidence";

export interface MarketRankingRun {
  id: string;
  user_id: string;
  app_id: string;
  objective_id: string | null;
  context_snapshot_id: string;
  top_market_option_id: string | null;
  summary: string | null;
  market_count: number;
  ranked_count: number;
  insufficient_evidence_count: number;
  excluded_count: number;
  created_at: string;
}

export interface MarketRankingItem {
  id: string;
  run_id: string;
  user_id: string;
  market_option_id: string;
  rank_state: "ranked" | "insufficient_evidence" | "excluded";
  deterministic_rank: number | null;
  decision_readiness_score: number | null;
  attractiveness_score: number | null;
  evidence_coverage: number;
  evidence_confidence: number | null;
  recommendation: MarketRankingRecommendation | null;
  rationale: string | null;
  confidence: number | null;
  evidence_refs: string[];
  memory_refs: string[];
  question_refs: string[];
  unknown_refs: string[];
  next_information_needed: string | null;
  created_at: string;
}

export interface ScenarioAssessmentRun {
  id: string;
  user_id: string;
  app_id: string;
  scenario_id: string;
  context_snapshot_id: string;
  recommendation: ScenarioAssessmentRecommendation;
  confidence: number;
  rationale: string | null;
  branch_count: number;
  assessed_branch_count: number;
  known_likelihood_count: number;
  unknown_likelihood_count: number;
  holds_count: number;
  changes_count: number;
  unknown_effect_count: number;
  max_stress_score: number | null;
  sensitivity_count: number;
  branch_refs: string[];
  evidence_refs: string[];
  memory_refs: string[];
  question_refs: string[];
  unknown_refs: string[];
  next_information_needed: string | null;
  created_at: string;
}

const db = supabase as any;

export function usePhase9DecisionSupport(appId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["phase9-decision-support", user?.id, appId ?? "none"],
    enabled: !!user && !!appId,
    queryFn: async () => {
      if (!user || !appId) return { rankingRuns: [], rankingItems: [], scenarioAssessments: [] } as {
        rankingRuns: MarketRankingRun[];
        rankingItems: MarketRankingItem[];
        scenarioAssessments: ScenarioAssessmentRun[];
      };

      const [runsRes, assessmentsRes] = await Promise.all([
        db.from("strategic_market_ranking_runs")
          .select("*")
          .eq("user_id", user.id)
          .eq("app_id", appId)
          .order("created_at", { ascending: false })
          .limit(20),
        db.from("strategic_scenario_assessment_runs")
          .select("*")
          .eq("user_id", user.id)
          .eq("app_id", appId)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      if (runsRes.error) throw runsRes.error;
      if (assessmentsRes.error) throw assessmentsRes.error;

      const rankingRuns = (runsRes.data ?? []) as MarketRankingRun[];
      let rankingItems: MarketRankingItem[] = [];
      if (rankingRuns.length) {
        const itemsRes = await db.from("strategic_market_ranking_items")
          .select("*")
          .eq("user_id", user.id)
          .in("run_id", rankingRuns.map((r) => r.id))
          .order("deterministic_rank", { ascending: true, nullsFirst: false });
        if (itemsRes.error) throw itemsRes.error;
        rankingItems = (itemsRes.data ?? []) as MarketRankingItem[];
      }

      return {
        rankingRuns,
        rankingItems,
        scenarioAssessments: (assessmentsRes.data ?? []) as ScenarioAssessmentRun[],
      };
    },
  });
}

function invalidatePhase9(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["phase9-decision-support"] });
  qc.invalidateQueries({ queryKey: ["strategic-decisions"] });
  qc.invalidateQueries({ queryKey: ["strategic-questions"] });
}

export function useRunStrategicMarketRanking() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ appId, objectiveId }: { appId: string; objectiveId?: string }) => {
      const { data, error } = await supabase.functions.invoke("rank-strategic-markets", {
        body: { app_id: appId, objective_id: objectiveId ?? null },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      invalidatePhase9(qc);
      toast({ title: "Market ranking recorded", description: "The numeric order came from deterministic readiness data; AI only annotated the result." });
    },
    onError: (error: Error) => toast({ title: "Could not rank markets", description: error.message, variant: "destructive" }),
  });
}

export function useAssessStrategicScenario() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ appId, scenarioId }: { appId: string; scenarioId: string }) => {
      const { data, error } = await supabase.functions.invoke("assess-strategic-scenario", {
        body: { app_id: appId, scenario_id: scenarioId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      invalidatePhase9(qc);
      toast({ title: "Scenario assessment recorded", description: "The assessment is recommendation-only; it did not change the scenario conclusion or execute a response." });
    },
    onError: (error: Error) => toast({ title: "Could not assess scenario", description: error.message, variant: "destructive" }),
  });
}
