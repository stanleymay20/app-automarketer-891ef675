 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Badge } from "@/components/ui/badge";
 import { usePlatformConnections, useConnectPlatform, useDisconnectPlatform, Platform } from "@/hooks/usePlatformConnections";
 import { Loader2, Link2, Unlink, Twitter, Linkedin, Instagram, Facebook, AlertCircle } from "lucide-react";
 import { useContent } from "@/hooks/useContent";
 import { Alert, AlertDescription } from "@/components/ui/alert";
 
 const platformConfig: Record<Platform, { name: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
   x: { name: "X (Twitter)", icon: Twitter, color: "bg-black text-white" },
   linkedin: { name: "LinkedIn", icon: Linkedin, color: "bg-blue-600 text-white" },
   instagram: { name: "Instagram", icon: Instagram, color: "bg-gradient-to-r from-purple-500 to-pink-500 text-white" },
   facebook: { name: "Facebook", icon: Facebook, color: "bg-blue-500 text-white" },
 };
 
 export function PlatformConnections() {
   const { data: connections, isLoading } = usePlatformConnections();
   const { data: content } = useContent();
   const connectPlatform = useConnectPlatform();
   const disconnectPlatform = useDisconnectPlatform();
 
   // Find scheduled content for disconnected platforms
   const scheduledContent = content?.filter((c) => 
     c.status === "pending" || c.status === "approved"
   ) || [];
 
   const disconnectedPlatforms = new Set(
     connections?.filter((c) => !c.connected).map((c) => c.platform) || []
   );
 
   const warningContent = scheduledContent.filter((c) => 
     disconnectedPlatforms.has(c.platform as Platform)
   );
 
   if (isLoading) {
     return (
       <Card>
         <CardContent className="flex items-center justify-center py-8">
           <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
         </CardContent>
       </Card>
     );
   }
 
   return (
     <div className="space-y-4">
       {warningContent.length > 0 && (
         <Alert variant="destructive">
           <AlertCircle className="h-4 w-4" />
           <AlertDescription>
             You have {warningContent.length} scheduled post{warningContent.length > 1 ? "s" : ""} for disconnected platforms. 
             Connect the platforms to enable publishing.
           </AlertDescription>
         </Alert>
       )}
 
       <Card>
         <CardHeader>
           <CardTitle>Connected Platforms</CardTitle>
           <CardDescription>
             Connect your social media accounts to enable automated publishing.
           </CardDescription>
         </CardHeader>
         <CardContent className="space-y-4">
           {connections?.map((connection) => {
             const config = platformConfig[connection.platform as Platform];
             const Icon = config.icon;
             const isConnecting = connectPlatform.isPending;
             const isDisconnecting = disconnectPlatform.isPending;
 
             return (
               <div
                 key={connection.platform}
                 className="flex items-center justify-between rounded-lg border p-4"
               >
                 <div className="flex items-center gap-4">
                   <div className={`rounded-lg p-2.5 ${config.color}`}>
                     <Icon className="h-5 w-5" />
                   </div>
                   <div>
                     <div className="flex items-center gap-2">
                       <span className="font-medium">{config.name}</span>
                       {connection.connected ? (
                         <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                           Connected
                         </Badge>
                       ) : (
                         <Badge variant="outline" className="bg-muted text-muted-foreground">
                           Not Connected
                         </Badge>
                       )}
                     </div>
                     {connection.connected && connection.account_name && (
                       <p className="text-sm text-muted-foreground">{connection.account_name}</p>
                     )}
                   </div>
                 </div>
                 <div>
                   {connection.connected ? (
                     <Button
                       variant="outline"
                       size="sm"
                       onClick={() => disconnectPlatform.mutate(connection.platform as Platform)}
                       disabled={isDisconnecting}
                       className="gap-2"
                     >
                       {isDisconnecting ? (
                         <Loader2 className="h-4 w-4 animate-spin" />
                       ) : (
                         <Unlink className="h-4 w-4" />
                       )}
                       Disconnect
                     </Button>
                   ) : (
                     <Button
                       size="sm"
                       onClick={() => connectPlatform.mutate(connection.platform as Platform)}
                       disabled={isConnecting}
                       className="gap-2"
                     >
                       {isConnecting ? (
                         <Loader2 className="h-4 w-4 animate-spin" />
                       ) : (
                         <Link2 className="h-4 w-4" />
                       )}
                       Connect
                     </Button>
                   )}
                 </div>
               </div>
             );
           })}
         </CardContent>
       </Card>
     </div>
   );
 }