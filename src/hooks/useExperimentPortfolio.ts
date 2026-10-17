import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { CommitmentClass } from "@/hooks/useStrategy";
import type { StrategicQuestion } from "@/hooks/useStrategicEvidence";

export type ExperimentReviewStatus = "draft" | "pending" | "approved" | "rejected" | "revoked";
export type ExperimentExecutionStatus = "not_started" | "running" | "paused" | "completed" | "stopped" | "cancelled";
export type ExperimentMetricOperator = "gte" | "lte" | "gt" | "lt";
export type ExperimentObservationState = "continue" | "success" | "failure" | "inconclusive" | "stop";

export interface StrategicExperiment {
  id: string;
  user_id: string;
  app_id: string;
  decision_id: string;
  goal_id: string | null;
  market_option_id: string | null;
  question_id: string | null;
  title: string;
  hypothesis: string;
  information_objective: string;
  intervention: string;
  comparison_basis: string | null;
  primary_metric: string;
  metric_unit: string | null;
  success_operator: ExperimentMetricOperator | null;
  success_threshold: number | null;
  kill_operator: ExperimentMetricOperator | null;
  kill_threshold: number | null;
  minimum_sample_size: number | null;
  cost_ceiling: number;
  currency: string;
  commitment_class: Exclude<CommitmentClass, "hard_to_reverse">;
  planned_start: string | null;
  deadline: string;
  success_conditions: string[];
  kill_conditions: string[];
  evidence_requirements: string[];
  information_value_score_snapshot: number | null;
  decision_commitment_amount_snapshot: number | null;
  decision_currency_snapshot: string | null;
  commitment_leverage_ratio: number | null;
  plan_review_status: ExperimentReviewStatus;
  plan_review_fingerprint: string | null;
  source_decision_fingerprint: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  execution_status: ExperimentExecutionStatus;
  started_at: string | null;
  ended_at: string | null;
  stop_reason: string | null;
  created_at: string;
  updated_at: string;
  source_decision_status: string;
  source_decision_title: string;
  current_plan_fingerprint: string;
  current_source_decision_fingerprint: string;
  review_fresh: boolean;
  cost_to_date: number;
  observation_count: number;
  success_gate_seen: boolean;
  kill_gate_seen: boolean;
}

export interface StrategicExperimentObservation {
  id: string;
  user_id: string;
  experiment_id: string;
  evidence_item_id: string | null;
  metric_name: string;
  metric_value: number | null;
  metric_unit: string | null;
  sample_size: number | null;
  cost_to_date: number | null;
  result_state: ExperimentObservationState;
  success_gate_met: boolean;
  kill_gate_met: boolean;
  notes: string | null;
  observed_at: string;
  created_at: string;
}

export interface CreateStrategicExperimentInput {
  decision_id: string;
  question_id?: string;
  title: string;
  hypothesis: string;
  information_objective: string;
  intervention: string;
  comparison_basis?: string;
  primary_metric: string;
  metric_unit?: string;
  success_operator?: ExperimentMetricOperator;
  success_threshold?: number;
  kill_operator?: ExperimentMetricOperator;
  kill_threshold?: number;
  minimum_sample_size?: number;
  cost_ceiling: number;
  currency: string;
  commitment_class: Exclude<CommitmentClass, "hard_to_reverse">;
  planned_start?: string;
  deadline: string;
  success_conditions: string[];
  kill_conditions: string[];
  evidence_requirements?: string[];
}

export interface RecordExperimentObservationInput {
  experiment_id: string;
  evidence_item_id?: string;
  metric_name: string;
  metric_value?: number;
  metric_unit?: string;
  sample_size?: number;
  cost_to_date?: number;
  result_state?: ExperimentObservationState;
  notes?: string;
  observed_at?: string;
}

const db = supabase as any;

