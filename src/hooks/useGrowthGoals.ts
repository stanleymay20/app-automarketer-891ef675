import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface GrowthGoal {
  id: string;
  user_id: string;
  app_id: string;
  goal_type: string;
  target_value: number;
  current_value: number;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function useGrowthGoals(appId?: string) {
  return useQuery({
    queryKey: ["growth_goals", appId],
    queryFn: async () => {
      let query = supabase
        .from("growth_goals")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (appId) query = query.eq("app_id", appId);

      const { data, error } = await query;
      if (error) throw error;
      return data as GrowthGoal[];
    },
  });
}

export function useCreateGrowthGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (goal: { app_id: string; goal_type: string; target_value: number; end_date?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("growth_goals")
        .insert({ ...goal, user_id: user.id })
        .select()
        .single();

      if (error) throw error;
      return data as GrowthGoal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["growth_goals"] });
      toast({ title: "Goal created", description: "Your growth goal has been set." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}
