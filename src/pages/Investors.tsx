import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApps } from "@/hooks/useApps";
import { useDiscoverProspects, useProspects, type Prospect } from "@/hooks/useProspects";
import { ArrowRight, ExternalLink, Search, ShieldCheck, TrendingUp } from "lucide-react";

const ACTIVE_STAGES = new Set(["new", "saved", "qualified", "contacted", "responded", "meeting", "proposal"]);

function metric(investors: Prospect[], stages: string[]) {
  const set = new Set(stages);
  return investors.filter((p) => set.has(p.stage)).length;
}

export default function Investors() {
  const { data: apps = [] } = useApps();
  const [appId, setAppId] = useState("");
  const { data: prospects = [], isLoading } = useProspects(appId || undefined);
  const discover = useDiscoverProspects();

  useEffect(() => {
    if (!appId && apps.length > 0) setAppId(apps[0].id);
  }, [appId, apps]);

  const investors = useMemo(
    () => prospects.filter((p) => p.category === "investor"),
    [prospects],
  );

  const active = useMemo(
    () => investors.filter((p) => ACTIVE_STAGES.has(p.stage)).sort((a, b) => b.prospect_score - a.prospect_score),
    [investors],
  );

  const stats = {
    discovered: investors.length,
    qualified: metric(investors, ["qualified", "contacted", "responded", "meeting", "proposal", "won"]),
    contacted: metric(investors, ["contacted", "responded", "meeting", "proposal", "won"]),
    replied: metric(investors, ["responded", "meeting", "proposal", "won"]),
    meetings: metric(investors, ["meeting", "proposal", "won"]),
    advanced: metric(investors, ["proposal", "won"]),
  };

  return (
    <DashboardLayout title="Investors">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Funding Intelligence</Badge>
              <Badge variant="outline">investor outreach: approval-first</Badge>
            </div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Investor pipeline</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Discover angels, accelerators and VCs matched to the selected offering, then qualify them using evidence before any outreach.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select value={appId} onValueChange={setAppId}>
              <SelectTrigger className="w-full sm:w-[240px]"><SelectValue placeholder="Choose an offering" /></SelectTrigger>
              <SelectContent>{apps.map((app) => <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button
              onClick={() => appId && discover.mutate({ appId, categories: ["investor"] })}
              disabled={!appId || discover.isPending}
              className="gap-2"
            >
              <Search className="h-4 w-4" />
              {discover.isPending ? "Researching…" : "Discover investors"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            ["Discovered", stats.discovered],
            ["Qualified", stats.qualified],
            ["Contacted", stats.contacted],
            ["Replies", stats.replied],
            ["Meetings", stats.meetings],
            ["Advanced", stats.advanced],
          ].map(([label, value]) => (
            <Card key={label as string}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold tabular-nums">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> Best active investor matches</CardTitle>
                <CardDescription>Ranked using the same evidence and opportunity-scoring engine as the customer pipeline.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild><Link to="/prospects">Full CRM <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading investor prospects…</p>
              ) : !appId ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Choose an offering to start investor research.</p>
              ) : active.length === 0 ? (
                <div className="py-10 text-center">
                  <TrendingUp className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">No active investor prospects yet</p>
                  <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">Run discovery to find real investors whose stage/domain thesis fits the selected offering.</p>
                  <Button className="mt-4" onClick={() => discover.mutate({ appId, categories: ["investor"] })} disabled={discover.isPending}>Discover investors</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {active.slice(0, 12).map((p) => (
                    <div key={p.id} className="rounded-lg border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{p.name}</span>
                            <Badge variant="secondary">score {p.prospect_score}</Badge>
                            <Badge variant="outline">{p.stage}</Badge>
                            {p.source_confidence != null && <Badge variant="outline">conf {p.source_confidence}</Badge>}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.evidence_summary || p.match_reason || p.description || "No evidence summary yet."}</p>
                          {(p.contact_name || p.contact_role) && <p className="mt-2 text-xs text-muted-foreground">{[p.contact_name, p.contact_role].filter(Boolean).join(" · ")}</p>}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {p.url && <Button size="sm" variant="outline" asChild><a href={p.url} target="_blank" rel="noreferrer">Source <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>}
                          <Button size="sm" asChild><Link to="/prospects">Review <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Fundraising rules</CardTitle>
              <CardDescription>Keep investor outreach high-trust and founder-controlled.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                "Research thesis, stage, geography and evidence before qualifying.",
                "Prioritize warm introductions and highly specific relevance over volume.",
                "Generate drafts automatically, but review every first investor message.",
                "Never invent traction, customers, financials or commitments.",
                "Track replies, meetings and next actions in the same prospect CRM.",
                "Use the Grants workspace separately for non-dilutive funding applications.",
              ].map((rule) => <div key={rule} className="rounded-lg border p-3 text-muted-foreground">{rule}</div>)}
              <Button className="w-full" variant="outline" asChild><Link to="/funding">Open Grants <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
