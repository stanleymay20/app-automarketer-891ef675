import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Outcome {
  id: string;
  user_id: string;
  prospect_id: string | null;
  proposal_id: string | null;
  meeting_id: string | null;
  outcome_type: "won" | "lost" | "churned" | "expanded" | "upsold";
  actual_value: number | null;
  expected_value: number | null;
  delta: number | null;
  confidence_before: number | null;
  confidence_after: number | null;
  currency: string | null;
  notes: string | null;
  created_at: string;
}

export interface LearningEvent {
  id: string;
  user_id: string;
  source_type: string;
  source_id: string | null;
  lesson: string;
  evidence: Record<string, unknown>;
  confidence_adjustment: number | null;
  future_impact: string | null;
  created_at: string;
}

export interface ModelRecommendation {
  id: string;
  user_id: string;
  model_area: "qualification" | "expected_value" | "autopilot" | "segment" | "outreach";
  recommendation: string;
  evidence: Record<string, unknown>;
  confidence: number | null;
  applied: boolean;
  applied_at: string | null;
  rule_version: string;
  created_at: string;
}

export function useOutcomes(limit = 50) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["outcomes", user?.id, limit],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as Outcome[];
      const { data, error } = await (supabase as any).from("outcomes")
        .select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data ?? []) as Outcome[];
    },
  });
}

export function useLearningEvents(limit = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["learning-events", user?.id, limit],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as LearningEvent[];
      const { data, error } = await (supabase as any).from("learning_events")
        .select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data ?? []) as LearningEvent[];
    },
  });
}

export function useModelRecommendations(opts?: { onlyOpen?: boolean }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["model-recommendations", user?.id, opts?.onlyOpen ?? true],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as ModelRecommendation[];
      let q = (supabase as any).from("model_recommendations").select("*")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
      if (opts?.onlyOpen !== false) q = q.eq("applied", false);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ModelRecommendation[];
    },
  });
}

export interface DecisionMetrics {
  pipeline_expected_value: number;
  expected_revenue_month: number;
  actual_revenue_month: number;
  proposal_acceptance_pct: number;
  proposals_decided: number;
  meeting_completion_pct: number;
  meeting_to_proposal_pct: number;
  autopilot_sent_7d: number;
  top_learning_lessons: LearningEvent[];
}

const monthStart = () => {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString();
};
const sevenDaysAgo = () => new Date(Date.now() - 7 * 86_400_000).toISOString();

export function useDecisionDashboard() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["decision-dashboard", user?.id],
    enabled: !!user,
    refetchInterval: 120_000,
    queryFn: async (): Promise<DecisionMetrics> => {
      if (!user) {
        return {
          pipeline_expected_value: 0, expected_revenue_month: 0, actual_revenue_month: 0,
          proposal_acceptance_pct: 0, proposals_decided: 0,
          meeting_completion_pct: 0, meeting_to_proposal_pct: 0,
          autopilot_sent_7d: 0, top_learning_lessons: [],
        };
      }
      const monthIso = monthStart();
      const weekIso = sevenDaysAgo();

      const [{ data: prospectsEv }, { data: monthOutcomes }, { data: monthProposals },
             { data: monthMeetings }, { data: meetingOuts }, { data: lessons },
             { data: autopilotRuns }] = await Promise.all([
        (supabase as any).from("prospects").select("expected_value")
          .eq("user_id", user.id).gt("expected_value", 0)
          .not("pipeline_stage", "in", "(won,lost)"),
        (supabase as any).from("outcomes").select("outcome_type,actual_value,expected_value")
          .eq("user_id", user.id).gte("created_at", monthIso),
        (supabase as any).from("proposals").select("status,proposal_value")
          .eq("user_id", user.id).gte("updated_at", monthIso),
        (supabase as any).from("meetings").select("status").eq("user_id", user.id)
          .gte("scheduled_at", monthIso),
        (supabase as any).from("meeting_outcomes").select("outcome_type")
          .eq("user_id", user.id).gte("created_at", monthIso),
        (supabase as any).from("learning_events").select("*")
          .eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
        (supabase as any).from("autopilot_runs").select("sent")
          .eq("user_id", user.id).gte("started_at", weekIso),
      ]);

      const pipeline_expected_value =
        (prospectsEv ?? []).reduce((a: number, r: any) => a + (Number(r.expected_value) || 0), 0);

      const monthExpected =
        (monthProposals ?? []).reduce((a: number, p: any) =>
          (p.status === "draft" || p.status === "sent" || p.status === "viewed")
            ? a + (Number(p.proposal_value) || 0) : a, 0);
      const monthActual =
        (monthOutcomes ?? []).filter((o: any) => o.outcome_type === "won")
          .reduce((a: number, o: any) => a + (Number(o.actual_value) || 0), 0);

      const decided = (monthProposals ?? []).filter((p: any) => p.status === "accepted" || p.status === "rejected");
      const accepted = decided.filter((p: any) => p.status === "accepted");
      const proposal_acceptance_pct = decided.length === 0
        ? 0 : Math.round((accepted.length / decided.length) * 100);

      const totalMtg = (monthMeetings ?? []).length;
      const completedMtg = (monthMeetings ?? []).filter((m: any) => m.status === "completed").length;
      const meeting_completion_pct = totalMtg === 0 ? 0 : Math.round((completedMtg / totalMtg) * 100);

      const proposalReq = (meetingOuts ?? []).filter((o: any) => o.outcome_type === "proposal_requested").length;
      const meeting_to_proposal_pct = completedMtg === 0
        ? 0 : Math.round((proposalReq / completedMtg) * 100);

      const autopilot_sent_7d = (autopilotRuns ?? []).reduce((a: number, r: any) => a + (Number(r.sent) || 0), 0);

      return {
        pipeline_expected_value,
        expected_revenue_month: monthExpected,
        actual_revenue_month: monthActual,
        proposal_acceptance_pct,
        proposals_decided: decided.length,
        meeting_completion_pct,
        meeting_to_proposal_pct,
        autopilot_sent_7d,
        top_learning_lessons: (lessons ?? []) as LearningEvent[],
      };
    },
  });
}
