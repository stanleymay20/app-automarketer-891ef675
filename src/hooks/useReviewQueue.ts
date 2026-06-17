// Review-queue hooks: list prospects routed for human approval and
// approve / reject / approve+send them. NO autopilot, NO silent sends.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface ReviewProspect {
  id: string;
  user_id: string;
  app_id: string | null;
  name: string | null;
  company_name: string | null;
  contact_email: string | null;
  linkedin_url: string | null;
  segment: "hot" | "warm" | "nurture" | "disqualify" | null;
  segment_reason: string | null;
  opportunity_score: number | null;
  opportunity_confidence: number | null;
  expected_value: number | null;
  expected_value_confidence: number | null;
  value_currency: string | null;
  value_reasoning: string | null;
  review_status: "pending" | "approved" | "rejected" | null;
  review_reason: string | null;
  autopilot_state: string | null;
  icp_fit_evidence: string[] | null;
  buying_signal_evidence: string[] | null;
  urgency_evidence: string[] | null;
  reachability_evidence: string[] | null;
  icp_fit_reasoning: string | null;
  buying_signal_reasoning: string | null;
  enriched_at: string | null;
  updated_at: string;
  review_draft_subject: string | null;
  review_draft_body: string | null;
}

/** All prospects that need a human eye: pending review OR routed to review_required. */
export function useReviewQueue(appId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["review-queue", user?.id, appId ?? null],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as ReviewProspect[];
      let q = (supabase as any)
        .from("prospects")
        .select(
          "id,user_id,app_id,name,company_name,contact_email,linkedin_url,segment,segment_reason,opportunity_score,opportunity_confidence,expected_value,expected_value_confidence,value_currency,value_reasoning,review_status,review_reason,autopilot_state,icp_fit_evidence,buying_signal_evidence,urgency_evidence,reachability_evidence,icp_fit_reasoning,buying_signal_reasoning,enriched_at,updated_at,review_draft_subject,review_draft_body",
        )
        .eq("user_id", user.id)
        .or("review_status.eq.pending,autopilot_state.eq.review_required")
        .order("opportunity_score", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(100);
      if (appId) q = q.eq("app_id", appId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ReviewProspect[];
    },
  });
}

/** Lightweight pending count for the sidebar badge. */
export function useReviewPendingCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["review-queue-count", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await (supabase as any)
        .from("prospects")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .or("review_status.eq.pending,autopilot_state.eq.review_required");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

async function writeAudit(
  prospectId: string,
  userId: string,
  actionType: string,
  metadata: Record<string, unknown>,
) {
  try {
    await (supabase as any).from("automation_audit_log").insert({
      user_id: userId,
      action_type: actionType,
      entity_type: "prospect",
      entity_id: prospectId,
      metadata: { rule_version: "review-v1", ...metadata },
    });
  } catch (e) {
    console.warn("[review-queue] audit log failed", e);
  }
}

export function useApproveProspect() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (prospect_id: string) => {
      if (!user) throw new Error("Not authenticated");
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("prospects")
        .update({
          review_status: "approved",
          review_decided_at: nowIso,
          review_decided_by: user.id,
          autopilot_state: "queued",
        })
        .eq("id", prospect_id)
        .eq("user_id", user.id);
      if (error) throw error;
      await writeAudit(prospect_id, user.id, "prospect_review_approved", { decision: "approve_only" });
      return { prospect_id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["review-queue-count"] });
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({ title: "Approved", description: "Prospect queued for outreach." });
    },
    onError: (e: Error) => {
      toast({ title: "Approve failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useRejectProspect() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ prospect_id, reason }: { prospect_id: string; reason?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("prospects")
        .update({
          review_status: "rejected",
          review_decided_at: nowIso,
          review_decided_by: user.id,
          autopilot_state: "blocked",
          ...(reason ? { review_reason: reason.slice(0, 500) } : {}),
        })
        .eq("id", prospect_id)
        .eq("user_id", user.id);
      if (error) throw error;
      await writeAudit(prospect_id, user.id, "prospect_review_rejected", {
        decision: "reject",
        reason: reason ?? null,
      });
      return { prospect_id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["review-queue-count"] });
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({ title: "Rejected", description: "Prospect blocked from outreach." });
    },
    onError: (e: Error) => {
      toast({ title: "Reject failed", description: e.message, variant: "destructive" });
    },
  });
}

export interface ApproveAndSendInput {
  prospect_id: string;
  subject: string;
  body: string;
  to_address?: string;
}

/** Approve + send via send-outreach (hard approval gate, approved:true). */
export function useApproveAndSendProspect() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: ApproveAndSendInput) => {
      if (!user) throw new Error("Not authenticated");
      const { prospect_id, subject, body, to_address } = input;
      if (!subject.trim() || body.trim().length < 5) {
        throw new Error("Subject and a message body are required.");
      }

      // 1) Mark approved first (idempotent if user re-clicks).
      const nowIso = new Date().toISOString();
      const { error: upErr } = await supabase
        .from("prospects")
        .update({
          review_status: "approved",
          review_decided_at: nowIso,
          review_decided_by: user.id,
          autopilot_state: "queued",
        })
        .eq("id", prospect_id)
        .eq("user_id", user.id);
      if (upErr) throw upErr;

      // 2) Try send-outreach. If function missing / not configured, soft-fail
      //    so the user still sees the approval succeeded.
      let sendResult: { status?: string; message_id?: string; note?: string } | null = null;
      let sendError: string | null = null;
      try {
        const { data, error } = await supabase.functions.invoke("send-outreach", {
          body: { prospect_id, subject, body, to_address, approved: true },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        sendResult = data as any;
      } catch (e: any) {
        sendError = e?.message || "Sender unavailable";
      }

      await writeAudit(prospect_id, user.id, "prospect_review_approve_and_send", {
        decision: "approve_and_send",
        send_status: sendResult?.status ?? null,
        send_error: sendError,
      });

      return { sendResult, sendError };
    },
    onSuccess: ({ sendResult, sendError }) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["review-queue-count"] });
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospect-actions"] });

      if (sendError) {
        toast({
          title: "Approved · send unavailable",
          description: `Approved, but the sender failed: ${sendError}. The prospect is queued so you can retry.`,
          variant: "destructive",
        });
        return;
      }
      if (sendResult?.status === "pending_approval") {
        // Should not happen since we pass approved:true, but be explicit.
        toast({
          title: "Approved · awaiting send",
          description: "Send-outreach kept the message in pending_approval. Check email config.",
        });
        return;
      }
      toast({ title: "Approved & sent", description: "Outreach email dispatched." });
    },
    onError: (e: Error) => {
      toast({ title: "Approve & send failed", description: e.message, variant: "destructive" });
    },
  });
}

/** Persist a hand-edited outreach draft on the prospect (no state change, no send). */
export function useSaveReviewDraft() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ prospect_id, subject, body }: { prospect_id: string; subject: string; body: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("prospects")
        .update({
          review_draft_subject: subject.slice(0, 200) || null,
          review_draft_body: body.slice(0, 5000) || null,
        })
        .eq("id", prospect_id)
        .eq("user_id", user.id);
      if (error) throw error;
      await writeAudit(prospect_id, user.id, "prospect_review_draft_saved", {
        decision: "save_draft",
        subject_len: subject.length,
        body_len: body.length,
      });
      return { prospect_id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast({ title: "Draft saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Save draft failed", description: e.message, variant: "destructive" });
    },
  });
}
