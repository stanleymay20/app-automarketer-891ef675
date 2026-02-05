 import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { useAuth } from "@/contexts/AuthContext";
 import { toast } from "sonner";
 
 export type Platform = "x" | "linkedin" | "instagram" | "facebook";
 
 export interface PlatformConnection {
   id: string;
   user_id: string;
   platform: Platform;
   connected: boolean;
   connected_at: string | null;
   account_name: string | null;
   account_id: string | null;
   created_at: string;
   updated_at: string;
 }
 
 const PLATFORMS: Platform[] = ["x", "linkedin", "instagram", "facebook"];
 
 export function usePlatformConnections() {
   const { user } = useAuth();
 
   return useQuery({
     queryKey: ["platform-connections", user?.id],
     queryFn: async () => {
       if (!user) return [];
 
       const { data, error } = await supabase
         .from("platform_connections")
         .select("*")
         .eq("user_id", user.id);
 
       if (error) throw error;
 
       // Ensure all platforms exist in the result
       const existingPlatforms = new Set(data?.map((c) => c.platform) || []);
       const connections: PlatformConnection[] = [...(data || [])] as PlatformConnection[];
 
       // Add missing platforms as disconnected
       for (const platform of PLATFORMS) {
         if (!existingPlatforms.has(platform)) {
           connections.push({
             id: `temp-${platform}`,
             user_id: user.id,
             platform,
             connected: false,
             connected_at: null,
             account_name: null,
             account_id: null,
             created_at: new Date().toISOString(),
             updated_at: new Date().toISOString(),
           });
         }
       }
 
       return connections;
     },
     enabled: !!user,
   });
 }
 
 export function useConnectPlatform() {
   const queryClient = useQueryClient();
   const { user } = useAuth();
 
   return useMutation({
     mutationFn: async (platform: Platform) => {
       if (!user) throw new Error("Not authenticated");
 
       // Mock OAuth flow - simulate success
       const mockAccountName = `@user_${Math.random().toString(36).substring(7)}`;
       const mockAccountId = Math.random().toString(36).substring(2, 15);
 
       const { data, error } = await supabase
         .from("platform_connections")
         .upsert({
           user_id: user.id,
           platform,
           connected: true,
           connected_at: new Date().toISOString(),
           account_name: mockAccountName,
           account_id: mockAccountId,
         }, { onConflict: "user_id,platform" })
         .select()
         .single();
 
       if (error) throw error;
       return data;
     },
     onSuccess: (_, platform) => {
       queryClient.invalidateQueries({ queryKey: ["platform-connections"] });
       toast.success(`Connected to ${platform.toUpperCase()} successfully`);
     },
     onError: (error) => {
       toast.error(`Failed to connect: ${error.message}`);
     },
   });
 }
 
 export function useDisconnectPlatform() {
   const queryClient = useQueryClient();
   const { user } = useAuth();
 
   return useMutation({
     mutationFn: async (platform: Platform) => {
       if (!user) throw new Error("Not authenticated");
 
       const { error } = await supabase
         .from("platform_connections")
         .update({
           connected: false,
           connected_at: null,
           account_name: null,
           account_id: null,
         })
         .eq("user_id", user.id)
         .eq("platform", platform);
 
       if (error) throw error;
     },
     onSuccess: (_, platform) => {
       queryClient.invalidateQueries({ queryKey: ["platform-connections"] });
       toast.success(`Disconnected from ${platform.toUpperCase()}`);
     },
     onError: (error) => {
       toast.error(`Failed to disconnect: ${error.message}`);
     },
   });
 }
 
 export function useIsplatformConnected(platform: Platform) {
   const { data: connections } = usePlatformConnections();
   return connections?.find((c) => c.platform === platform)?.connected ?? false;
 }