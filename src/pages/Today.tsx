import { useMemo } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle, ArrowRight, CalendarDays, CheckCircle2, Flame,
  Loader2, MessageSquare, Sparkles, Target, Trophy, Users, Zap,
} from "lucide-react";
import {
  useProspects, useProspectAction, PROSPECT_STAGES,
  type Prospect, type ProspectStage,
} from "@/hooks/useProspects";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

const STAGE_LABEL: Record<ProspectStage, string> = {
  new: "New", saved: "Saved", qualified: "Qualified",
  contacted: "Contacted", responded: "Responded",
  meeting: "Meeting", proposal: "Proposal",
  won: "Won", lost: "Lost",
};

const START_OF_TODAY = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const END_OF_TODAY   = () => { const d = new Date(); d.setHours(23,59,59,999); return d; };
const daysAgo = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

function useRecentActivity() {
  return useQuery({
    queryKey: ["today-activity"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospect_actions")
        .select("id, action_type, channel, created_at, prospect_id, prospects(name, category, stage)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });
}

function StatTile({ label, value, icon: Icon, tone = "default" }: { label: string; value: React.ReactNode; icon: any; tone?: "default" | "warn" | "good" }) {
  const toneCls = tone === "warn" ? "text-destructive" : tone === "good" ? "text-success" : "text-primary";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-md bg-muted p-2 ${toneCls}`}><Icon className="h-4 w-4" /></div>
        <div>
          <div className="text-xl font-bold tabular-nums">{value}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProspectRow({ p, hint }: { p: Prospect; hint?: string }) {
  const action = useProspectAction();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-muted/30">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{p.name}</p>
          <Badge variant="outline" className="shrink-0 text-[10px]">{STAGE_LABEL[(p.stage ?? "new") as ProspectStage]}</Badge>
          {p.source_confidence != null && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">conf {p.source_confidence}</Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{hint ?? p.evidence_summary ?? p.match_reason ?? p.description ?? "—"}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button asChild size="sm" variant="outline">
          <Link to="/prospects">Open</Link>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => action.mutate({ prospect_id: p.id, action: "mark_contacted" })}>
          Mark sent
        </Button>
      </div>
    </div>
  );
}

export default function Today() {
  const { data: prospects = [], isLoading } = useProspects();
  const { data: activity = [] } = useRecentActivity();

  const buckets = useMemo(() => {
    const start = START_OF_TODAY().getTime();
    const end = END_OF_TODAY().getTime();
    const now = Date.now();
    const dueToday: Prospect[] = [];
    const overdue: Prospect[] = [];
    const hotNew: Prospect[] = [];
    const proposalsOpen: Prospect[] = [];
    const meetings: Prospect[] = [];
    const recentWins: Prospect[] = [];

    for (const p of prospects) {
      const next = p.next_action_at ? new Date(p.next_action_at).getTime() : null;
      if (next && next >= start && next <= end) dueToday.push(p);
      else if (next && next < start && !["won", "lost"].includes(p.stage ?? "")) overdue.push(p);
      if (p.stage === "new" && (p.source_confidence ?? 0) >= 80) hotNew.push(p);
      if (p.stage === "proposal") proposalsOpen.push(p);
      if (p.stage === "meeting") meetings.push(p);
      if (p.stage === "won" && p.converted_at) {
        const d = daysAgo(p.converted_at);
        if (d != null && d <= 7) recentWins.push(p);
      }
    }
    // expected value proxy = prospect_score * confidence
    const expValue = (p: Prospect) => (p.prospect_score ?? 0) * ((p.source_confidence ?? 50) / 100);
    const leaderboard = [...prospects]
      .filter((p) => !["won", "lost"].includes(p.stage ?? ""))
      .sort((a, b) => expValue(b) - expValue(a))
      .slice(0, 8);

    return { dueToday, overdue, hotNew, proposalsOpen, meetings, recentWins, leaderboard };
  }, [prospects]);

  const pipeline = useMemo(() => {
    const counts: Record<string, number> = {};
    PROSPECT_STAGES.forEach((s) => (counts[s] = 0));
    prospects.forEach((p) => { counts[p.stage ?? "new"]++; });
    return counts;
  }, [prospects]);

  // Next Best Action engine: simple, transparent rule layer.
  const nextBest = useMemo(() => {
    const recs: { title: string; reason: string; impact: string; href: string }[] = [];
    if (buckets.overdue.length) {
      const p = buckets.overdue[0];
      recs.push({
        title: `Follow up with ${p.name}`,
        reason: `Overdue by ${Math.abs(daysAgo(p.next_action_at) ?? 0)} days. Stuck in ${STAGE_LABEL[(p.stage ?? "new") as ProspectStage]}.`,
        impact: "Re-opens a stalled pipeline opportunity before it goes cold.",
        href: "/prospects",
      });
    }
    if (buckets.proposalsOpen.length) {
      const p = [...buckets.proposalsOpen].sort((a, b) =>
        (daysAgo(b.last_contacted_at ?? b.contacted_at) ?? 0) - (daysAgo(a.last_contacted_at ?? a.contacted_at) ?? 0))[0];
      const d = daysAgo(p.last_contacted_at ?? p.contacted_at) ?? 0;
      recs.push({
        title: `Nudge ${p.name} on the proposal`,
        reason: `Proposal outstanding for ${d} day${d === 1 ? "" : "s"}.`,
        impact: "Proposals followed up within 7 days close ~2× more often.",
        href: "/prospects",
      });
    }
    if (buckets.hotNew.length) {
      const p = [...buckets.hotNew].sort((a, b) => (b.prospect_score ?? 0) - (a.prospect_score ?? 0))[0];
      recs.push({
        title: `Reach out to ${p.name}`,
        reason: `High-confidence match (${p.source_confidence}/100). ${p.evidence_summary ?? p.match_reason ?? ""}`.trim(),
        impact: "First contact while confidence is high lifts response rates.",
        href: "/prospects",
      });
    }
    if (recs.length === 0 && prospects.length === 0) {
      recs.push({
        title: "Discover your first prospects",
        reason: "Your pipeline is empty.",
        impact: "Generates a short, evidence-backed list to start outreach.",
        href: "/prospects",
      });
    }
    return recs.slice(0, 3);
  }, [buckets, prospects.length]);

  return (
    <DashboardLayout title="Today">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today</h1>
          <p className="text-sm text-muted-foreground">Your growth command center — what to do next, who to talk to, what's converting.</p>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Due today" value={buckets.dueToday.length} icon={CalendarDays} />
          <StatTile label="Overdue" value={buckets.overdue.length} icon={AlertCircle} tone={buckets.overdue.length ? "warn" : "default"} />
          <StatTile label="Hot new" value={buckets.hotNew.length} icon={Flame} />
          <StatTile label="Proposals" value={buckets.proposalsOpen.length} icon={Target} />
          <StatTile label="Meetings" value={buckets.meetings.length} icon={Users} />
          <StatTile label="Won (7d)" value={buckets.recentWins.length} icon={Trophy} tone="good" />
        </div>

        {/* Next Best Action */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Zap className="h-4 w-4 text-primary" /> Next best actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : nextBest.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                You're on top of things. No urgent actions right now.
              </p>
            ) : nextBest.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{r.reason}</p>
                  <p className="text-[11px] text-muted-foreground/80 italic">{r.impact}</p>
                </div>
                <Button asChild size="sm" variant="outline" className="shrink-0 gap-1">
                  <Link to={r.href}>Open <ArrowRight className="h-3 w-3" /></Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Pipeline snapshot */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Pipeline snapshot</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
              {PROSPECT_STAGES.map((s) => (
                <div key={s} className="rounded-md border p-2 text-center">
                  <div className="text-lg font-bold tabular-nums">{pipeline[s] ?? 0}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{STAGE_LABEL[s]}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Action lists */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Who to contact today</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {buckets.dueToday.length === 0 && buckets.overdue.length === 0 && (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Nothing scheduled. Mark prospects with a next action date to populate this list.
                </p>
              )}
              {buckets.overdue.slice(0, 5).map((p) => (
                <ProspectRow key={p.id} p={p} hint={`Overdue by ${Math.abs(daysAgo(p.next_action_at) ?? 0)}d`} />
              ))}
              {buckets.dueToday.slice(0, 5).map((p) => (
                <ProspectRow key={p.id} p={p} hint="Due today" />
              ))}
            </CardContent>
          </Card>

          {/* Leaderboard */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Opportunity leaderboard</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {buckets.leaderboard.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No open opportunities yet.</p>
              ) : buckets.leaderboard.map((p) => (
                <ProspectRow key={p.id} p={p} hint={`Score ${p.prospect_score} · Conf ${p.source_confidence ?? 50}`} />
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Activity feed */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {activity.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No activity yet.</p>
            ) : activity.map((a: any) => {
              const Icon = a.action_type?.includes("won") ? Trophy
                : a.action_type?.includes("contacted") || a.action_type?.includes("sent") ? MessageSquare
                : a.action_type?.includes("responded") ? CheckCircle2
                : Sparkles;
              return (
                <div key={a.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/30">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate"><b>{a.prospects?.name ?? "—"}</b> · {(a.channel ?? a.action_type ?? "").replaceAll("_", " ")}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
