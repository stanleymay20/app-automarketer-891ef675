import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type EvidenceItemType = "observation" | "inference" | "assumption" | "unknown";
export type EvidenceSourceType =
  | "manual"
  | "analytics"
  | "customer"
  | "market"
  | "competitor"
  | "experiment"
  | "document"
  | "model"
  | "other";
export type EvidenceStatus = "active" | "validated" | "invalidated" | "resolved" | "superseded";
export type QuestionStatus = "open" | "answered" | "dismissed";
export type QuestionEffort = "low" | "medium" | "high";

export interface StrategicEvidenceItem {
  id: string;
  user_id: string;
  app_id: string | null;
  goal_id: string | null;
  decision_id: string | null;
  item_type: EvidenceItemType;
  claim: string;
  source_type: EvidenceSourceType;
  source_reference: string | null;
  confidence: number | null;
  evidence_strength: number | null;
  impact_if_wrong: number;
  decision_relevance: number;
  status: EvidenceStatus;
  verification_method: string | null;
  observed_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StrategicQuestion {
  id: string;
  user_id: string;
  app_id: string | null;
  goal_id: string | null;
  decision_id: string | null;
  question: string;
  current_confidence: number;
  decision_impact: number;
  answerability: number;
  urgency: number;
  effort: QuestionEffort;
  information_value_score: number;
  status: QuestionStatus;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEvidenceInput {
  app_id: string;
  goal_id?: string;
  decision_id?: string;
  item_type: EvidenceItemType;
  claim: string;
  source_type?: EvidenceSourceType;
  source_reference?: string;
  confidence?: number;
  evidence_strength?: number;
  impact_if_wrong?: number;
  decision_relevance?: number;
  verification_method?: string;
  observed_at?: string;
}

export interface CreateQuestionInput {
  app_id: string;
  goal_id?: string;
  decision_id?: string;
  question: string;
  current_confidence?: number;
  decision_impact?: number;
  answerability?: number;
  urgency?: number;
  effort?: QuestionEffort;
}

const db = supabase as any;

export function useStrategicEvidence(appId?: string, limit = 100) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["strategic-evidence", user?.id, appId ?? "all", limit],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as StrategicEvidenceItem[];
      let query = db
        .from("strategic_evidence_items")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (appId) query = query.eq("app_id", appId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as StrategicEvidenceItem[];
    },
  });
}

export function useCreateStrategicEvidence() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateEvidenceInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("strategic_evidence_items")
        .insert({
          ...input,
          user_id: user.id,
          source_type: input.source_type ?? "manual",
          impact_if_wrong: input.impact_if_wrong ?? 50,
          decision_relevance: input.decision_relevance ?? 50,
          status: "active",
        })
        .select()
        .single();
      if (error) throw error;
      return data as StrategicEvidenceItem;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategic-evidence"] });
      toast({ title: "Evidence recorded", description: "The claim is now classified and auditable." });
    },
    onError: (error: Error) =>
      toast({ title: "Could not record evidence", description: error.message, variant: "destructive" }),
  });
}

export function useUpdateStrategicEvidenceStatus() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status, resolution }: { id: string; status: EvidenceStatus; resolution?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const patch: Record<string, unknown> = { status };
      if (["resolved", "invalidated", "superseded"].includes(status)) {
        patch.resolved_at = new Date().toISOString();
        if (resolution?.trim()) patch.resolution = resolution.trim();
      }
      const { data, error } = await db
        .from("strategic_evidence_items")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single();
      if (error) throw error;
      return data as StrategicEvidenceItem;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategic-evidence"] }),
    onError: (error: Error) =>
      toast({ title: "Could not update evidence", description: error.message, variant: "destructive" }),
  });
}

export function useStrategicQuestions(appId?: string, limit = 100) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["strategic-questions", user?.id, appId ?? "all", limit],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as StrategicQuestion[];
      let query = db
        .from("strategic_questions")
        .select("*")
        .eq("user_id", user.id)
        .order("information_value_score", { ascending: false })
        .order("urgency", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (appId) query = query.eq("app_id", appId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as StrategicQuestion[];
    },
  });
}

export function useCreateStrategicQuestion() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateQuestionInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await db
        .from("strategic_questions")
        .insert({
          ...input,
          user_id: user.id,
          current_confidence: input.current_confidence ?? 50,
          decision_impact: input.decision_impact ?? 50,
          answerability: input.answerability ?? 50,
          urgency: input.urgency ?? 50,
          effort: input.effort ?? "medium",
          status: "open",
        })
        .select()
        .single();
      if (error) throw error;
      return data as StrategicQuestion;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategic-questions"] });
      toast({ title: "Question added", description: "It will be ranked by uncertainty, impact and answerability." });
    },
    onError: (error: Error) =>
      toast({ title: "Could not add question", description: error.message, variant: "destructive" }),
  });
}

export function useResolveStrategicQuestion() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status, answer }: { id: string; status: "answered" | "dismissed"; answer?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const patch: Record<string, unknown> = { status };
      if (status === "answered") {
        patch.answer = answer?.trim() || "Answered outside ScrollMarketer";
        patch.answered_at = new Date().toISOString();
      }
      const { data, error } = await db
        .from("strategic_questions")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single();
      if (error) throw error;
      return data as StrategicQuestion;
    },
    onSuccess: (question) => {
      qc.invalidateQueries({ queryKey: ["strategic-questions"] });
      toast({ title: question.status === "answered" ? "Question answered" : "Question dismissed" });
    },
    onError: (error: Error) =>
      toast({ title: "Could not update question", description: error.message, variant: "destructive" }),
  });
}
