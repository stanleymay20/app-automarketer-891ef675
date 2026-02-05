 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { useAuth } from "@/contexts/AuthContext";
 
 export interface ContentAnalytics {
   totalPosts: number;
   totalImpressions: number;
   totalEngagements: number;
   totalClicks: number;
   engagementRate: number;
 }
 
 export interface AppAnalytics extends ContentAnalytics {
   appId: string;
   appName: string;
 }
 
 export interface PlatformAnalytics extends ContentAnalytics {
   platform: string;
 }
 
 export interface WeeklyAnalytics {
   weekStart: string;
   weekEnd: string;
   posts: number;
   impressions: number;
   engagements: number;
   clicks: number;
 }
 
 export function useContentAnalytics() {
   const { user } = useAuth();
 
   return useQuery({
     queryKey: ["content-analytics", user?.id],
     queryFn: async () => {
       if (!user) return null;
 
       const { data, error } = await supabase
         .from("content")
         .select("impressions, engagements, clicks, status")
         .eq("user_id", user.id);
 
       if (error) throw error;
 
       const published = data?.filter((c) => c.status === "published") || [];
       const totalPosts = published.length;
       const totalImpressions = published.reduce((sum, c) => sum + (c.impressions || 0), 0);
       const totalEngagements = published.reduce((sum, c) => sum + (c.engagements || 0), 0);
       const totalClicks = published.reduce((sum, c) => sum + (c.clicks || 0), 0);
       const engagementRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
 
       return {
         totalPosts,
         totalImpressions,
         totalEngagements,
         totalClicks,
         engagementRate,
       } as ContentAnalytics;
     },
     enabled: !!user,
   });
 }
 
 export function useAnalyticsByApp() {
   const { user } = useAuth();
 
   return useQuery({
     queryKey: ["analytics-by-app", user?.id],
     queryFn: async () => {
       if (!user) return [];
 
       const { data, error } = await supabase
         .from("content")
         .select(`
           impressions,
           engagements,
           clicks,
           status,
           app_id,
           apps!inner(id, name)
         `)
         .eq("user_id", user.id)
         .eq("status", "published");
 
       if (error) throw error;
 
       // Group by app
       const byApp = new Map<string, { name: string; items: typeof data }>();
       for (const item of data || []) {
         const appId = item.app_id;
         const appName = (item.apps as any)?.name || "Unknown";
         if (!byApp.has(appId)) {
           byApp.set(appId, { name: appName, items: [] });
         }
         byApp.get(appId)!.items.push(item);
       }
 
       const result: AppAnalytics[] = [];
       for (const [appId, { name, items }] of byApp) {
         const totalPosts = items.length;
         const totalImpressions = items.reduce((sum, c) => sum + (c.impressions || 0), 0);
         const totalEngagements = items.reduce((sum, c) => sum + (c.engagements || 0), 0);
         const totalClicks = items.reduce((sum, c) => sum + (c.clicks || 0), 0);
         const engagementRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
 
         result.push({
           appId,
           appName: name,
           totalPosts,
           totalImpressions,
           totalEngagements,
           totalClicks,
           engagementRate,
         });
       }
 
       return result;
     },
     enabled: !!user,
   });
 }
 
 export function useAnalyticsByPlatform() {
   const { user } = useAuth();
 
   return useQuery({
     queryKey: ["analytics-by-platform", user?.id],
     queryFn: async () => {
       if (!user) return [];
 
       const { data, error } = await supabase
         .from("content")
         .select("impressions, engagements, clicks, platform")
         .eq("user_id", user.id)
         .eq("status", "published");
 
       if (error) throw error;
 
       // Group by platform
       const byPlatform = new Map<string, typeof data>();
       for (const item of data || []) {
         if (!byPlatform.has(item.platform)) {
           byPlatform.set(item.platform, []);
         }
         byPlatform.get(item.platform)!.push(item);
       }
 
       const result: PlatformAnalytics[] = [];
       for (const [platform, items] of byPlatform) {
         const totalPosts = items.length;
         const totalImpressions = items.reduce((sum, c) => sum + (c.impressions || 0), 0);
         const totalEngagements = items.reduce((sum, c) => sum + (c.engagements || 0), 0);
         const totalClicks = items.reduce((sum, c) => sum + (c.clicks || 0), 0);
         const engagementRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
 
         result.push({
           platform,
           totalPosts,
           totalImpressions,
           totalEngagements,
           totalClicks,
           engagementRate,
         });
       }
 
       return result;
     },
     enabled: !!user,
   });
 }
 
 export function useWeeklyAnalytics() {
   const { user } = useAuth();
 
   return useQuery({
     queryKey: ["weekly-analytics", user?.id],
     queryFn: async () => {
       if (!user) return [];
 
       const { data, error } = await supabase
         .from("content")
         .select("impressions, engagements, clicks, published_at")
         .eq("user_id", user.id)
         .eq("status", "published")
         .not("published_at", "is", null)
         .order("published_at", { ascending: false });
 
       if (error) throw error;
 
       // Group by week
       const byWeek = new Map<string, typeof data>();
       for (const item of data || []) {
         if (!item.published_at) continue;
         const date = new Date(item.published_at);
         const weekStart = new Date(date);
         weekStart.setDate(date.getDate() - date.getDay());
         weekStart.setHours(0, 0, 0, 0);
         const weekKey = weekStart.toISOString().split("T")[0];
 
         if (!byWeek.has(weekKey)) {
           byWeek.set(weekKey, []);
         }
         byWeek.get(weekKey)!.push(item);
       }
 
       const result: WeeklyAnalytics[] = [];
       for (const [weekStart, items] of byWeek) {
         const weekEnd = new Date(weekStart);
         weekEnd.setDate(weekEnd.getDate() + 6);
 
         result.push({
           weekStart,
           weekEnd: weekEnd.toISOString().split("T")[0],
           posts: items.length,
           impressions: items.reduce((sum, c) => sum + (c.impressions || 0), 0),
           engagements: items.reduce((sum, c) => sum + (c.engagements || 0), 0),
           clicks: items.reduce((sum, c) => sum + (c.clicks || 0), 0),
         });
       }
 
       // Sort by week descending
       return result.sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 8);
     },
     enabled: !!user,
   });
 }