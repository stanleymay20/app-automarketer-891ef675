import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LearningInsight {
  id: string;
  app_id: string;
  user_id: string;
  platform: string | null;
  insight_type: string;
  insight_text: string;
  confidence: number;
  created_at: string;
}

export function useLearningInsights(appId?: string) {
  return useQuery({
    queryKey: ["learning_insights", appId],
    queryFn: async () => {
      let query = supabase
        .from("learning_insights")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

      if (appId) query = query.eq("app_id", appId);

      const { data, error } = await query;
      if (error) throw error;
      return data as LearningInsight[];
    },
  });
}
