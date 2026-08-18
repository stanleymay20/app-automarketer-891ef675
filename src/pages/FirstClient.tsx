import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApps } from "@/hooks/useApps";
import { useDiscoverProspects, useProspects, type Prospect } from "@/hooks/useProspects";
import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Mail,
  Search,
  Sparkles,
  Target,
  Users,
} from "lucide-react";

const STAGE_ORDER = [
  "new", "saved", "qualified", "contacted", "responded", "meeting", "proposal", "won",
] as const;

function atLeastStage(prospect: Prospect, stage: (typeof STAGE_ORDER)[number]) {
  const current = STAGE_ORDER.indexOf((prospect.stage ?? "new") as (typeof STAGE_ORDER)[number]);
  const target = STAGE_ORDER.indexOf(stage);
  return current >= target && prospect.stage !== "lost";
}

function nextActionLabel(p: Prospect) {
  if (p.stage === "won") return "Client won";
  if (p.stage === "proposal") return "Follow up on proposal";
  if (p.stage === "meeting") return "Prepare meeting / proposal";
  if (p.stage === "responded") return "Book a discovery call";
  if (p.stage === "contacted") return "Follow up";
  if (p.stage === "qualified") return "Review & send outreach";
  if (!p.contact_email && !p.contact_linkedin) return "Find decision-maker contact";
  return "Qualify & draft outreach";
}

function stageTone(stage: string) {
  if (stage === "won") return "bg-success/15 text-success border-success/30";
  if (["responded", "meeting", "proposal"].includes(stage)) return "bg-primary/10 text-primary border-primary/25";
  if (stage === "lost") return "bg-muted text-muted-foreground";
  return "bg-secondary/10 text-secondary-foreground border-secondary/25";
}

function readiness(p: Prospect) {
  return Number((p as Prospect & { sales_readiness_score?: number | null }).sales_readiness_score ?? 0);
}

function accountFit(p: Prospect) {
  return Number((p as Prospect & { account_fit_score?: number | null }).account_fit_score ?? p.fit_score ?? 0);
}

function contactability(p: Prospect) {
  return Number((p as Prospect & { contactability_score?: number | null }).contactability_score ?? p.reachability_score ?? 0);
}

function buyingIntent(p: Prospect) {
  return Number((p as Prospect & { buying_intent_score?: number | null }).buying_intent_score ?? 0);
}

