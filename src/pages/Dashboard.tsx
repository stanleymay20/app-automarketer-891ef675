import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApps } from "@/hooks/useApps";
import { useContent } from "@/hooks/useContent";
import { useRealitySnapshot } from "@/hooks/useReality";
import { useAuth } from "@/contexts/AuthContext";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  Users,
  Rocket,
  Landmark,
  ArrowRight,
  MousePointerClick,
  UserPlus,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

function useFundingCount() {
  return useQuery({
    queryKey: ["funding-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("grants")
        .select("*", { count: "exact", head: true })
        .gte("fit_score", 70);
      return count ?? 0;
    },
  });
}

function useLeadsCount() {
  return useQuery({
    queryKey: ["leads-count"],
    queryFn: async () => {
      const { count } = await supabase.from("leads").select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });
}

type Action = {
  title: string;
  reason: string;
  cta: string;
  path: string;
  impact: "High" | "Medium";
};

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: apps, isLoading } = useApps();
  const { data: content } = useContent();
  const { data: reality } = useRealitySnapshot();
  const { data: fundingCount = 0 } = useFundingCount();
  const { data: leadsCount = 0 } = useLeadsCount();

  if (!isLoading && apps && apps.length === 0) {
    return <Navigate to="/onboarding" replace />;
  }

  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || "there";
  const revenue = reality?.funnel.revenue ?? 0;
  const clicks = reality?.funnel.clicks ?? 0;
  const conversions = reality?.funnel.conversions ?? 0;
  const activeCampaigns = (content || []).filter((c) => c.status === "approved" || c.status === "pending").length;
  const drafts = (content || []).filter((c) => c.status === "pending").length;
  const publishFails = reality?.publish.failed ?? 0;

  // Recommendation engine — driven by real signals, not random.
  const actions: Action[] = [];
  if (drafts > 0) {
    actions.push({
      title: `Approve ${drafts} pending post${drafts > 1 ? "s" : ""}`,
      reason: "Drafts ready to ship today",
      cta: "Review & approve",
      path: "/content",
      impact: "High",
    });
  }
  if (fundingCount > 0) {
    actions.push({
      title: `Apply for ${fundingCount} matched grant${fundingCount > 1 ? "s" : ""}`,
      reason: "Funding opportunities with 70%+ fit",
      cta: "Open Funding",
      path: "/funding",
      impact: "High",
    });
  }
  if (clicks === 0) {
    actions.push({
      title: "Drive your first attributed click",
      reason: "Proof chain starts with a real visitor",
      cta: "Launch campaign",
      path: "/orchestrator",
      impact: "High",
    });
  }
  if (publishFails > 5) {
    actions.push({
      title: `Resolve ${publishFails} failed publishes`,
      reason: "Recover lost reach in minutes",
      cta: "Open Reality",
      path: "/",
      impact: "Medium",
    });
  }
  if (leadsCount > 0 && conversions === 0) {
    actions.push({
      title: "Convert your leads",
      reason: `${leadsCount} leads waiting for follow-up`,
      cta: "Open Prospects",
      path: "/prospects",
      impact: "High",
    });
  }
  while (actions.length < 3) {
    actions.push({
      title: "Generate a new post",
      reason: "Keep the content engine warm",
      cta: "Create post",
      path: "/create",
      impact: "Medium",
    });
  }
  const topActions = actions.slice(0, 3);

  const snapshot = [
    { icon: DollarSign, label: "Revenue Attributed", value: `$${revenue.toLocaleString()}`, tone: "text-success" },
    { icon: Users, label: "Leads Generated", value: leadsCount, tone: "text-info" },
    { icon: Rocket, label: "Campaigns Active", value: activeCampaigns, tone: "text-primary" },
    { icon: Landmark, label: "Funding Matches", value: fundingCount, tone: "text-secondary" },
  ];

  return (
    <DashboardLayout title="Growth OS">
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Greeting */}
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-foreground lg:text-3xl">
            Hey {firstName} 👋
          </h1>
          <p className="text-muted-foreground">Here's where your growth stands today.</p>
        </div>

        {/* Growth Snapshot */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {snapshot.map((s) => (
            <Card key={s.label} className="shadow-sm">
              <CardContent className="p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <s.icon className={`h-4 w-4 ${s.tone}`} />
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </span>
                </div>
                <div className="text-2xl font-bold text-foreground">{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Top 3 Recommended Actions */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="font-display text-base font-semibold text-foreground">
                Top 3 actions for you
              </h2>
            </div>
            <Link to="/" className="text-xs text-primary hover:underline">
              See full Reality →
            </Link>
          </div>
          <div className="space-y-2">
            {topActions.map((a, i) => (
              <Card key={i} className="border-l-4 border-l-primary shadow-sm hover:shadow-card-hover transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-foreground text-sm">{a.title}</h3>
                      <Badge variant={a.impact === "High" ? "default" : "outline"} className="text-[10px]">
                        {a.impact} impact
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.reason}</p>
                  </div>
                  <Button size="sm" onClick={() => navigate(a.path)} className="gap-1.5 shrink-0">
                    {a.cta}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Proof Chain — the moat, reinforced */}
        <Card className="bg-gradient-to-r from-primary/5 to-secondary/5 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Content → Revenue</h3>
              <Link to="/" className="text-[11px] text-primary hover:underline">
                Open Reality
              </Link>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { icon: MousePointerClick, label: "Clicks", value: clicks },
                { icon: UserPlus, label: "Leads", value: leadsCount },
                { icon: CheckCircle2, label: "Conversions", value: conversions },
                { icon: DollarSign, label: "Revenue", value: `$${revenue.toLocaleString()}` },
              ].map((s, i) => (
                <div key={i} className="space-y-1">
                  <s.icon className="h-4 w-4 mx-auto text-muted-foreground" />
                  <div className="text-lg font-bold text-foreground">{s.value}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
