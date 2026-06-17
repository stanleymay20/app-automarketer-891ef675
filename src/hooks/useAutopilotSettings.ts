import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type Segment = "hot" | "warm" | "nurture" | "disqualify";

export interface AutopilotSettings {
  id: string;
  user_id: string;
  enabled: boolean;
  min_opportunity_score: number;
  min_confidence: number;
  daily_send_cap: number;
  max_auto_value: number;
  allowed_segments: Segment[];
  approval_required_segments: Segment[];
  sent_today: number;
  sent_today_date: string;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_AUTOPILOT: Omit<AutopilotSettings, "id" | "user_id" | "created_at" | "updated_at" | "sent_today" | "sent_today_date"> = {
  enabled: false,
  min_opportunity_score: 80,
  min_confidence: 60,
  daily_send_cap: 20,
  max_auto_value: 5000,
  allowed_segments: ["hot"],
  approval_required_segments: ["warm"],
};

export const HARD_DAILY_CAP = 50;

export function useAutopilotSettings() {
  return useQuery({
    queryKey: ["autopilot-settings"],
    queryFn: async (): Promise<AutopilotSettings | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await (supabase as any)
        .from("autopilot_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data as AutopilotSettings | null;
    },
  });
}

export function useUpdateAutopilotSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<AutopilotSettings, "id" | "user_id" | "created_at" | "updated_at" | "sent_today" | "sent_today_date">>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      // Enforce hard daily cap regardless of input
      const safePatch = { ...patch };
      if (typeof safePatch.daily_send_cap === "number") {
        safePatch.daily_send_cap = Math.min(HARD_DAILY_CAP, Math.max(0, Math.round(safePatch.daily_send_cap)));
      }
      if (typeof safePatch.min_opportunity_score === "number") {
        safePatch.min_opportunity_score = Math.min(100, Math.max(0, Math.round(safePatch.min_opportunity_score)));
      }
      if (typeof safePatch.min_confidence === "number") {
        safePatch.min_confidence = Math.min(100, Math.max(0, Math.round(safePatch.min_confidence)));
      }
      if (typeof safePatch.max_auto_value === "number") {
        safePatch.max_auto_value = Math.max(0, safePatch.max_auto_value);
      }

      const { data, error } = await (supabase as any)
        .from("autopilot_settings")
        .upsert({ user_id: user.id, ...DEFAULT_AUTOPILOT, ...safePatch }, { onConflict: "user_id" })
        .select()
        .single();
      if (error) throw error;
      return data as AutopilotSettings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot-settings"] });
      toast({ title: "Autopilot settings saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
}
