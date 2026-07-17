import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type NurtureSequence = {
  id: string;
  user_id: string;
  app_id: string | null;
  name: string;
  description: string | null;
  trigger_type: string;
  is_active: boolean;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  created_at: string;
  updated_at: string;
};

export type NurtureStep = {
  id: string;
  sequence_id: string;
  step_order: number;
  step_type: string;
  delay_hours: number;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  is_active: boolean;
};

export type Subscriber = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  consent_source: string | null;
  consent_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
  app_id: string | null;
};

export function useNurtureSequences() {
  return useQuery({
    queryKey: ["nurture-sequences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nurture_sequences")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as NurtureSequence[];
    },
  });
}

export function useNurtureSteps(sequenceId: string | null) {
  return useQuery({
    queryKey: ["nurture-steps", sequenceId],
    enabled: !!sequenceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nurture_steps")
        .select("*")
        .eq("sequence_id", sequenceId!)
        .order("step_order", { ascending: true });
      if (error) throw error;
      return data as NurtureStep[];
    },
  });
}

export function useSubscribers(status?: string) {
  return useQuery({
    queryKey: ["email-subscribers", status ?? "all"],
    queryFn: async () => {
      let q = supabase.from("email_subscribers").select("*").order("created_at", { ascending: false }).limit(500);
      if (status && status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return data as Subscriber[];
    },
  });
}

export function useSubscriberCounts() {
  return useQuery({
    queryKey: ["email-subscriber-counts"],
    queryFn: async () => {
      const statuses = ["subscribed", "pending", "unsubscribed", "bounced", "complained"];
      const results: Record<string, number> = {};
      for (const s of statuses) {
        const { count } = await supabase
          .from("email_subscribers")
          .select("id", { count: "exact", head: true })
          .eq("status", s);
        results[s] = count ?? 0;
      }
      return results;
    },
  });
}

export function useCreateSequence() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: Partial<NurtureSequence> & { name: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("nurture_sequences")
        .insert({ ...input, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data as NurtureSequence;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nurture-sequences"] });
      toast({ title: "Sequence created" });
    },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<NurtureSequence> & { id: string }) => {
      const { data, error } = await supabase
        .from("nurture_sequences")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as NurtureSequence;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture-sequences"] }),
  });
}

export function useDeleteSequence() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("nurture_sequences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nurture-sequences"] });
      toast({ title: "Sequence deleted" });
    },
  });
}

export function useUpsertStep() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: Partial<NurtureStep> & { sequence_id: string; subject: string; step_order: number }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const payload = { ...input, user_id: user.id };
      const { data, error } = await supabase
        .from("nurture_steps")
        .upsert(payload, { onConflict: "sequence_id,step_order" })
        .select()
        .single();
      if (error) throw error;
      return data as NurtureStep;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["nurture-steps", vars.sequence_id] });
      toast({ title: "Step saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; sequence_id: string }) => {
      const { error } = await supabase.from("nurture_steps").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["nurture-steps", vars.sequence_id] }),
  });
}

export function useUnsubscribeSubscriber() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_subscribers")
        .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-subscribers"] });
      qc.invalidateQueries({ queryKey: ["email-subscriber-counts"] });
      toast({ title: "Unsubscribed" });
    },
  });
}
