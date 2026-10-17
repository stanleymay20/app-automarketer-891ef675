import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { CommitmentClass, DecisionType } from "@/hooks/useStrategy";

export type GovernanceAuthorityMode = "manual_only" | "recommend" | "draft" | "bounded_execute";
export type GovernanceResult = "allow" | "review" | "block";
export type ApprovalType = "human" | "legal" | "brand" | "executive";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type StopRuleType = "confidence_floor" | "commitment_ceiling" | "deadline" | "manual_halt";
export type StopRuleStatus = "active" | "triggered" | "disabled";
export type ExecutionMode = "manual" | "bounded_autonomous";

export interface StrategicGovernancePolicy {
  id: string;
  user_id: string;
  app_id: string | null;
  policy_name: string;
  decision_types: DecisionType[];
  authority_mode: GovernanceAuthorityMode;
  min_confidence: number | null;
  max_commitment_amount: number | null;
  currency: string;
  allowed_reversibility: CommitmentClass[];
  human_approval_required: boolean;
  legal_review_required: boolean;
  brand_review_required: boolean;
  executive_approval_required: boolean;
  priority: number;
  enabled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StrategicApprovalRequest {
  id: string;
  user_id: string;
  app_id: string | null;
  decision_id: string;
  policy_id: string | null;
  approval_type: ApprovalType;
  status: ApprovalStatus;
  reason: string | null;
  decision_snapshot: Record<string, unknown>;
  policy_snapshot: Record<string, unknown>;
  decision_fingerprint: string;
  policy_fingerprint: string;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StrategicStopRule {
  id: string;
  user_id: string;
  app_id: string | null;
  decision_id: string;
  rule_name: string;
  rule_type: StopRuleType;
  threshold_numeric: number | null;
  threshold_at: string | null;
  currency: string | null;
  action: "block_autonomy" | "require_review";
  status: StopRuleStatus;
  triggered_reason: string | null;
  triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StrategicGovernanceEvaluation {
  id: string;
  user_id: string;
  app_id: string | null;
  decision_id: string;
  policy_id: string | null;
  requested_action: "autonomous_execute";
  result: GovernanceResult;
  reasons: string[];
  decision_snapshot: Record<string, unknown>;
  policy_snapshot: Record<string, unknown>;
  decision_fingerprint: string;
  policy_fingerprint: string;
  created_at: string;
}

export interface StrategicActionLogEntry {
  id: string;
  user_id: string;
  app_id: string | null;
  decision_id: string | null;
  policy_id: string | null;
  approval_request_id: string | null;
  evaluation_id: string | null;
  event_type: string;
  previous_state: Record<string, unknown>;
  next_state: Record<string, unknown>;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CreateGovernancePolicyInput {
  app_id?: string;
  policy_name: string;
  decision_types?: DecisionType[];
  authority_mode: GovernanceAuthorityMode;
  min_confidence?: number;
  max_commitment_amount?: number;
  currency?: string;
  allowed_reversibility?: CommitmentClass[];
  human_approval_required?: boolean;
  legal_review_required?: boolean;
  brand_review_required?: boolean;
  executive_approval_required?: boolean;
  priority?: number;
  enabled?: boolean;
  notes?: string;
}

export interface CreateStopRuleInput {
  decision_id: string;
  rule_name: string;
  rule_type: StopRuleType;
  threshold_numeric?: number;
  threshold_at?: string;
  currency?: string;
  action?: "block_autonomy" | "require_review";
}

const db = supabase as any;

export function useStrategicGovernance(appId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["strategic-governance", user?.id, appId ?? "all"],
    enabled: !!user,
    queryFn: async () => {
      if (!user) {
        return {
          policies: [] as StrategicGovernancePolicy[],
          approvals: [] as StrategicApprovalRequest[],
          stopRules: [] as StrategicStopRule[],
          evaluations: [] as StrategicGovernanceEvaluation[],
          actionLog: [] as StrategicActionLogEntry[],
        };
      }

      const [policyRes, approvalRes, stopRes, evalRes, logRes] = await Promise.all([
        db.from("strategic_governance_policies").select("*").eq("user_id", user.id).order("priority", { ascending: false }).order("created_at", { ascending: false }),
        db.from("strategic_approval_requests").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
        db.from("strategic_stop_rules").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
        db.from("strategic_governance_evaluations").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
        db.from("strategic_action_log").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
      ]);

      const firstError = [policyRes, approvalRes, stopRes, evalRes, logRes].find((result) => result.error)?.error;
      if (firstError) throw firstError;

      const visibleForApp = <T extends { app_id: string | null }>(rows: T[]) =>
        appId ? rows.filter((row) => row.app_id === null || row.app_id === appId) : rows;

      return {
        policies: visibleForApp((policyRes.data ?? []) as StrategicGovernancePolicy[]),
        approvals: visibleForApp((approvalRes.data ?? []) as StrategicApprovalRequest[]),
        stopRules: visibleForApp((stopRes.data ?? []) as StrategicStopRule[]),
        evaluations: visibleForApp((evalRes.data ?? []) as StrategicGovernanceEvaluation[]),
        actionLog: visibleForApp((logRes.data ?? []) as StrategicActionLogEntry[]),
      };
    },
  });
}

function invalidateGovernance(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["strategic-governance"] });
  qc.invalidateQueries({ queryKey: ["strategic-decisions"] });
}