export function useExperimentPortfolio(appId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["experiment-portfolio", user?.id, appId ?? "none"],
    enabled: !!user && !!appId,
    queryFn: async () => {
      if (!user || !appId) {
        return { experiments: [], observations: [], questions: [] } as {
          experiments: StrategicExperiment[];
          observations: StrategicExperimentObservation[];
          questions: StrategicQuestion[];
        };
      }

      const [experimentRes, questionRes] = await Promise.all([
        db.from("strategic_experiment_portfolio")
          .select("*")
          .eq("user_id", user.id)
          .eq("app_id", appId)
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("strategic_questions")
          .select("*")
          .eq("user_id", user.id)
          .eq("app_id", appId)
          .eq("status", "open")
          .order("information_value_score", { ascending: false })
          .limit(100),
      ]);
      if (experimentRes.error) throw experimentRes.error;
      if (questionRes.error) throw questionRes.error;

      const experiments = (experimentRes.data ?? []) as StrategicExperiment[];
      let observations: StrategicExperimentObservation[] = [];
      if (experiments.length) {
        const observationRes = await db.from("strategic_experiment_observations")
          .select("*")
          .eq("user_id", user.id)
          .in("experiment_id", experiments.map((experiment) => experiment.id))
          .order("observed_at", { ascending: false })
          .limit(300);
        if (observationRes.error) throw observationRes.error;
        observations = (observationRes.data ?? []) as StrategicExperimentObservation[];
      }

      return {
        experiments,
        observations,
        questions: (questionRes.data ?? []) as StrategicQuestion[],
      };
    },
  });
}

function invalidateExperiments(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["experiment-portfolio"] });
  qc.invalidateQueries({ queryKey: ["strategic-governance"] });
  qc.invalidateQueries({ queryKey: ["strategic-decisions"] });
}

export function useCreateStrategicExperiment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: CreateStrategicExperimentInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_experiments").insert({
        ...input,
        user_id: user.id,
        question_id: input.question_id || null,
        comparison_basis: input.comparison_basis?.trim() || null,
        metric_unit: input.metric_unit?.trim() || null,
        planned_start: input.planned_start || null,
        evidence_requirements: input.evidence_requirements ?? [],
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateExperiments(qc);
      toast({ title: "Experiment plan created", description: "It remains non-executable until its exact plan receives review." });
    },
    onError: (error: Error) => toast({ title: "Could not create experiment", description: error.message, variant: "destructive" }),
  });
}

export function useSubmitExperimentReview() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (experimentId: string) => {
      const { data, error } = await db.rpc("submit_strategic_experiment_review", { p_experiment_id: experimentId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateExperiments(qc);
      toast({ title: "Experiment submitted for review", description: "Review is fingerprint-bound to this exact plan and source decision." });
    },
    onError: (error: Error) => toast({ title: "Could not submit experiment", description: error.message, variant: "destructive" }),
  });
}

export function useReviewExperiment() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ experimentId, action, reason }: { experimentId: string; action: "approve" | "reject" | "revoke"; reason?: string }) => {
      const { data, error } = await db.rpc("review_strategic_experiment", {
        p_experiment_id: experimentId,
        p_action: action,
        p_reason: reason?.trim() || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      invalidateExperiments(qc);
      toast({ title: `Experiment review ${variables.action}d` });
    },
    onError: (error: Error) => toast({ title: "Experiment review failed", description: error.message, variant: "destructive" }),
  });
}

export function useTransitionExperiment() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ experimentId, status, reason }: { experimentId: string; status: Exclude<ExperimentExecutionStatus, "not_started">; reason?: string }) => {
      const { data, error } = await db.rpc("transition_strategic_experiment", {
        p_experiment_id: experimentId,
        p_status: status,
        p_reason: reason?.trim() || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      invalidateExperiments(qc);
      toast({ title: `Experiment ${variables.status.replaceAll("_", " ")}`, description: "This changes ledger state only; no external action was executed." });
    },
    onError: (error: Error) => toast({ title: "Experiment transition blocked", description: error.message, variant: "destructive" }),
  });
}

export function useRecordExperimentObservation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: RecordExperimentObservationInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_experiment_observations").insert({
        ...input,
        user_id: user.id,
        evidence_item_id: input.evidence_item_id || null,
        result_state: input.result_state ?? "continue",
        observed_at: input.observed_at ?? new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      return data as StrategicExperimentObservation;
    },
    onSuccess: (observation) => {
      invalidateExperiments(qc);
      toast({
        title: observation.kill_gate_met ? "Kill gate reached" : observation.success_gate_met ? "Success gate observed" : "Experiment observation recorded",
        description: observation.kill_gate_met ? "The database protective-stop guard stops the experiment ledger state." : undefined,
        variant: observation.kill_gate_met ? "destructive" : "default",
      });
    },
    onError: (error: Error) => toast({ title: "Could not record observation", description: error.message, variant: "destructive" }),
  });
}
