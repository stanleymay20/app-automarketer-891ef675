import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PerformanceSignal {
  id: string;
  content_id: string;
  platform: string;
  impressions: number;
  likes: number;
  comments: number;
  reposts: number;
  clicks: number;
  conversions: number;
  captured_at: string;
}

export function usePerformanceSignals(contentIds?: string[]) {
  return useQuery({
    queryKey: ["performance_signals", contentIds],
    enabled: !!contentIds && contentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_signals")
        .select("*")
        .in("content_id", contentIds!)
        .order("captured_at", { ascending: false });

      if (error) throw error;
      return data as PerformanceSignal[];
    },
  });
}

export function useTopPerformingPost() {
  return useQuery({
    queryKey: ["top_performing_post"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_signals")
        .select("*, content:content_id(content_text, platform, status)")
        .order("clicks", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });
}