export default function FirstClient() {
  const { data: apps = [] } = useApps();
  const [appId, setAppId] = useState<string>("");
  const { data: prospects = [], isLoading } = useProspects(appId || undefined);
  const discover = useDiscoverProspects();

  useEffect(() => {
    if (!appId && apps.length > 0) setAppId(apps[0].id);
  }, [appId, apps]);

  const customers = useMemo(
    () => prospects.filter((p) => p.category === "customer"),
    [prospects],
  );

  const metrics = useMemo(() => ({
    targets: customers.filter((p) => p.stage !== "lost").length,
    qualified: customers.filter((p) => atLeastStage(p, "qualified")).length,
    contacted: customers.filter((p) => atLeastStage(p, "contacted")).length,
    replied: customers.filter((p) => atLeastStage(p, "responded")).length,
    meetings: customers.filter((p) => atLeastStage(p, "meeting")).length,
    proposals: customers.filter((p) => atLeastStage(p, "proposal")).length,
    won: customers.filter((p) => p.stage === "won").length,
  }), [customers]);

  const topTargets = useMemo(
    () => customers
      .filter((p) => !["won", "lost"].includes(p.stage))
      .sort((a, b) => {
        const readinessDelta = readiness(b) - readiness(a);
        return readinessDelta !== 0 ? readinessDelta : b.prospect_score - a.prospect_score;
      })
      .slice(0, 8),
    [customers],
  );

  const sprintSteps = [
    { done: apps.length > 0, title: "Choose one offer", text: "Focus the sprint on one product or service and one clear buyer." },
    { done: metrics.targets >= 20, title: "Build a 20-account list", text: "Use customer discovery to find ICP-matched mid-market companies, then keep only evidence-backed fits." },
    { done: metrics.qualified >= 10, title: "Qualify the best 10", text: "Prioritize sales readiness: fit, buying intent, reachability and a named decision-maker contact." },
    { done: metrics.contacted >= 5, title: "Contact 5–10 per day", text: "Use personalized drafts and approval mode. Do not mass-send generic messages." },
    { done: metrics.replied > 0, title: "Convert replies into calls", text: "Reply quickly, diagnose the problem and ask for a short discovery call." },
    { done: metrics.proposals > 0, title: "Send a small paid pilot", text: "Make the first purchase easy: narrow scope, measurable outcome and a clear price." },
    { done: metrics.won > 0, title: "Record the first paying client", text: "Mark the prospect Won so revenue and conversion learning feed future targeting." },
  ];

  return (
    <DashboardLayout title="First Client">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">First Client Sprint</Badge>
              <Badge variant="outline">approval-first</Badge>
            </div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Turn the Growth OS into your first paying client</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              One focused funnel from ICP-matched account discovery to outreach, meeting, proposal and Won. Accounts are ranked by sales readiness, so company prestige cannot hide missing buyers, contact paths or buying signals.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select value={appId} onValueChange={setAppId}>
              <SelectTrigger className="w-full sm:w-[240px]"><SelectValue placeholder="Choose an offering" /></SelectTrigger>
              <SelectContent>{apps.map((app) => <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button
              onClick={() => appId && discover.mutate({ appId, categories: ["customer"] })}
              disabled={!appId || discover.isPending}
              className="gap-2"
            >
              <Search className="h-4 w-4" />
              {discover.isPending ? "Discovering…" : "Discover customers"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {[
            ["Targets", metrics.targets],
            ["Qualified", metrics.qualified],
            ["Contacted", metrics.contacted],
            ["Replies", metrics.replied],
            ["Meetings", metrics.meetings],
            ["Proposals", metrics.proposals],
            ["Won", metrics.won],
          ].map(([label, value]) => (
            <Card key={label as string} className={label === "Won" ? "border-success/30 bg-success/5" : ""}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold tabular-nums">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {metrics.won > 0 && (
          <Card className="border-success/30 bg-success/5">
            <CardContent className="flex items-start gap-3 p-5">
              <CircleDollarSign className="mt-0.5 h-6 w-6 text-success" />
              <div>
                <div className="font-semibold">You have a Won customer in the funnel.</div>
                <p className="text-sm text-muted-foreground">Record the real conversion/revenue signal so AutoMarketer can learn which ICP, message and channel produced it.</p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.4fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-primary" /> Sprint checklist</CardTitle>
              <CardDescription>Optimize for one paid outcome, not vanity activity.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {sprintSteps.map((step, index) => (
                <div key={step.title} className="flex gap-3 rounded-lg border p-3">
                  {step.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" /> : <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground">{index + 1}</div>}
                  <div>
                    <div className="text-sm font-semibold">{step.title}</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.text}</p>
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button variant="outline" asChild><Link to="/audience"><Users className="mr-2 h-4 w-4" />Audience</Link></Button>
                <Button variant="outline" asChild><Link to="/orchestrator"><Sparkles className="mr-2 h-4 w-4" />Campaign</Link></Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Best accounts to work now</CardTitle>
                <CardDescription>Ranked by sales readiness first, then legacy prospect score.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild><Link to="/prospects">All prospects <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading prospects…</p>
              ) : !appId ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Choose an offering to start the sprint.</p>
              ) : topTargets.length === 0 ? (
                <div className="py-10 text-center">
                  <Target className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">No active customer targets yet</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Discover customers, then qualify the strongest evidence-backed matches before outreach.</p>
                  <Button className="mt-4" onClick={() => discover.mutate({ appId, categories: ["customer"] })} disabled={discover.isPending}>Discover customer prospects</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {topTargets.map((p) => (
                    <div key={p.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{p.name}</span>
                          <Badge variant="outline" className={stageTone(p.stage)}>{p.stage}</Badge>
                          <Badge variant="secondary">readiness {readiness(p)}</Badge>
                          <Badge variant="outline">fit {accountFit(p)}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.evidence_summary || p.match_reason || p.description || "No evidence summary yet."}</p>
                        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                          {p.contact_name && <span>{p.contact_name}{p.contact_role ? ` · ${p.contact_role}` : ""}</span>}
                          {p.contact_email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> email ready</span>}
                          {p.industry && <span>{p.industry}</span>}
                          <span>contactability {contactability(p)}</span>
                          <span>intent {buyingIntent(p)}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                        <span className="text-xs font-medium text-primary">{nextActionLabel(p)}</span>
                        <Button size="sm" variant="outline" asChild><Link to="/prospects">Open <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            <strong>First-client guardrail:</strong> automate research, enrichment, scoring, reminders and draft generation aggressively; keep cold outreach approval-first until the message, audience and deliverability are proven. A high account-fit score alone is not permission to send.
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
