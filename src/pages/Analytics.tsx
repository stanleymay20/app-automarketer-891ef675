 import { DashboardLayout } from "@/components/layout/DashboardLayout";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 import { TrendingUp, TrendingDown, Users, MousePointerClick, Eye, Share2, Loader2, BarChart3 } from "lucide-react";
 import { useContentAnalytics, useAnalyticsByApp, useAnalyticsByPlatform, useWeeklyAnalytics } from "@/hooks/useAnalytics";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

 const platformColors: Record<string, string> = {
   x: "hsl(var(--foreground))",
   linkedin: "hsl(210, 80%, 50%)",
   instagram: "hsl(330, 70%, 50%)",
   facebook: "hsl(220, 70%, 50%)",
 };
 
 const platformLabels: Record<string, string> = {
   x: "X (Twitter)",
   linkedin: "LinkedIn",
   instagram: "Instagram",
   facebook: "Facebook",
 };
 
 function formatNumber(num: number): string {
   if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
   if (num >= 1000) return (num / 1000).toFixed(1) + "K";
   return num.toString();
 }

export default function Analytics() {
   const { data: analytics, isLoading: analyticsLoading } = useContentAnalytics();
   const { data: appAnalytics, isLoading: appLoading } = useAnalyticsByApp();
   const { data: platformAnalytics, isLoading: platformLoading } = useAnalyticsByPlatform();
   const { data: weeklyAnalytics, isLoading: weeklyLoading } = useWeeklyAnalytics();
 
   const isLoading = analyticsLoading || appLoading || platformLoading || weeklyLoading;
 
   const overviewStats = [
     { label: "Total Impressions", value: formatNumber(analytics?.totalImpressions || 0), change: "+0%", up: true, icon: Eye },
     { label: "Engagements", value: formatNumber(analytics?.totalEngagements || 0), change: "+0%", up: true, icon: MousePointerClick },
     { label: "Clicks", value: formatNumber(analytics?.totalClicks || 0), change: "+0%", up: true, icon: Users },
     { label: "Posts Published", value: formatNumber(analytics?.totalPosts || 0), change: "+0%", up: true, icon: Share2 },
   ];
 
   const weeklyData = (weeklyAnalytics || []).map((w) => ({
     name: new Date(w.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
     impressions: w.impressions,
     engagements: w.engagements,
     clicks: w.clicks,
   })).reverse();
 
   const platformData = (platformAnalytics || []).map((p) => {
     const total = platformAnalytics?.reduce((sum, pl) => sum + pl.totalPosts, 0) || 1;
     return {
       name: platformLabels[p.platform] || p.platform,
       value: Math.round((p.totalPosts / total) * 100),
       color: platformColors[p.platform] || "hsl(var(--muted))",
     };
   });
 
   const appPerformance = (appAnalytics || []).map((a) => ({
     name: a.appName,
     posts: a.totalPosts,
     engagements: a.totalEngagements,
     clicks: a.totalClicks,
   }));
 
   const hasData = (analytics?.totalPosts || 0) > 0;
 
  return (
    <DashboardLayout title="Analytics">
      <div className="space-y-6">
         {isLoading ? (
           <div className="flex items-center justify-center py-12">
             <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
           </div>
         ) : !hasData ? (
           <div className="rounded-xl border-2 border-dashed border-border bg-muted/30 p-12 text-center">
             <BarChart3 className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
             <h3 className="font-display text-lg font-semibold mb-2">No analytics data yet</h3>
             <p className="text-muted-foreground">
               Publish some content to start tracking performance metrics.
             </p>
           </div>
         ) : (
         <>
        {/* Overview Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {overviewStats.map((stat) => (
            <Card key={stat.label} className="shadow-card">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="rounded-lg bg-accent p-3">
                  <stat.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <span
                      className={`flex items-center text-xs font-medium ${
                        stat.up ? "text-success" : "text-destructive"
                      }`}
                    >
                      {stat.up ? (
                        <TrendingUp className="mr-0.5 h-3 w-3" />
                      ) : (
                        <TrendingDown className="mr-0.5 h-3 w-3" />
                      )}
                      {stat.change}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="platforms">By Platform</TabsTrigger>
            <TabsTrigger value="apps">By App</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6 space-y-6">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display">Weekly Performance</CardTitle>
              </CardHeader>
              <CardContent>
                 {weeklyData.length > 0 ? (
                   <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Line type="monotone" dataKey="impressions" stroke="hsl(var(--info))" strokeWidth={2} />
                      <Line type="monotone" dataKey="engagements" stroke="hsl(var(--success))" strokeWidth={2} />
                       <Line type="monotone" dataKey="clicks" stroke="hsl(var(--secondary))" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                 ) : (
                   <p className="text-center text-muted-foreground py-8">No weekly data available yet.</p>
                 )}
                <div className="mt-4 flex justify-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-info" />
                    <span className="text-sm text-muted-foreground">Impressions</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-success" />
                    <span className="text-sm text-muted-foreground">Engagements</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-secondary" />
                     <span className="text-sm text-muted-foreground">Clicks</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="platforms" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="font-display">Platform Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                   {platformData.length > 0 ? (
                   <>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={platformData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {platformData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {platformData.map((platform) => (
                      <div key={platform.name} className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded" style={{ backgroundColor: platform.color }} />
                        <span className="text-sm text-muted-foreground">
                          {platform.name} ({platform.value}%)
                        </span>
                      </div>
                    ))}
                  </div>
                   </>
                   ) : (
                     <p className="text-center text-muted-foreground py-8">No platform data available.</p>
                   )}
                </CardContent>
              </Card>

              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="font-display">Platform Performance</CardTitle>
                </CardHeader>
                <CardContent>
                   {platformData.length > 0 ? (
                  <div className="space-y-4">
                    {platformData.map((platform) => (
                      <div key={platform.name} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{platform.name}</span>
                          <span className="text-muted-foreground">{platform.value}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full"
                            style={{ width: `${platform.value}%`, backgroundColor: platform.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                   ) : (
                     <p className="text-center text-muted-foreground py-8">No platform data available.</p>
                   )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="apps" className="mt-6">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display">App Performance Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                 {appPerformance.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={appPerformance}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar dataKey="posts" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="engagements" fill="hsl(var(--info))" radius={[4, 4, 0, 0]} />
                       <Bar dataKey="clicks" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                 ) : (
                   <p className="text-center text-muted-foreground py-8">No app data available.</p>
                 )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
         </>
         )}
      </div>
    </DashboardLayout>
  );
}
