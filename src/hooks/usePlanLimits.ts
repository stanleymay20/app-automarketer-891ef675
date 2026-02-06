import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface PlanLimits {
  apps: number;
  postsPerMonth: number;
  autopilotEnabled: boolean;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { apps: 1, postsPerMonth: 10, autopilotEnabled: false },
  starter: { apps: 3, postsPerMonth: 100, autopilotEnabled: true },
  pro: { apps: -1, postsPerMonth: -1, autopilotEnabled: true }, // -1 = unlimited
};

export interface UsageLimits {
  plan: string;
  limits: PlanLimits;
  usage: {
    apps: number;
    postsThisMonth: number;
  };
  canCreateApp: boolean;
  canCreatePost: boolean;
  canUseAutopilot: boolean;
  appsRemaining: number | "unlimited";
  postsRemaining: number | "unlimited";
}

export function usePlanLimits() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["plan-limits", user?.id],
    queryFn: async (): Promise<UsageLimits | null> => {
      if (!user) return null;

      // Get user settings with plan info
      const { data: settings } = await supabase
        .from("user_settings")
        .select("plan, posts_this_month")
        .eq("user_id", user.id)
        .single();

      // Count user's apps
      const { count: appCount } = await supabase
        .from("apps")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      const plan = settings?.plan || "free";
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
      const usage = {
        apps: appCount || 0,
        postsThisMonth: settings?.posts_this_month || 0,
      };

      const canCreateApp = limits.apps === -1 || usage.apps < limits.apps;
      const canCreatePost = limits.postsPerMonth === -1 || usage.postsThisMonth < limits.postsPerMonth;
      const canUseAutopilot = limits.autopilotEnabled;

      return {
        plan,
        limits,
        usage,
        canCreateApp,
        canCreatePost,
        canUseAutopilot,
        appsRemaining: limits.apps === -1 ? "unlimited" : Math.max(0, limits.apps - usage.apps),
        postsRemaining: limits.postsPerMonth === -1 ? "unlimited" : Math.max(0, limits.postsPerMonth - usage.postsThisMonth),
      };
    },
    enabled: !!user,
  });
}
