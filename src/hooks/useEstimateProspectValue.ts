import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface EstimateProspectValueResult {
  ok: boolean;
  prospect: Record<string, unknown>;
  deal_probability: number;
  estimated_value: number;
  baseline_expected_value: number;
  expected_value: number;
  expected_value_confidence: number;
  value_currency: string;
  value_reasoning: string;
  assumptions: string[];
  risk_factors: string[];
  upside_factors: string[];
  review_worthy: boolean;
  rule_version: string;
}

const fmt = (v: number, ccy: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: ccy,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v.toFixed(0)} ${ccy}`;
  }
};

/** Wave-4 step 5 — manual expected-value estimate. No autopilot here. */
export function useEstimateProspectValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (prospect_id: string) => {
      const { data, error } = await supabase.functions.invoke<EstimateProspectValueResult>(
        "estimate-prospect-value",
        { body: { prospect_id } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error("Estimate failed");
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({
        title: `Expected value ${fmt(d.expected_value, d.value_currency)}`,
        description: `${Math.round(d.deal_probability * 100)}% × ${fmt(
          d.estimated_value,
          d.value_currency,
        )} · confidence ${d.expected_value_confidence}/100${
          d.review_worthy ? " · review-worthy" : ""
        }`,
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Value estimate failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });
}
