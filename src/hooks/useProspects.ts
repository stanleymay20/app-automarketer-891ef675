import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type ProspectCategory = "customer" | "grant" | "partner" | "investor" | "community";

export interface Prospect {
  id: string;
  user_id: string;
  app_id: string | null;
  category: ProspectCategory;
  name: string;
  description: string | null;
  url: string | null;
  location: string | null;
  deadline: string | null;
  fit_score: number;
  opportunity_score: number;
  urgency_score: number;
  reachability_score: number;
  prospect_score: number;
  match_reason: string | null;
  signals: any;
  status: string;
  saved_at: string | null;
  contacted_at: string | null;
  responded_at: string | null;
  converted_at: string | null;
  revenue_attributed: number;
  source: string;
  created_at: string;
}

export function useProspects(appId?: string) {
  return useQuery({
    queryKey: ["prospects", appId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("prospects").select("*").order("prospect_score", { ascending: false }).limit(200);
      if (appId) q = q.eq("app_id", appId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Prospect[];
    },
  });
}

export function useDiscoverProspects() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ appId, categories }: { appId?: string; categories?: ProspectCategory[] }) => {
      const { data, error } = await supabase.functions.invoke("discover-prospects", {
        body: { app_id: appId, categories },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({ title: `${d?.created ?? 0} prospects discovered` });
    },
    onError: (e: any) => toast({ title: "Discovery failed", description: e.message, variant: "destructive" }),
  });
}

export type ProspectAction =
  | "save" | "watch" | "dismiss" | "view"
  | "mark_contacted" | "mark_responded" | "mark_converted"
  | "generate_outreach" | "generate_campaign";

export function useProspectAction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ prospect_id, action, channel }: { prospect_id: string; action: ProspectAction; channel?: string }) => {
      const { data, error } = await supabase.functions.invoke("prospect-action", {
        body: { prospect_id, action, channel },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { data, action };
    },
    onSuccess: ({ action }) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospect-actions"] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      const labels: Partial<Record<ProspectAction, string>> = {
        save: "Saved",
        watch: "Added to watchlist",
        dismiss: "Dismissed",
        mark_contacted: "Marked as contacted",
        mark_responded: "Marked as responded",
        mark_converted: "Marked as converted",
        generate_outreach: "Outreach drafted",
        generate_campaign: "Campaign created",
      };
      if (labels[action]) toast({ title: labels[action]! });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });
}

export function useProspectActions(prospectId?: string) {
  return useQuery({
    queryKey: ["prospect-actions", prospectId],
    enabled: !!prospectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospect_actions")
        .select("*")
        .eq("prospect_id", prospectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
