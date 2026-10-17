import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type StrategicLearningKind = "strategic_postmortem" | "mechanism_hypothesis" | "correction" | "transfer_result";
export type OutcomeDirection = "positive" | "negative" | "mixed" | "neutral" | "unknown";
export type CausalStatus = "unknown" | "correlation" | "plausible" | "supported" | "challenged" | "falsified";
export type TransferabilityStatus = "unknown" | "local_only" | "candidate" | "tested" | "not_transferable";
export type StrategicLearningStatus = "active" | "superseded" | "invalidated";
export type EvidenceRelationship = "supports" | "challenges" | "context";
export type TransferTestStatus = "planned" | "running" | "completed" | "cancelled";
export type TransferTestResult = "unknown" | "supported" | "mixed" | "challenged" | "falsified";

export interface StrategicLearningEvent {
  id: string;
  user_id: string;
  app_id: string | null;
  goal_id: string | null;
  decision_id: string | null;
  market_option_id: string | null;
  scenario_id: string | null;
  source_type: string;
  source_id: string | null;
  learning_kind: StrategicLearningKind | "operational";
  lesson: string;
  evidence: Record<string, unknown>;
  action_summary: string | null;
  context: Record<string, unknown>;
  outcome_summary: string | null;
  outcome_direction: OutcomeDirection;
  mechanism_hypothesis: string | null;
  causal_status: CausalStatus;
  confidence: number | null;
  transferability_status: TransferabilityStatus;
  transferability_scope: string | null;
  transferability_conditions: unknown[];
  source_snapshot: Record<string, unknown>;
  status: StrategicLearningStatus;
  supersedes_learning_event_id: string | null;
  confidence_adjustment: number | null;
  future_impact: string | null;
  created_at: string;
  updated_at: string;
}

export interface StrategicLearningEvidenceLink {
  id: string;
  user_id: string;
  learning_event_id: string;
  evidence_item_id: string;
  relationship: EvidenceRelationship;
  notes: string | null;
  created_at: string;
}

export interface StrategicEvidenceOption {
  id: string;
  app_id: string | null;
  decision_id: string | null;
  item_type: "observation" | "inference" | "assumption" | "unknown";
  claim: string;
  status: string;
  confidence: number | null;
  evidence_strength: number | null;
}

export interface StrategicLearningTransferTest {
  id: string;
  user_id: string;
  source_learning_event_id: string;
  target_app_id: string | null;
  target_decision_id: string | null;
  evidence_item_id: string | null;
  target_market: string | null;
  target_segment: string | null;
  test_title: string;
  hypothesis: string;
  method: string | null;
  status: TransferTestStatus;
  result: TransferTestResult;
  confidence_before: number | null;
  confidence_after: number | null;
  outcome_summary: string | null;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateStrategicLearningInput {
  app_id: string;
  goal_id?: string;
  decision_id?: string;
  market_option_id?: string;
  scenario_id?: string;
  source_type?: "strategic_decision" | "campaign" | "experiment" | "market" | "scenario" | "manual" | "transfer_test";
  source_id?: string;
  learning_kind: StrategicLearningKind;
  lesson: string;
  action_summary?: string;
  context?: Record<string, unknown>;
  outcome_summary?: string;
  outcome_direction?: OutcomeDirection;
  mechanism_hypothesis?: string;
  causal_status?: CausalStatus;
  confidence?: number;
  transferability_status?: TransferabilityStatus;
  transferability_scope?: string;
  transferability_conditions?: string[];
  source_snapshot?: Record<string, unknown>;
  future_impact?: string;
  supersedes_learning_event_id?: string;
}

export interface CreateTransferTestInput {
  source_learning_event_id: string;
  target_app_id?: string;
  target_decision_id?: string;
  evidence_item_id?: string;
  target_market?: string;
  target_segment?: string;
  test_title: string;
  hypothesis: string;
  method?: string;
  confidence_before?: number;
  notes?: string;
}

const db = supabase as any;

export function useStrategicMemory(appId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["strategic-memory", user?.id, appId ?? "all"],
    enabled: !!user,
    queryFn: async () => {
      if (!user) {
        return {
          learnings: [] as StrategicLearningEvent[],
          evidenceLinks: [] as StrategicLearningEvidenceLink[],
          evidenceOptions: [] as StrategicEvidenceOption[],
          transferTests: [] as StrategicLearningTransferTest[],
        };
      }

      let learningQuery = db
        .from("learning_events")
        .select("*")
        .eq("user_id", user.id)
        .neq("learning_kind", "operational")
        .order("created_at", { ascending: false })
        .limit(150);
      if (appId) learningQuery = learningQuery.eq("app_id", appId);

      let evidenceQuery = db
        .from("strategic_evidence_items")
        .select("id,app_id,decision_id,item_type,claim,status,confidence,evidence_strength")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(150);
      if (appId) evidenceQuery = evidenceQuery.eq("app_id", appId);

      const [learningRes, evidenceRes] = await Promise.all([learningQuery, evidenceQuery]);
      if (learningRes.error) throw learningRes.error;
      if (evidenceRes.error) throw evidenceRes.error;

      const learnings = (learningRes.data ?? []) as StrategicLearningEvent[];
      const evidenceOptions = (evidenceRes.data ?? []) as StrategicEvidenceOption[];
      if (!learnings.length) {
        return { learnings, evidenceOptions, evidenceLinks: [], transferTests: [] };
      }

      const learningIds = learnings.map((item) => item.id);
      const [linkRes, transferRes] = await Promise.all([
        db.from("strategic_learning_evidence_links")
          .select("*").eq("user_id", user.id).in("learning_event_id", learningIds)
          .order("created_at", { ascending: true }),
        db.from("strategic_learning_transfer_tests")
          .select("*").eq("user_id", user.id).in("source_learning_event_id", learningIds)
          .order("created_at", { ascending: false }),
      ]);
      if (linkRes.error) throw linkRes.error;
      if (transferRes.error) throw transferRes.error;

      return {
        learnings,
        evidenceOptions,
        evidenceLinks: (linkRes.data ?? []) as StrategicLearningEvidenceLink[],
        transferTests: (transferRes.data ?? []) as StrategicLearningTransferTest[],
      };
    },
  });
}

