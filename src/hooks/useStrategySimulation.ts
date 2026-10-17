import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { CommitmentClass } from "@/hooks/useStrategy";

export type ScenarioStatus = "draft" | "active" | "completed" | "archived";
export type ScenarioActorType = "company" | "competitor" | "customer" | "market" | "regulator" | "partner" | "internal" | "other";
export type LikelihoodBasis = "unknown" | "manual_assumption" | "observed_frequency";
export type DecisionEffect = "holds" | "changes" | "unknown";
export type SensitivityEvidenceBasis = "observation" | "experiment" | "assumption" | "model" | "other";

export interface StrategicScenario {
  id: string;
  user_id: string;
  app_id: string;
  goal_id: string | null;
  decision_id: string | null;
  market_option_id: string | null;
  title: string;
  description: string | null;
  base_move: string;
  decision_question: string | null;
  time_horizon: string | null;
  status: ScenarioStatus;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
}

export interface StrategicScenarioBranch {
  id: string;
  user_id: string;
  scenario_id: string;
  parent_branch_id: string | null;
  evidence_item_id: string | null;
  actor_type: ScenarioActorType;
  actor_name: string | null;
  event_type: string;
  event_description: string;
  likelihood_basis: LikelihoodBasis;
  likelihood_pct: number | null;
  observed_response_count: number | null;
  comparable_event_count: number | null;
  impact_score: number;
  decision_effect: DecisionEffect;
  response_move: string | null;
  response_reversibility: CommitmentClass;
  stress_score: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StrategicSensitivityTest {
  id: string;
  user_id: string;
  scenario_id: string;
  evidence_item_id: string | null;
  variable_name: string;
  variable_unit: string | null;
  low_value: number | null;
  base_value: number | null;
  high_value: number | null;
  outcome_metric: string;
  outcome_unit: string | null;
  low_outcome: number | null;
  base_outcome: number | null;
  high_outcome: number | null;
  evidence_basis: SensitivityEvidenceBasis;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScenarioInput {
  app_id: string;
  goal_id?: string;
  decision_id?: string;
  market_option_id?: string;
  title: string;
  description?: string;
  base_move: string;
  decision_question?: string;
  time_horizon?: string;
  status?: ScenarioStatus;
}

export interface CreateScenarioBranchInput {
  scenario_id: string;
  parent_branch_id?: string;
  evidence_item_id?: string;
  actor_type: ScenarioActorType;
  actor_name?: string;
  event_type?: string;
  event_description: string;
  likelihood_basis: LikelihoodBasis;
  likelihood_pct?: number;
  observed_response_count?: number;
  comparable_event_count?: number;
  impact_score?: number;
  decision_effect?: DecisionEffect;
  response_move?: string;
  response_reversibility?: CommitmentClass;
  notes?: string;
}

export interface CreateSensitivityInput {
  scenario_id: string;
  evidence_item_id?: string;
  variable_name: string;
  variable_unit?: string;
  low_value?: number;
  base_value?: number;
  high_value?: number;
  outcome_metric: string;
  outcome_unit?: string;
  low_outcome?: number;
  base_outcome?: number;
  high_outcome?: number;
  evidence_basis?: SensitivityEvidenceBasis;
  notes?: string;
}

const db = supabase as any;

export function useStrategySimulation(appId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["strategy-simulation", user?.id, appId ?? "all"],
    enabled: !!user && !!appId,
    queryFn: async () => {
      if (!user || !appId) {
        return { scenarios: [] as StrategicScenario[], branches: [] as StrategicScenarioBranch[], sensitivities: [] as StrategicSensitivityTest[] };
      }

      const scenarioRes = await db
        .from("strategic_scenarios")
        .select("*")
        .eq("user_id", user.id)
        .eq("app_id", appId)
        .order("created_at", { ascending: false });
      if (scenarioRes.error) throw scenarioRes.error;

      const scenarios = (scenarioRes.data ?? []) as StrategicScenario[];
      if (!scenarios.length) return { scenarios, branches: [], sensitivities: [] };
      const scenarioIds = scenarios.map((scenario) => scenario.id);

      const [branchRes, sensitivityRes] = await Promise.all([
        db
          .from("strategic_scenario_branches")
          .select("*")
          .eq("user_id", user.id)
          .in("scenario_id", scenarioIds)
          .order("created_at", { ascending: true }),
        db
          .from("strategic_sensitivity_tests")
          .select("*")
          .eq("user_id", user.id)
          .in("scenario_id", scenarioIds)
          .order("created_at", { ascending: true }),
      ]);
      if (branchRes.error) throw branchRes.error;
      if (sensitivityRes.error) throw sensitivityRes.error;

      return {
        scenarios,
        branches: (branchRes.data ?? []) as StrategicScenarioBranch[],
        sensitivities: (sensitivityRes.data ?? []) as StrategicSensitivityTest[],
      };
    },
  });
}

export function useCreateStrategicScenario() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: CreateScenarioInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("strategic_scenarios")
        .insert({ ...input, user_id: user.id, status: input.status ?? "draft" })
        .select()
        .single();
      if (error) throw error;
      return data as StrategicScenario;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategy-simulation"] });
      toast({ title: "Scenario created", description: "Add plausible branches without forcing unknown likelihoods." });
    },
    onError: (error: Error) => toast({ title: "Could not create scenario", description: error.message, variant: "destructive" }),
  });
}

export function useCreateScenarioBranch() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: CreateScenarioBranchInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("strategic_scenario_branches")
        .insert({
          ...input,
          user_id: user.id,
          event_type: input.event_type ?? "other",
          impact_score: input.impact_score ?? 0,
          decision_effect: input.decision_effect ?? "unknown",
          response_reversibility: input.response_reversibility ?? "reversible",
        })
        .select()
        .single();
      if (error) throw error;
      return data as StrategicScenarioBranch;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategy-simulation"] });
      toast({ title: "Scenario branch added" });
    },
    onError: (error: Error) => toast({ title: "Could not add scenario branch", description: error.message, variant: "destructive" }),
  });
}

export function useCreateSensitivityTest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: CreateSensitivityInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("strategic_sensitivity_tests")
        .insert({ ...input, user_id: user.id, evidence_basis: input.evidence_basis ?? "assumption" })
        .select()
        .single();
      if (error) throw error;
      return data as StrategicSensitivityTest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategy-simulation"] });
      toast({ title: "Sensitivity case recorded", description: "Low/base/high values stay explicit and auditable." });
    },
    onError: (error: Error) => toast({ title: "Could not record sensitivity", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateStrategicScenario() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<StrategicScenario, "status" | "conclusion" | "description" | "decision_question" | "time_horizon">> }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("strategic_scenarios")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single();
      if (error) throw error;
      return data as StrategicScenario;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategy-simulation"] }),
    onError: (error: Error) => toast({ title: "Could not update scenario", description: error.message, variant: "destructive" }),
  });
}
