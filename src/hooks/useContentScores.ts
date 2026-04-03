import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ContentScore {
  id: string;
  content_id: string;
  quality_score: number;
  clarity_score: number;
  brand_score: number;
  risk_score: number;
  conversion_score: number;
  auto_approved: boolean;
  reasons: string | null;
  created_at: string;
}

export function useContentScores(contentIds?: string[]) {
  return useQuery({
    queryKey: ["content_scores", contentIds],
    enabled: !!contentIds && contentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_scores")
        .select("*")
        .in("content_id", contentIds!);

      if (error) throw error;
      return data as ContentScore[];
    },
  });
}