export function useCreateGovernancePolicy() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: CreateGovernancePolicyInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_governance_policies").insert({
        ...input,
        user_id: user.id,
        decision_types: input.decision_types ?? [],
        currency: input.currency ?? "EUR",
        allowed_reversibility: input.allowed_reversibility ?? [],
        human_approval_required: input.human_approval_required ?? false,
        legal_review_required: input.legal_review_required ?? false,
        brand_review_required: input.brand_review_required ?? false,
        executive_approval_required: input.executive_approval_required ?? false,
        priority: input.priority ?? 100,
        enabled: input.enabled ?? false,
      }).select().single();
      if (error) throw error;
      return data as StrategicGovernancePolicy;
    },
    onSuccess: () => {
      invalidateGovernance(qc);
      toast({ title: "Governance policy created", description: "Autonomy stays off unless an enabled policy explicitly permits it." });
    },
    onError: (error: Error) => toast({ title: "Could not create governance policy", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateGovernancePolicy() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<StrategicGovernancePolicy, "enabled" | "priority" | "notes">> }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_governance_policies")
        .update(patch).eq("id", id).eq("user_id", user.id).select().single();
      if (error) throw error;
      return data as StrategicGovernancePolicy;
    },
    onSuccess: () => invalidateGovernance(qc),
    onError: (error: Error) => toast({ title: "Could not update governance policy", description: error.message, variant: "destructive" }),
  });
}

export function useConfigureDecisionExecution() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, execution_mode, commitment_amount, currency }: {
      id: string;
      execution_mode: ExecutionMode;
      commitment_amount: number;
      currency: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_decisions")
        .update({ execution_mode, commitment_amount, currency })
        .eq("id", id).eq("user_id", user.id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateGovernance(qc);
      toast({ title: "Execution envelope updated" });
    },
    onError: (error: Error) => toast({ title: "Could not configure execution", description: error.message, variant: "destructive" }),
  });
}

export function useEvaluateStrategicGovernance() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ decision_id }: { decision_id: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_governance_evaluations").insert({
        user_id: user.id,
        decision_id,
        requested_action: "autonomous_execute",
      }).select().single();
      if (error) throw error;
      return data as StrategicGovernanceEvaluation;
    },
    onSuccess: (evaluation) => {
      invalidateGovernance(qc);
      toast({
        title: evaluation.result === "allow" ? "Bounded execution allowed" : evaluation.result === "review" ? "Review required" : "Execution blocked",
        description: Array.isArray(evaluation.reasons) ? evaluation.reasons[0] : undefined,
        variant: evaluation.result === "block" ? "destructive" : "default",
      });
    },
    onError: (error: Error) => toast({ title: "Governance evaluation failed", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateApprovalRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" | "cancelled" }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_approval_requests")
        .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq("id", id).eq("user_id", user.id).select().single();
      if (error) throw error;
      return data as StrategicApprovalRequest;
    },
    onSuccess: (request) => {
      invalidateGovernance(qc);
      toast({ title: `${request.approval_type} approval ${request.status}` });
    },
    onError: (error: Error) => toast({ title: "Could not update approval", description: error.message, variant: "destructive" }),
  });
}

export function useCreateStrategicStopRule() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: CreateStopRuleInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_stop_rules").insert({
        ...input,
        user_id: user.id,
        action: input.action ?? "block_autonomy",
        status: "active",
      }).select().single();
      if (error) throw error;
      return data as StrategicStopRule;
    },
    onSuccess: () => {
      invalidateGovernance(qc);
      toast({ title: "Stop rule created", description: "The rule will be checked before bounded autonomous execution." });
    },
    onError: (error: Error) => toast({ title: "Could not create stop rule", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateStrategicStopRule() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, status, triggered_reason }: { id: string; status: StopRuleStatus; triggered_reason?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const patch: Record<string, unknown> = { status };
      if (status === "triggered") {
        patch.triggered_reason = triggered_reason?.trim() || "Manual halt";
        patch.triggered_at = new Date().toISOString();
      }
      const { data, error } = await db.from("strategic_stop_rules")
        .update(patch).eq("id", id).eq("user_id", user.id).select().single();
      if (error) throw error;
      return data as StrategicStopRule;
    },
    onSuccess: () => invalidateGovernance(qc),
    onError: (error: Error) => toast({ title: "Could not update stop rule", description: error.message, variant: "destructive" }),
  });
}
