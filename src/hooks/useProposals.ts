import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type ProposalStatus = "draft" | "sent" | "viewed" | "accepted" | "rejected" | "expired";

export interface Proposal {
  id: string;
  user_id: string;
  prospect_id: string | null;
  app_id: string | null;
  meeting_id: string | null;
  proposal_title: string;
  proposal_value: number | null;
  currency: string;
  proposal_text: string | null;
  scope: string | null;
  deliverables: string[];
  timeline: string | null;
  pricing_model: string | null;
  pricing_options: Array<Record<string, unknown>>;
  roi_estimate: string | null;
  next_steps: string | null;
  status: ProposalStatus;
  rejection_reason: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  expires_at: string | null;
  evidence: Record<string, unknown>;
  reasoning: string | null;
  confidence: number | null;
  ai_model: string | null;
  ai_prompt_version: string | null;
  created_at: string;
  updated_at: string;
}

export function useProposals(opts?: { status?: ProposalStatus | "all"; prospectId?: string }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["proposals", user?.id, opts?.status ?? "all", opts?.prospectId ?? null],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as Proposal[];
      let q = (supabase as any).from("proposals").select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (opts?.status && opts.status !== "all") q = q.eq("status", opts.status);
      if (opts?.prospectId) q = q.eq("prospect_id", opts.prospectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Proposal[];
    },
  });
}

export function usePendingProposalsCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["proposals-pending-count", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await (supabase as any).from("proposals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("status", ["draft", "sent", "viewed"]);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export interface GenerateProposalInput {
  prospect_id: string;
  app_id?: string | null;
  meeting_id?: string | null;
  proposal_title?: string;
  notes?: string;
}

export function useGenerateProposal() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: GenerateProposalInput) => {
      const { data, error } = await supabase.functions.invoke("generate-proposal", { body: input });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (data as any).proposal as Proposal;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast({ title: "Proposal drafted", description: "Review and edit before sending." });
    },
    onError: (e: Error) => toast({ title: "Generate failed", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateProposal() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Proposal> }) => {
      if (!user) throw new Error("Not authenticated");
      const safe: Record<string, unknown> = {};
      for (const k of ["proposal_title", "proposal_value", "currency", "proposal_text",
                       "scope", "deliverables", "timeline", "pricing_model", "pricing_options",
                       "roi_estimate", "next_steps", "expires_at"]) {
        if (k in patch) safe[k] = (patch as any)[k];
      }
      const { data, error } = await (supabase as any).from("proposals")
        .update(safe).eq("id", id).eq("user_id", user.id).select().single();
      if (error) throw error;
      return data as Proposal;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast({ title: "Proposal updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
}

/** Status transitions — SAFETY: only authenticated owners; trigger handles pipeline/outcome side-effects. */
export function useTransitionProposal() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, status, rejection_reason }:
      { id: string; status: ProposalStatus; rejection_reason?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const patch: Record<string, unknown> = { status };
      if (status === "rejected" && rejection_reason) patch.rejection_reason = rejection_reason.slice(0, 500);
      const { data, error } = await (supabase as any).from("proposals")
        .update(patch).eq("id", id).eq("user_id", user.id).select().single();
      if (error) throw error;
      try {
        await (supabase as any).from("automation_audit_log").insert({
          user_id: user.id,
          action_type: `proposal_${status}`,
          entity_type: "proposal",
          entity_id: id,
          details: { rule_version: "proposal-v1", status, rejection_reason: rejection_reason ?? null },
        });
      } catch { /* swallow */ }
      return data as Proposal;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["proposals-pending-count"] });
      qc.invalidateQueries({ queryKey: ["outcomes"] });
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["learning-events"] });
      toast({ title: `Proposal ${vars.status}` });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
}
