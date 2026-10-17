import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { CausalStatus, TransferabilityStatus } from "@/hooks/useStrategicMemory";

const db = supabase as any;

export function useReviewStrategicLearningState() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      causal_status,
      confidence,
      transferability_status,
      transferability_scope,
    }: {
      id: string;
      causal_status: CausalStatus;
      confidence: number;
      transferability_status: TransferabilityStatus;
      transferability_scope?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const safeConfidence = Math.min(100, Math.max(0, Number(confidence)));
      const { data, error } = await db
        .from("learning_events")
        .update({
          causal_status,
          confidence: safeConfidence,
          transferability_status,
          transferability_scope: transferability_scope?.trim() || null,
        })
        .eq("id", id)
        .eq("user_id", user.id)
        .neq("learning_kind", "operational")
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategic-memory"] });
      qc.invalidateQueries({ queryKey: ["learning-events"] });
      toast({ title: "Learning state reviewed", description: "Database evidence guards accepted the updated epistemic state." });
    },
    onError: (error: Error) =>
      toast({ title: "Evidence does not support that state", description: error.message, variant: "destructive" }),
  });
}
