import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface EnrichProspectResult {
  ok: boolean;
  prospect: Record<string, unknown>;
  sources: string[];
  confidence: number;
}

/**
 * Manually trigger enrichment for a single prospect.
 * Wave-4 step 3 — invocation only; no autopilot decisioning here.
 */
export function useEnrichProspect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (prospect_id: string) => {
      const { data, error } = await supabase.functions.invoke<EnrichProspectResult>(
        "enrich-prospect",
        { body: { prospect_id } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error("Enrichment failed");
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({
        title: "Prospect enriched",
        description: `Confidence ${data.confidence}/100 · sources: ${data.sources.join(", ") || "ai"}`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Enrichment failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}
