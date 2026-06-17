import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface PipelineStepResult {
  step: "enrich-prospect" | "qualify-prospect" | "estimate-prospect-value";
  ok: boolean;
  status?: number;
  error?: string;
}

export interface PipelinePerProspect {
  prospect_id: string;
  ok: boolean;
  routing: "queued" | "review_required" | null;
  steps: PipelineStepResult[];
  summary: {
    enrichment_confidence?: number | null;
    opportunity_score?: number | null;
    opportunity_confidence?: number | null;
    segment?: string | null;
    expected_value?: number | null;
    expected_value_confidence?: number | null;
    value_currency?: string | null;
    review_worthy?: boolean;
  };
  error?: string;
}

export interface RunPipelineInput {
  prospect_id?: string;
  app_id?: string;
  limit?: number;
  mode?: "single" | "batch";
}

export interface RunPipelineResult {
  ok: boolean;
  mode: "single" | "batch";
  processed: number;
  succeeded: number;
  failed: number;
  routing_counts: Record<string, number>;
  results: PipelinePerProspect[];
  rule_version: string;
  message?: string;
}

/** Wave-4 step 6 — manual orchestrator (enrich -> qualify -> estimate). No autopilot. */
export function useRunProspectPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RunPipelineInput) => {
      const { data, error } = await supabase.functions.invoke<RunPipelineResult>(
        "process-prospect-pipeline",
        { body: input },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error("Pipeline failed");
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      if (d.processed === 0) {
        toast({ title: "Nothing to process", description: d.message ?? "All caught up." });
        return;
      }
      const queued = d.routing_counts.queued ?? 0;
      const review = d.routing_counts.review_required ?? 0;
      toast({
        title: `Pipeline · ${d.succeeded}/${d.processed} succeeded`,
        description: `${queued} queued · ${review} need review${d.failed ? ` · ${d.failed} failed` : ""}`,
        variant: d.failed > 0 ? "destructive" : "default",
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Pipeline failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });
}
