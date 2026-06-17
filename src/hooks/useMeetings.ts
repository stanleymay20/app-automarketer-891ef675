import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type MeetingStatus = "scheduled" | "completed" | "cancelled" | "no_show";
export type MeetingType = "discovery" | "demo" | "follow_up" | "closing" | "check_in" | "other";
export type MeetingSource = "manual" | "calendly" | "google_calendar" | "outlook" | "other";

export interface Meeting {
  id: string;
  user_id: string;
  prospect_id: string | null;
  app_id: string | null;
  proposal_id: string | null;
  title: string;
  meeting_type: MeetingType;
  scheduled_at: string;
  duration_minutes: number;
  meeting_url: string | null;
  location: string | null;
  agenda: string | null;
  notes: string | null;
  status: MeetingStatus;
  source: MeetingSource;
  external_id: string | null;
  external_url: string | null;
  external_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type MeetingOutcomeType =
  | "proposal_requested" | "follow_up" | "nurture" | "disqualified" | "won" | "lost";

export interface MeetingOutcome {
  id: string;
  user_id: string;
  meeting_id: string;
  outcome_type: MeetingOutcomeType;
  summary: string | null;
  objections: string[];
  opportunities: string[];
  next_action: string | null;
  confidence: number | null;
  created_at: string;
}

const MEETING_COLS =
  "id,user_id,prospect_id,app_id,proposal_id,title,meeting_type,scheduled_at,duration_minutes,meeting_url,location,agenda,notes,status,source,external_id,external_url,external_metadata,created_at,updated_at";

export function useMeetings(opts?: { appId?: string; status?: MeetingStatus | "all"; limit?: number }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["meetings", user?.id, opts?.appId ?? null, opts?.status ?? "all", opts?.limit ?? 50],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as Meeting[];
      let q = (supabase as any).from("meetings").select(MEETING_COLS)
        .eq("user_id", user.id)
        .order("scheduled_at", { ascending: false })
        .limit(opts?.limit ?? 50);
      if (opts?.appId) q = q.eq("app_id", opts.appId);
      if (opts?.status && opts.status !== "all") q = q.eq("status", opts.status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Meeting[];
    },
  });
}

export function useUpcomingMeetingsCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["meetings-upcoming-count", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!user) return 0;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      const { count, error } = await (supabase as any).from("meetings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "scheduled")
        .gte("scheduled_at", todayStart.toISOString())
        .lte("scheduled_at", todayEnd.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useMeetingOutcomes(meetingId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["meeting-outcomes", meetingId],
    enabled: !!user && !!meetingId,
    queryFn: async () => {
      if (!user || !meetingId) return [] as MeetingOutcome[];
      const { data, error } = await (supabase as any).from("meeting_outcomes")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MeetingOutcome[];
    },
  });
}

export interface CreateMeetingInput {
  title: string;
  scheduled_at: string;
  duration_minutes?: number;
  meeting_type?: MeetingType;
  prospect_id?: string | null;
  app_id?: string | null;
  meeting_url?: string;
  location?: string;
  agenda?: string;
  source?: MeetingSource;
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: CreateMeetingInput) => {
      if (!user) throw new Error("Not authenticated");
      if (!input.title?.trim()) throw new Error("Title is required");
      if (!input.scheduled_at) throw new Error("Date/time is required");
      const { data, error } = await (supabase as any).from("meetings").insert({
        user_id: user.id,
        title: input.title.trim().slice(0, 200),
        scheduled_at: input.scheduled_at,
        duration_minutes: Math.max(5, Math.min(480, input.duration_minutes ?? 30)),
        meeting_type: input.meeting_type ?? "discovery",
        prospect_id: input.prospect_id ?? null,
        app_id: input.app_id ?? null,
        meeting_url: input.meeting_url?.trim() || null,
        location: input.location?.trim() || null,
        agenda: input.agenda?.trim().slice(0, 4000) || null,
        source: input.source ?? "manual",
        status: "scheduled",
      }).select().single();
      if (error) throw error;
      return data as Meeting;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["meetings-upcoming-count"] });
      toast({ title: "Meeting saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateMeeting() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Meeting> }) => {
      if (!user) throw new Error("Not authenticated");
      const safe: Record<string, unknown> = {};
      for (const k of ["title", "agenda", "notes", "meeting_url", "location", "status",
                       "meeting_type", "duration_minutes", "scheduled_at",
                       "prospect_id", "app_id", "proposal_id"]) {
        if (k in patch) safe[k] = (patch as any)[k];
      }
      const { data, error } = await (supabase as any).from("meetings")
        .update(safe).eq("id", id).eq("user_id", user.id).select().single();
      if (error) throw error;
      return data as Meeting;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["meetings-upcoming-count"] });
      toast({ title: "Meeting updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
}

export interface RecordMeetingOutcomeInput {
  meeting_id: string;
  outcome_type: MeetingOutcomeType;
  summary?: string;
  objections?: string[];
  opportunities?: string[];
  next_action?: string;
  confidence?: number;
}

export function useRecordMeetingOutcome() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: RecordMeetingOutcomeInput) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await (supabase as any).from("meeting_outcomes").insert({
        user_id: user.id,
        meeting_id: input.meeting_id,
        outcome_type: input.outcome_type,
        summary: input.summary?.slice(0, 4000) || null,
        objections: input.objections?.slice(0, 10) ?? [],
        opportunities: input.opportunities?.slice(0, 10) ?? [],
        next_action: input.next_action?.slice(0, 1000) || null,
        confidence: input.confidence ?? null,
      }).select().single();
      if (error) throw error;
      // Mark meeting as completed for win/lost/proposal_requested unless caller already changed it
      if (["won", "lost", "proposal_requested", "disqualified"].includes(input.outcome_type)) {
        await (supabase as any).from("meetings")
          .update({ status: "completed" })
          .eq("id", input.meeting_id).eq("user_id", user.id).eq("status", "scheduled");
      }
      return data as MeetingOutcome;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["meeting-outcomes"] });
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["learning-events"] });
      toast({ title: "Outcome recorded" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
}
