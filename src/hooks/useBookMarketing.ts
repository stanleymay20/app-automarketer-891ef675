import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const db = supabase as any;

export type BookMarketingProfile = {
  id: string;
  user_id: string;
  app_id: string;
  title: string;
  subtitle: string | null;
  author_name: string | null;
  isbn_paperback: string | null;
  isbn_hardcover: string | null;
  isbn_epub: string | null;
  asin: string | null;
  primary_conversion_url: string | null;
  retailer_urls: Record<string, string>;
  genres: string[];
  themes: string[];
  markets: string[];
  launch_stage: "prelaunch" | "launch" | "evergreen" | "relaunch";
  launch_date: string | null;
  review_goal: number | null;
  sales_goal: number | null;
  metadata: Record<string, unknown>;
};

export type BookPromoter = {
  id: string;
  user_id: string;
  app_id: string;
  name: string;
  profile_url: string | null;
  email: string | null;
  organization: string | null;
  status: "candidate" | "trial" | "active" | "paused" | "completed" | "declined";
  fee: number | null;
  fee_currency: string;
  notes: string | null;
};

export type PromotionAssignment = {
  id: string;
  user_id: string;
  app_id: string;
  book_profile_id: string;
  promoter_id: string | null;
  distribution_target_id: string | null;
  campaign_id: string | null;
  platform: string;
  community_name: string | null;
  destination_url: string;
  tracking_token: string;
  audience_size_claimed: number | null;
  budget: number | null;
  budget_currency: string;
  status: "planned" | "approved" | "live" | "completed" | "cancelled";
  starts_at: string | null;
  ends_at: string | null;
  conversions_reported: number;
  revenue_reported: number;
  created_at: string;
};

export type PromotionPlacement = {
  id: string;
  assignment_id: string;
  platform: string;
  community_name: string | null;
  post_url: string | null;
  evidence_url: string | null;
  audience_size_claimed: number | null;
  impressions_reported: number | null;
  engagements_reported: number | null;
  conversions_reported: number;
  revenue_reported: number;
  revenue_currency: string;
  posted_at: string | null;
  notes: string | null;
};

export function useBookGrowth(appId?: string) {
  return useQuery({
    queryKey: ["book-growth", appId],
    enabled: !!appId,
    queryFn: async () => {
      const [{ data: profile, error: profileError }, { data: promoters, error: promoterError }, { data: assignments, error: assignmentError }] =
        await Promise.all([
          db.from("book_marketing_profiles").select("*").eq("app_id", appId).maybeSingle(),
          db.from("book_promoters").select("*").eq("app_id", appId).order("created_at", { ascending: false }),
          db.from("book_promotion_assignments").select("*").eq("app_id", appId).order("created_at", { ascending: false }),
        ]);

      if (profileError) throw profileError;
      if (promoterError) throw promoterError;
      if (assignmentError) throw assignmentError;

      const assignmentIds = (assignments ?? []).map((a: PromotionAssignment) => a.id);
      let placements: PromotionPlacement[] = [];
      let clicks: { assignment_id: string; clicked_at: string }[] = [];

      if (assignmentIds.length) {
        const [{ data: placementRows, error: placementError }, { data: clickRows, error: clickError }] = await Promise.all([
          db.from("book_promotion_placements").select("*").in("assignment_id", assignmentIds).order("created_at", { ascending: false }),
          db.from("book_promotion_clicks").select("assignment_id,clicked_at").in("assignment_id", assignmentIds),
        ]);
        if (placementError) throw placementError;
        if (clickError) throw clickError;
        placements = placementRows ?? [];
        clicks = clickRows ?? [];
      }

      return {
        profile: (profile ?? null) as BookMarketingProfile | null,
        promoters: (promoters ?? []) as BookPromoter[],
        assignments: (assignments ?? []) as PromotionAssignment[],
        placements,
        clicks,
      };
    },
  });
}

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

export function useSaveBookProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<BookMarketingProfile> & { app_id: string; title: string }) => {
      const user_id = await currentUserId();
      const payload = { ...input, user_id };
      const { data, error } = await db
        .from("book_marketing_profiles")
        .upsert(payload, { onConflict: "app_id" })
        .select()
        .single();
      if (error) throw error;
      return data as BookMarketingProfile;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["book-growth", vars.app_id] });
      qc.invalidateQueries({ queryKey: ["apps"] });
      toast.success("Book marketing profile saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useAddBookPromoter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Partial<BookPromoter>, "id" | "user_id"> & { app_id: string; name: string }) => {
      const user_id = await currentUserId();
      const { data, error } = await db.from("book_promoters").insert({ ...input, user_id }).select().single();
      if (error) throw error;
      return data as BookPromoter;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["book-growth", vars.app_id] });
      toast.success("Promoter added");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useCreatePromotionAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      app_id: string;
      book_profile_id: string;
      promoter_id?: string | null;
      platform: string;
      community_name?: string | null;
      destination_url: string;
      audience_size_claimed?: number | null;
      budget?: number | null;
      budget_currency?: string;
      status?: string;
    }) => {
      const user_id = await currentUserId();
      const { data, error } = await db.from("book_promotion_assignments").insert({
        ...input,
        user_id,
        promoter_id: input.promoter_id || null,
        status: input.status || "planned",
      }).select().single();
      if (error) throw error;
      return data as PromotionAssignment;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["book-growth", vars.app_id] });
      toast.success("Promotion assignment created");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useAddPromotionPlacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      app_id: string;
      assignment_id: string;
      platform: string;
      community_name?: string | null;
      post_url?: string | null;
      evidence_url?: string | null;
      audience_size_claimed?: number | null;
      impressions_reported?: number | null;
      engagements_reported?: number | null;
      conversions_reported?: number;
      revenue_reported?: number;
      revenue_currency?: string;
      posted_at?: string | null;
      notes?: string | null;
    }) => {
      const user_id = await currentUserId();
      const { app_id, ...placement } = input;
      const { data, error } = await db.from("book_promotion_placements").insert({ ...placement, user_id }).select().single();
      if (error) throw error;
      return { data: data as PromotionPlacement, app_id };
    },
    onSuccess: ({ app_id }) => {
      qc.invalidateQueries({ queryKey: ["book-growth", app_id] });
      toast.success("Placement evidence logged");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