function invalidateMemory(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["strategic-memory"] });
  qc.invalidateQueries({ queryKey: ["learning-events"] });
}

export function useCreateStrategicLearning() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: CreateStrategicLearningInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("learning_events").insert({
        user_id: user.id,
        app_id: input.app_id,
        goal_id: input.goal_id ?? null,
        decision_id: input.decision_id ?? null,
        market_option_id: input.market_option_id ?? null,
        scenario_id: input.scenario_id ?? null,
        source_type: input.source_type ?? "manual",
        source_id: input.source_id ?? input.decision_id ?? null,
        learning_kind: input.learning_kind,
        lesson: input.lesson,
        evidence: {},
        action_summary: input.action_summary ?? null,
        context: input.context ?? {},
        outcome_summary: input.outcome_summary ?? null,
        outcome_direction: input.outcome_direction ?? "unknown",
        mechanism_hypothesis: input.mechanism_hypothesis ?? null,
        causal_status: input.causal_status ?? "unknown",
        confidence: input.confidence ?? null,
        transferability_status: input.transferability_status ?? "unknown",
        transferability_scope: input.transferability_scope ?? null,
        transferability_conditions: input.transferability_conditions ?? [],
        source_snapshot: input.source_snapshot ?? {},
        future_impact: input.future_impact ?? null,
        supersedes_learning_event_id: input.supersedes_learning_event_id ?? null,
      }).select().single();
      if (error) throw error;
      return data as StrategicLearningEvent;
    },
    onSuccess: () => {
      invalidateMemory(qc);
      toast({ title: "Strategic learning recorded", description: "The mechanism remains a hypothesis until evidence justifies stronger language." });
    },
    onError: (error: Error) => toast({ title: "Could not record learning", description: error.message, variant: "destructive" }),
  });
}

export function useLinkStrategicLearningEvidence() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ learning_event_id, evidence_item_id, relationship, notes }: {
      learning_event_id: string;
      evidence_item_id: string;
      relationship: EvidenceRelationship;
      notes?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_learning_evidence_links").insert({
        user_id: user.id,
        learning_event_id,
        evidence_item_id,
        relationship,
        notes: notes?.trim() || null,
      }).select().single();
      if (error) throw error;
      return data as StrategicLearningEvidenceLink;
    },
    onSuccess: () => {
      invalidateMemory(qc);
      toast({ title: "Evidence linked" });
    },
    onError: (error: Error) => toast({ title: "Could not link evidence", description: error.message, variant: "destructive" }),
  });
}

export function useCreateStrategicTransferTest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: CreateTransferTestInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_learning_transfer_tests").insert({
        ...input,
        user_id: user.id,
        status: "planned",
        result: "unknown",
      }).select().single();
      if (error) throw error;
      return data as StrategicLearningTransferTest;
    },
    onSuccess: () => {
      invalidateMemory(qc);
      toast({ title: "Transfer test planned", description: "Test the mechanism in the new context before generalising it." });
    },
    onError: (error: Error) => toast({ title: "Could not create transfer test", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateStrategicTransferTest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, patch }: {
      id: string;
      patch: Partial<Pick<StrategicLearningTransferTest,
        "status" | "result" | "confidence_after" | "outcome_summary" | "notes" | "evidence_item_id"
      >>;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("strategic_learning_transfer_tests")
        .update(patch).eq("id", id).eq("user_id", user.id).select().single();
      if (error) throw error;
      return data as StrategicLearningTransferTest;
    },
    onSuccess: (test) => {
      invalidateMemory(qc);
      toast({ title: test.status === "completed" ? "Transfer test completed" : "Transfer test updated" });
    },
    onError: (error: Error) => toast({ title: "Could not update transfer test", description: error.message, variant: "destructive" }),
  });
}

export function useInvalidateStrategicLearning() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db.from("learning_events")
        .update({ status: "invalidated" })
        .eq("id", id).eq("user_id", user.id).neq("learning_kind", "operational")
        .select().single();
      if (error) throw error;
      return data as StrategicLearningEvent;
    },
    onSuccess: () => {
      invalidateMemory(qc);
      toast({ title: "Learning invalidated", description: "The historical record remains visible instead of being silently rewritten." });
    },
    onError: (error: Error) => toast({ title: "Could not invalidate learning", description: error.message, variant: "destructive" }),
  });
}
