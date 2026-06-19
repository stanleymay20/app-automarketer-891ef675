import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sunrise, Loader2, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import { useDawnRuns, useRunDawnNow, type DawnRun } from "@/hooks/useDawnAutopilot";

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Madrid", "Europe/Amsterdam",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

export default function DawnAutopilotSettings() {
  const { data: settings } = useUserSettings();
  const update = useUpdateUserSettings();
  const { data: runs } = useDawnRuns(20);
  const runNow = useRunDawnNow();
  const s = settings as any;

  const [local, setLocal] = useState({
    dawn_autopilot_enabled: false,
    dawn_autopilot_time: "05:00",
    dawn_timezone: "UTC",
    dawn_max_daily_prospects: 20,
    dawn_max_daily_outreach: 10,
    dawn_max_daily_content: 3,
    dawn_require_review_for_content: true,
    dawn_require_review_for_high_value: true,
    dawn_high_value_threshold: 5000,
  });

  useEffect(() => {
    if (!s) return;
    setLocal({
      dawn_autopilot_enabled: s.dawn_autopilot_enabled ?? false,
      dawn_autopilot_time: s.dawn_autopilot_time ?? "05:00",
      dawn_timezone: s.dawn_timezone ?? "UTC",
      dawn_max_daily_prospects: s.dawn_max_daily_prospects ?? 20,
      dawn_max_daily_outreach: s.dawn_max_daily_outreach ?? 10,
      dawn_max_daily_content: s.dawn_max_daily_content ?? 3,
      dawn_require_review_for_content: s.dawn_require_review_for_content ?? true,
      dawn_require_review_for_high_value: s.dawn_require_review_for_high_value ?? true,
      dawn_high_value_threshold: Number(s.dawn_high_value_threshold ?? 5000),
    });
  }, [s?.user_id]);

  const save = () => update.mutate(local as any);

  return (
    <DashboardLayout title="Dawn Marketing Autopilot">
      <div className="space-y-6">
        <Card className="shadow-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sunrise className="h-5 w-5 text-amber-500" />
              <CardTitle className="font-display">Dawn Autopilot</CardTitle>
            </div>
            <CardDescription>
              Each morning the system reviews yesterday's performance, refreshes your pipeline, drafts content and outreach,
              and gives you a brief. Risky actions stay under your review.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Enable Dawn Autopilot</p>
                <p className="text-sm text-muted-foreground">Default off. No actions run until you turn this on.</p>
              </div>
              <Switch
                checked={local.dawn_autopilot_enabled}
                onCheckedChange={(v) => setLocal((p) => ({ ...p, dawn_autopilot_enabled: v }))}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Dawn time (local)</Label>
                <Input
                  type="time"
                  value={local.dawn_autopilot_time}
                  onChange={(e) => setLocal((p) => ({ ...p, dawn_autopilot_time: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={local.dawn_timezone}
                  onChange={(e) => setLocal((p) => ({ ...p, dawn_timezone: e.target.value }))}
                >
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <NumField label="Max prospects/day" value={local.dawn_max_daily_prospects}
                onChange={(v) => setLocal((p) => ({ ...p, dawn_max_daily_prospects: v }))} min={0} max={200} />
              <NumField label="Max outreach/day" value={local.dawn_max_daily_outreach}
                onChange={(v) => setLocal((p) => ({ ...p, dawn_max_daily_outreach: v }))} min={0} max={50} />
              <NumField label="Max content pieces/day" value={local.dawn_max_daily_content}
                onChange={(v) => setLocal((p) => ({ ...p, dawn_max_daily_content: v }))} min={0} max={20} />
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Require review for content</p>
                  <p className="text-sm text-muted-foreground">Drafts wait for approval instead of auto-publishing.</p>
                </div>
                <Switch
                  checked={local.dawn_require_review_for_content}
                  onCheckedChange={(v) => setLocal((p) => ({ ...p, dawn_require_review_for_content: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Require review for high-value prospects</p>
                  <p className="text-sm text-muted-foreground">High-value or low-confidence prospects always go to your review queue.</p>
                </div>
                <Switch
                  checked={local.dawn_require_review_for_high_value}
                  onCheckedChange={(v) => setLocal((p) => ({ ...p, dawn_require_review_for_high_value: v }))}
                />
              </div>
              <NumField label="High-value threshold (expected value)"
                value={local.dawn_high_value_threshold}
                onChange={(v) => setLocal((p) => ({ ...p, dawn_high_value_threshold: v }))}
                min={0} max={10_000_000} step={500} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={update.isPending}>
                {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save settings
              </Button>
              <Button variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                {runNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Run now
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display">Latest Dawn Brief</CardTitle>
            <CardDescription>What happened on the most recent run.</CardDescription>
          </CardHeader>
          <CardContent>
            {runs && runs[0]?.brief ? <BriefView run={runs[0]} /> : (
              <p className="text-sm text-muted-foreground">No briefs yet. Hit "Run now" to generate one.</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display">Run History</CardTitle>
            <CardDescription>Last 20 Dawn runs.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Discovered</TableHead>
                    <TableHead className="text-right">Auto-sent</TableHead>
                    <TableHead className="text-right">Review</TableHead>
                    <TableHead className="text-right">Content</TableHead>
                    <TableHead className="text-right">Follow-ups</TableHead>
                    <TableHead className="text-right">Exp. value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(runs ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">{new Date(r.started_at).toLocaleString()}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{r.prospects_discovered}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.prospects_auto_sent}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.prospects_sent_to_review}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.content_generated}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.followups_created}</TableCell>
                      <TableCell className="text-right tabular-nums">{Math.round(Number(r.revenue_expected)).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {(!runs || runs.length === 0) && (
                    <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground">No runs yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function NumField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: DawnRun["status"] }) {
  const map = {
    completed: { v: "default" as const, Icon: CheckCircle2 },
    partial: { v: "secondary" as const, Icon: AlertCircle },
    running: { v: "outline" as const, Icon: Loader2 },
    failed: { v: "destructive" as const, Icon: XCircle },
  };
  const { v, Icon } = map[status] ?? map.partial;
  return (
    <Badge variant={v} className="gap-1 capitalize">
      <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />
      {status}
    </Badge>
  );
}

function BriefView({ run }: { run: DawnRun }) {
  const b = run.brief ?? {};
  return (
    <div className="space-y-4">
      {b.summary && <p className="text-sm">{b.summary}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <Block title="Discovered">{b.discovered}</Block>
        <Block title="Sent">{b.sent}</Block>
        <Block title="Awaiting review">{b.review}</Block>
        <Block title="Pipeline change">{b.pipeline_change}</Block>
      </div>
      {Array.isArray(b.recommended_actions) && b.recommended_actions.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1">Top 3 recommended actions</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {b.recommended_actions.map((a: string, i: number) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
      {Array.isArray(b.risks) && b.risks.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1 text-destructive">Risks & warnings</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {b.risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-sm mt-1">{children || "—"}</p>
    </div>
  );
}
