import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type CommitmentClass = "reversible" | "partly_reversible" | "hard_to_reverse";
export type RiskTolerance = "conservative" | "moderate" | "aggressive";
export type DecisionStatus = "proposed" | "approved" | "rejected" | "executing" | "executed" | "cancelled";
export type DecisionType =
  | "research"
  | "wait"
  | "test"
  | "partner"
  | "reposition"
  | "product"
  | "price"
  | "enter"
  | "exit"
  | "advertise"
  | "scale"
  | "other";
export type AuthorityLevel = "observe" | "recommend" | "draft" | "bounded_execute" | "executive_approval";

export interface StrategicObjective {
  id: string;
  user_id: string;
  app_id: string;
  goal_type: string;
  target_value: number;
  current_value: number;
  start_date: string;
  end_date: string;
  status: string;
  objective_name: string | null;
  strategic_rationale: string | null;
  target_market: string | null;
  target_segment: string | null;
  assumptions: unknown[];
  constraints: unknown[];
  evidence_threshold: number;
  commitment_class: CommitmentClass;
  risk_tolerance: RiskTolerance;
  created_at: string;
  updated_at: string;
}

export interface StrategicDecision {
  id: string;
  user_id: string;
  app_id: string | null;
  goal_id: string | null;
  recommendation_id: string | null;
  decision_type: DecisionType;
  title: string;
  recommendation: string;
  rationale: string | null;
  evidence: Record<string, unknown>;
  assumptions: unknown[];
  unknowns: string[];
  sensitivities: Record<string, unknown>;
  confidence: number | null;
  expected_upside: string | null;
  expected_downside: string | null;
  reversibility: CommitmentClass;
  commitment_amount: number | null;
  currency: string;
  authority_level: AuthorityLevel;
  status: DecisionStatus;
  next_information_needed: string | null;
  success_conditions: string[];
  kill_conditions: string[];
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  outcome_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateStrategicObjectiveInput {
  app_id: string;
  objective_name: string;
  goal_type: string;
  target_value: number;
  end_date: string;
  strategic_rationale?: string;
  target_market?: string;
  target_segment?: string;
  evidence_threshold?: number;
  commitment_class?: CommitmentClass;
  risk_tolerance?: RiskTolerance;
}

export interface CreateStrategicDecisionInput {
  app_id: string;
  goal_id?: string;
  decision_type: DecisionType;
  title: string;
  recommendation: string;
  rationale?: string;
  confidence?: number;
  reversibility?: CommitmentClass;
  authority_level?: AuthorityLevel;
  next_information_needed?: string;
  expected_upside?: string;
  expected_downside?: string;
}

const db = supabase as any;

export function useStrategicObjectives(appId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["strategic-objectives", user?.id, appId ?? "all"],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as StrategicObjective[];
      let query = db
        .from("growth_goals")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (appId) query = query.eq("app_id", appId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as StrategicObjective[];
    },
  });
}

export function useCreateStrategicObjective() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateStrategicObjectiveInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("growth_goals")
        .insert({
          ...input,
          user_id: user.id,
          commitment_class: input.commitment_class ?? "reversible",
          risk_tolerance: input.risk_tolerance ?? "moderate",
          evidence_threshold: input.evidence_threshold ?? 70,
        })
        .select()
        .single();
      if (error) throw error;
      return data as StrategicObjective;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategic-objectives"] });
      qc.invalidateQueries({ queryKey: ["growth_goals"] });
      toast({ title: "Strategic objective created", description: "Campaigns can now roll up to a measurable business objective." });
    },
    onError: (error: Error) =>
      toast({ title: "Could not create objective", description: error.message, variant: "destructive" }),
  });
}

export function useStrategicDecisions(appId?: string, limit = 50) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["strategic-decisions", user?.id, appId ?? "all", limit],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as StrategicDecision[];
      let query = db
        .from("strategic_decisions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (appId) query = query.eq("app_id", appId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as StrategicDecision[];
    },
  });
}

export function useCreateStrategicDecision() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateStrategicDecisionInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("strategic_decisions")
        .insert({
          ...input,
          user_id: user.id,
          reversibility: input.reversibility ?? "reversible",
          authority_level: input.authority_level ?? "recommend",
          status: "proposed",
        })
        .select()
        .single();
      if (error) throw error;
      return data as StrategicDecision;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategic-decisions"] });
      toast({ title: "Decision recorded", description: "The recommendation and uncertainty are now in the decision ledger." });
    },
    onError: (error: Error) =>
      toast({ title: "Could not record decision", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateStrategicDecisionStatus() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: DecisionStatus }) => {
      if (!user) throw new Error("Not authenticated");
      const patch: Record<string, unknown> = { status };
      if (status === "approved") {
        patch.approved_by = user.id;
        patch.approved_at = new Date().toISOString();
      }
      if (status === "executed") patch.executed_at = new Date().toISOString();

      const { data, error } = await db
        .from("strategic_decisions")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single();
      if (error) throw error;
      return data as StrategicDecision;
    },
    onSuccess: (decision) => {
      qc.invalidateQueries({ queryKey: ["strategic-decisions"] });
      toast({ title: `Decision ${decision.status}` });
    },
    onError: (error: Error) =>
      toast({ title: "Could not update decision", description: error.message, variant: "destructive" }),
  });
}
