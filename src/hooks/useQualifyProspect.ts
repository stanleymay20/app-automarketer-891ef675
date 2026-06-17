import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface QualifyProspectResult {
  ok: boolean;
  prospect: Record<string, unknown>;
  opportunity_score: number;
  opportunity_confidence: number;
  segment: "hot" | "warm" | "nurture" | "disqualify";
  rule_version: string;
}

/** Wave-4 step 4 — manual qualification trigger. No autopilot here. */
export function useQualifyProspect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (prospect_id: string) => {
      const { data, error } = await supabase.functions.invoke<QualifyProspectResult>(
        "qualify-prospect",
        { body: { prospect_id } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error("Qualification failed");
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({
        title: `Qualified · ${d.segment.toUpperCase()}`,
        description: `Opportunity ${d.opportunity_score}/100 · confidence ${d.opportunity_confidence}/100`,
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Qualification failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });
}
