import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type ReplyChannel = "email" | "linkedin" | "x" | "manual" | "other";
export type ReplyDirection = "inbound" | "outbound";
export type ReplySource = "manual" | "edge" | "gmail" | "outlook" | "webhook";

export interface ProspectReply {
  id: string;
  user_id: string;
  prospect_id: string;
  channel: ReplyChannel;
  direction: ReplyDirection;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  body: string | null;
  received_at: string;
  source: ReplySource;
  external_id: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface ReplyWithProspect extends ProspectReply {
  prospect?: {
    id: string;
    name: string;
    category: string;
    stage: string;
    contact_name: string | null;
  } | null;
}

export function useReplies(opts: { prospectId?: string; limit?: number } = {}) {
  const { prospectId, limit = 200 } = opts;
  return useQuery({
    queryKey: ["replies", prospectId ?? "all"],
    queryFn: async () => {
      let q = (supabase as any)
        .from("prospect_replies")
        .select("*, prospect:prospects(id,name,category,stage,contact_name)")
        .order("received_at", { ascending: false })
        .limit(limit);
      if (prospectId) q = q.eq("prospect_id", prospectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ReplyWithProspect[];
    },
  });
}

export interface RecordReplyInput {
  prospect_id: string;
  channel?: ReplyChannel;
  from_address?: string;
  from_name?: string;
  subject?: string;
  body: string;
  received_at?: string;
}

export function useRecordReply() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: RecordReplyInput) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) throw new Error("Not signed in");
      const { data, error } = await (supabase as any)
        .from("prospect_replies")
        .insert({
          user_id: uid,
          prospect_id: input.prospect_id,
          channel: input.channel || "manual",
          direction: "inbound",
          source: "manual",
          from_address: input.from_address || null,
          from_name: input.from_name || null,
          subject: input.subject || null,
          body: input.body,
          received_at: input.received_at || new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["replies"] });
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospect-actions"] });
      qc.invalidateQueries({ queryKey: ["today"] });
      toast({ title: "Reply recorded", description: "Prospect moved to Responded." });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't record reply",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });
}
