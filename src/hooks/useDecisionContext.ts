import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { CommercialNodeType } from "@/hooks/useCommercialWorldModel";

export type DecisionContextPurpose = "strategy_recommendation" | "market_ranking" | "scenario_planning";

export interface DecisionContextCounts {
  graph_nodes: number;
  graph_relationships: number;
  validated_observations: number;
  assumptions_or_inferences: number;
  open_questions: number;
  unknown_evidence: number;
  approved_memories: number;
  enabled_governance_policies: number;
}

export interface ControlledDecisionContext {
  context_version: string;
  context_fingerprint: string;
  assembled_at: string;
  purpose: DecisionContextPurpose;
  app_id: string;
  focus: { node_type: CommercialNodeType; node_id: string };
  offering: Record<string, unknown>;
  objectives: Array<Record<string, any>>;
  graph_neighborhood: {
    nodes: Array<Record<string, any>>;
    relationships: Array<Record<string, any>>;
  };
  verified_observations: Array<Record<string, any>>;
  epistemic_context: Array<Record<string, any>>;
  unresolved_uncertainty: {
    questions: Array<Record<string, any>>;
    unknown_evidence: Array<Record<string, any>>;
  };
  approved_strategic_memories: Array<Record<string, any>>;
  governance: {
    enabled_policies: Array<Record<string, any>>;
    focus_decision_controls: Record<string, any>;
  };
  warnings: string[];
  counts: DecisionContextCounts;
}

export interface StrategicContextSnapshot {
  id: string;
  user_id: string;
  app_id: string;
  purpose: DecisionContextPurpose;
  focus_type: CommercialNodeType | null;
  focus_id: string | null;
  context_version: string;
  context_fingerprint: string;
  context: ControlledDecisionContext;
  created_at: string;
}

export interface GenerateStrategicRecommendationsResult {
  success: boolean;
  recommendation_only: boolean;
  snapshot_id: string;
  context_fingerprint: string;
  decisions: Array<Record<string, any>>;
  provenance: {
    validated_observation_count: number;
    approved_memory_count: number;
    open_question_count: number;
    unknown_evidence_count: number;
    warnings: string[];
  };
}

const db = supabase as any;

export function usePreviewDecisionContext() {
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      appId,
      purpose,
      focusType = "app",
      focusId,
    }: {
      appId: string;
      purpose: DecisionContextPurpose;
      focusType?: CommercialNodeType;
      focusId?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.rpc("assemble_strategic_decision_context", {
        p_app_id: appId,
        p_purpose: purpose,
        p_focus_type: focusType,
        p_focus_id: focusId ?? appId,
        p_node_limit: 40,
        p_evidence_limit: 20,
        p_question_limit: 10,
        p_memory_limit: 10,
      });
      if (error) throw error;
      return data as ControlledDecisionContext;
    },
    onError: (error: Error) =>
      toast({ title: "Could not assemble decision context", description: error.message, variant: "destructive" }),
  });
}

export function useGenerateStrategicRecommendations() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      appId,
      focusType = "app",
      focusId,
    }: {
      appId: string;
      focusType?: CommercialNodeType;
      focusId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("generate-strategic-recommendations", {
        body: {
          app_id: appId,
          focus_type: focusType,
          focus_id: focusId ?? appId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as GenerateStrategicRecommendationsResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["strategic-decisions"] });
      qc.invalidateQueries({ queryKey: ["strategic-evidence"] });
      qc.invalidateQueries({ queryKey: ["strategic-memory"] });
      qc.invalidateQueries({ queryKey: ["commercial-world-model"] });
      qc.invalidateQueries({ queryKey: ["strategic-context-snapshots"] });
      toast({
        title: `${result.decisions.length} proposed strategic decision${result.decisions.length === 1 ? "" : "s"} generated`,
        description: "Recommendation only — nothing was approved or executed.",
      });
    },
    onError: (error: Error) =>
      toast({ title: "Could not generate strategic recommendations", description: error.message, variant: "destructive" }),
  });
}

export function useStrategicContextSnapshots(appId?: string, limit = 20) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["strategic-context-snapshots", user?.id, appId ?? "all", limit],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as StrategicContextSnapshot[];
      let query = db
        .from("strategic_context_snapshots")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (appId) query = query.eq("app_id", appId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as StrategicContextSnapshot[];
    },
  });
}
