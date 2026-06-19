import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface DawnRun {
  id: string;
  user_id: string;
  app_id: string | null;
  started_at: string;
  completed_at: string | null;
  status: "running" | "completed" | "partial" | "failed";
  prospects_discovered: number;
  prospects_enriched: number;
  prospects_qualified: number;
  prospects_auto_sent: number;
  prospects_sent_to_review: number;
  content_generated: number;
  content_scheduled: number;
  proposals_created: number;
  followups_created: number;
  revenue_expected: number;
  errors: { module: string; message: string }[];
  summary: string | null;
  brief: any;
  details: Record<string, unknown>;
}

export function useDawnRuns(limit = 20) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dawn-runs", user?.id, limit],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("dawn_autopilot_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as DawnRun[];
    },
  });
}

export function useLatestDawnRun() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dawn-runs-latest", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("dawn_autopilot_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DawnRun | null;
    },
  });
}

export function useRunDawnNow() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase.functions.invoke("dawn-marketing-autopilot", {
        body: { user_id: user.id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dawn-runs"] });
      qc.invalidateQueries({ queryKey: ["dawn-runs-latest"] });
      toast({ title: "Dawn Autopilot started", description: "Refresh in a minute to see results." });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to run", description: e.message, variant: "destructive" }),
  });
}
