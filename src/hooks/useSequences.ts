import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type SequenceStatus =
  | "scheduled" | "sending" | "sent" | "skipped" | "paused" | "completed" | "failed";

export interface SequenceStep {
  id: string;
  user_id: string;
  prospect_id: string;
  sequence_name: string;
  step_number: number;
  scheduled_at: string;
  sent_at: string | null;
  status: SequenceStatus;
  subject: string | null;
  body: string | null;
  message_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function useSequences(opts: { prospectId?: string } = {}) {
  return useQuery({
    queryKey: ["sequences", opts.prospectId ?? "all"],
    queryFn: async () => {
      let q = (supabase as any).from("prospect_sequences")
        .select("*")
        .order("scheduled_at", { ascending: true });
      if (opts.prospectId) q = q.eq("prospect_id", opts.prospectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as SequenceStep[];
    },
    refetchInterval: 60_000,
  });
}

/** Aggregated counts for the Today dashboard. */
export function useSequenceStats() {
  return useQuery({
    queryKey: ["sequence-stats"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("prospect_sequences")
        .select("status, scheduled_at");
      if (error) throw error;
      const now = Date.now();
      const endOfDay = (() => { const d = new Date(); d.setHours(23,59,59,999); return d.getTime(); })();
      let running = 0, paused = 0, dueToday = 0, overdue = 0;
      for (const r of (data || []) as { status: string; scheduled_at: string }[]) {
        if (r.status === "scheduled") {
          running++;
          const t = new Date(r.scheduled_at).getTime();
          if (t < now) overdue++;
          else if (t <= endOfDay) dueToday++;
        } else if (r.status === "paused") paused++;
      }
      return { running, paused, dueToday, overdue };
    },
    refetchInterval: 60_000,
  });
}

export interface EnrollSequenceInput {
  prospect_id: string;
  sequence_name?: string;
  /** Day offsets from now for each step. Default = [0, 3, 7]. */
  step_days?: number[];
  /** Per-step subject/body templates (length should match step_days). */
  steps?: { subject?: string; body?: string }[];
  /** HARD APPROVAL GATE: only true after the user reviews + clicks Approve. */
  user_approved?: boolean;
}

export function useEnrollSequence() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: EnrollSequenceInput) => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) throw new Error("Not signed in");
      const days = input.step_days?.length ? input.step_days : [0, 3, 7];
      const now = Date.now();
      const approved = input.user_approved === true;
      const nowIso = new Date().toISOString();
      const rows = days.map((d, i) => ({
        user_id: uid,
        prospect_id: input.prospect_id,
        sequence_name: input.sequence_name || "default-3-step",
        step_number: i + 1,
        scheduled_at: new Date(now + d * 86_400_000).toISOString(),
        status: "scheduled" as SequenceStatus,
        subject: input.steps?.[i]?.subject ?? null,
        body: input.steps?.[i]?.body ?? null,
        user_approved: approved,
        approved_at: approved ? nowIso : null,
        approved_by: approved ? uid : null,
      }));
      const { data, error } = await (supabase as any)
        .from("prospect_sequences")
        .upsert(rows, { onConflict: "prospect_id,sequence_name,step_number" })
        .select();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      qc.invalidateQueries({ queryKey: ["sequence-stats"] });
      toast({
        title: vars.user_approved
          ? "Sequence approved & scheduled"
          : "Sequence saved (awaiting approval)",
        description: vars.user_approved
          ? "Approved follow-ups will go out automatically on schedule."
          : "Nothing will send until you approve.",
      });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't schedule sequence", description: e?.message, variant: "destructive" });
    },
  });
}

export function useUpdateSequenceStep() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SequenceStep> }) => {
      const { data, error } = await (supabase as any)
        .from("prospect_sequences").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      qc.invalidateQueries({ queryKey: ["sequence-stats"] });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't update step", description: e?.message, variant: "destructive" });
    },
  });
}

export interface SendOutreachInput {
  prospect_id: string;
  subject: string;
  body: string;
  to_address?: string;
  /** HARD APPROVAL GATE: must be true to actually send. Defaults to false. */
  approved?: boolean;
}

export function useSendOutreach() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: SendOutreachInput) => {
      const { data, error } = await supabase.functions.invoke("send-outreach", {
        body: { ...input, approved: input.approved === true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { status?: string; message_id?: string };
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospect-actions"] });
      qc.invalidateQueries({ queryKey: ["today-activity"] });
      if (d?.status === "pending_approval") {
        toast({
          title: "Saved for approval",
          description: "Email was NOT sent. Approve it to send.",
        });
      } else {
        toast({ title: "Email sent" });
      }
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't send email",
        description: e?.message || "Connect Resend or use mailto fallback.",
        variant: "destructive",
      });
    },
  });
}

export function useRunSequences() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-sequences", { body: {} });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { sent: number; failed: number; skipped: number; considered: number };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      qc.invalidateQueries({ queryKey: ["sequence-stats"] });
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({
        title: "Sequence runner",
        description: `Sent ${r.sent}, failed ${r.failed}, skipped ${r.skipped} of ${r.considered}.`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't run sequences", description: e?.message, variant: "destructive" });
    },
  });
}
