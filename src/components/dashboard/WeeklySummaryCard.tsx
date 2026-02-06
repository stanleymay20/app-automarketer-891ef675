import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useContentAnalytics } from "@/hooks/useAnalytics";
import { TrendingUp, Eye, MessageSquare, MousePointerClick, FileText } from "lucide-react";

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

export function WeeklySummaryCard() {
  const { data: analytics } = useContentAnalytics();

  const stats = [
    {
      label: "Posts",
      value: analytics?.totalPosts || 0,
      icon: FileText,
    },
    {
      label: "Impressions",
      value: analytics?.totalImpressions || 0,
      icon: Eye,
    },
    {
      label: "Engagements",
      value: analytics?.totalEngagements || 0,
      icon: MessageSquare,
    },
    {
      label: "Clicks",
      value: analytics?.totalClicks || 0,
      icon: MousePointerClick,
    },
  ];

  const engagementRate = analytics?.engagementRate || 0;

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Performance Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {stats.map((stat) => (
            <div key={stat.label} className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <stat.icon className="h-3.5 w-3.5" />
                {stat.label}
              </p>
              <p className="text-xl font-bold text-foreground">{formatNumber(stat.value)}</p>
            </div>
          ))}
        </div>
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Engagement Rate</span>
            <span className="text-lg font-bold text-success">{engagementRate.toFixed(1)}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
