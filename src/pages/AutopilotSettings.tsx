import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ShieldAlert, Zap, Eye, PauseCircle, Loader2 } from "lucide-react";
import {
  useAutopilotSettings,
  useUpdateAutopilotSettings,
  DEFAULT_AUTOPILOT,
  HARD_DAILY_CAP,
  type Segment,
  type AutopilotSettings,
} from "@/hooks/useAutopilotSettings";
import { useProspects } from "@/hooks/useProspects";
import GmailReplySyncCard from "@/components/settings/GmailReplySyncCard";

const ALL_SEGMENTS: Segment[] = ["hot", "warm", "nurture", "disqualify"];
const SEGMENT_LABEL: Record<Segment, string> = {
  hot: "Hot",
  warm: "Warm",
  nurture: "Nurture",
  disqualify: "Disqualify",
};

type Draft = {
  enabled: boolean;
  min_opportunity_score: number;
  min_confidence: number;
  daily_send_cap: number;
  max_auto_value: number;
  allowed_segments: Segment[];
  approval_required_segments: Segment[];
};

function toDraft(s: AutopilotSettings | null | undefined): Draft {
  return {
    enabled: s?.enabled ?? DEFAULT_AUTOPILOT.enabled,
    min_opportunity_score: s?.min_opportunity_score ?? DEFAULT_AUTOPILOT.min_opportunity_score,
    min_confidence: s?.min_confidence ?? DEFAULT_AUTOPILOT.min_confidence,
    daily_send_cap: s?.daily_send_cap ?? DEFAULT_AUTOPILOT.daily_send_cap,
    max_auto_value: s?.max_auto_value ?? DEFAULT_AUTOPILOT.max_auto_value,
    allowed_segments: (s?.allowed_segments ?? DEFAULT_AUTOPILOT.allowed_segments) as Segment[],
    approval_required_segments: (s?.approval_required_segments ?? DEFAULT_AUTOPILOT.approval_required_segments) as Segment[],
  };
}

export default function AutopilotSettings() {
  const { data: settings, isLoading } = useAutopilotSettings();
  const update = useUpdateAutopilotSettings();
  const { data: prospects = [] } = useProspects();

  const [draft, setDraft] = useState<Draft>(toDraft(settings));

  useEffect(() => { setDraft(toDraft(settings)); }, [settings]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const toggleSeg = (key: "allowed_segments" | "approval_required_segments", seg: Segment) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(seg) ? d[key].filter((s) => s !== seg) : [...d[key], seg],
    }));

  // Live preview against current prospects.
  const preview = useMemo(() => {
    const sent = prospects.filter((p) => p.stage === "contacted" || p.stage === "responded").length;
    let auto = 0; let review = 0; let skip = 0;
    const reasons: Record<string, number> = {};
    const bump = (k: string) => { reasons[k] = (reasons[k] ?? 0) + 1; };

    for (const raw of prospects) {
      const p: any = raw;
      if (p.category !== "customer") { skip++; bump("not customer"); continue; }
      if (p.stage !== "new" && p.stage !== "saved" && p.stage !== "qualified") { skip++; bump("already in pipeline"); continue; }
      const seg: Segment | null = p.segment ?? null;
      const oppScore = Number(p.opportunity_score ?? 0);
      const conf = Number(p.opportunity_confidence ?? p.source_confidence ?? 0);
      const value = Number(p.expected_value ?? p.estimated_value ?? 0);

      if (seg && draft.approval_required_segments.includes(seg)) { review++; bump(`${seg} → review`); continue; }
      if (seg && !draft.allowed_segments.includes(seg)) { skip++; bump(`${seg} not allowed`); continue; }
      if (!seg) { review++; bump("no segment yet → review"); continue; }
      if (oppScore < draft.min_opportunity_score) { review++; bump("score below threshold"); continue; }
      if (conf < draft.min_confidence) { review++; bump("low confidence"); continue; }
      if (draft.max_auto_value > 0 && value > draft.max_auto_value) { review++; bump("value exceeds cap"); continue; }
      auto++;
    }

    const capped = Math.min(auto, draft.daily_send_cap);
    const cappedOverflow = auto - capped;
    return { auto, capped, cappedOverflow, review, skip, sentToday: settings?.sent_today ?? 0, reasons };
  }, [prospects, draft, settings?.sent_today]);

  const dirty = useMemo(() => {
    const s = toDraft(settings);
    return JSON.stringify(s) !== JSON.stringify(draft);
  }, [settings, draft]);

  const save = () => update.mutate(draft);
  const reset = () => setDraft(toDraft(settings));

  return (
    <DashboardLayout title="Autopilot">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Autopilot</h1>
          <p className="text-sm text-muted-foreground">
            Let the system send outreach automatically when a prospect clears your rules. Everything stays off until you turn it on, and nothing is sent from this page.
          </p>
        </header>

        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Safety rails</AlertTitle>
          <AlertDescription className="text-sm">
            <ul className="ml-4 list-disc space-y-1">
              <li>Autopilot is <strong>off by default</strong>. Saving settings never sends a message.</li>
              <li>Hard daily limit of {HARD_DAILY_CAP} sends per user, regardless of what you configure.</li>
              <li>Prospects in <em>approval-required</em> segments always go to your review queue first.</li>
              <li>Any inbound reply instantly pauses scheduled follow-ups.</li>
              <li>Every auto-send is recorded in the Automation Audit Log.</li>
            </ul>
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-lg">Master switch</CardTitle>
              <CardDescription>
                When off, every outreach requires manual approval. Turning it on does not send anything until a prospect matches all rules below.
              </CardDescription>
            </div>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(v) => patch({ enabled: v })}
              aria-label="Enable autopilot"
            />
          </CardHeader>
        </Card>

        <GmailReplySyncCard />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Thresholds</CardTitle>
            <CardDescription>A prospect must clear every rule to qualify for auto-send.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Minimum opportunity score</Label>
                <span className="text-sm font-medium tabular-nums">{draft.min_opportunity_score}</span>
              </div>
              <Slider value={[draft.min_opportunity_score]} min={0} max={100} step={5} onValueChange={([v]) => patch({ min_opportunity_score: v })} />
              <p className="text-xs text-muted-foreground">Higher = stricter. 75–85 is a good starting band.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Minimum confidence</Label>
                <span className="text-sm font-medium tabular-nums">{draft.min_confidence}</span>
              </div>
              <Slider value={[draft.min_confidence]} min={0} max={100} step={5} onValueChange={([v]) => patch({ min_confidence: v })} />
              <p className="text-xs text-muted-foreground">How verifiable the prospect data is. Below this, the prospect is routed to review even if the score is high.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cap">Daily send cap</Label>
                <Input
                  id="cap"
                  type="number"
                  min={0}
                  max={HARD_DAILY_CAP}
                  value={draft.daily_send_cap}
                  onChange={(e) => patch({ daily_send_cap: Math.min(HARD_DAILY_CAP, Math.max(0, Number(e.target.value) || 0)) })}
                />
                <p className="text-xs text-muted-foreground">Max auto-sends per day. Hard ceiling: {HARD_DAILY_CAP}.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="value">Max auto value (€)</Label>
                <Input
                  id="value"
                  type="number"
                  min={0}
                  step={100}
                  value={draft.max_auto_value}
                  onChange={(e) => patch({ max_auto_value: Math.max(0, Number(e.target.value) || 0) })}
                />
                <p className="text-xs text-muted-foreground">Prospects with an expected value above this require manual review.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Segments</CardTitle>
            <CardDescription>Pick which segments can auto-send, and which must always be approved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <SegmentList
              title="Auto-send allowed"
              hint="Prospects in these segments may auto-send if they pass the thresholds above."
              value={draft.allowed_segments}
              onToggle={(s) => toggleSeg("allowed_segments", s)}
            />
            <Separator />
            <SegmentList
              title="Approval required"
              hint="Prospects in these segments always go to the review queue, even if they pass the thresholds."
              value={draft.approval_required_segments}
              onToggle={(s) => toggleSeg("approval_required_segments", s)}
            />
            {draft.allowed_segments.some((s) => draft.approval_required_segments.includes(s)) && (
              <Alert variant="destructive">
                <AlertDescription className="text-sm">
                  A segment is in both lists — "Approval required" wins.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Live preview</CardTitle>
            <CardDescription>
              How your current {prospects.length} prospects would route right now. Recalculated as you change settings. Nothing is sent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <PreviewStat icon={<Zap className="h-4 w-4 text-primary" />} label="Would auto-send" value={preview.capped} suffix={preview.cappedOverflow > 0 ? `(+${preview.cappedOverflow} held by daily cap)` : undefined} tone="primary" />
              <PreviewStat icon={<Eye className="h-4 w-4 text-amber-600" />} label="Require review" value={preview.review} />
              <PreviewStat icon={<PauseCircle className="h-4 w-4 text-muted-foreground" />} label="Skipped" value={preview.skip} />
            </div>
            <div className="text-xs text-muted-foreground">
              Sent today: {preview.sentToday}/{draft.daily_send_cap}
            </div>
            {Object.keys(preview.reasons).length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(preview.reasons).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, n]) => (
                    <Badge key={reason} variant="outline" className="text-[10px]">{reason} · {n}</Badge>
                  ))}
                </div>
              </div>
            )}
            {!draft.enabled && (
              <Alert>
                <AlertDescription className="text-sm">
                  Autopilot is currently <strong>off</strong>. This is a simulation — no messages will be sent.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>}
          <Button variant="outline" onClick={reset} disabled={!dirty || isLoading || update.isPending}>Reset</Button>
          <Button onClick={save} disabled={!dirty || isLoading || update.isPending}>
            {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save settings
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function SegmentList({
  title, hint, value, onToggle,
}: { title: string; hint: string; value: Segment[]; onToggle: (s: Segment) => void }) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm font-medium">{title}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ALL_SEGMENTS.map((s) => {
          const on = value.includes(s);
          return (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition ${on ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
            >
              <Checkbox checked={on} onCheckedChange={() => onToggle(s)} />
              <span>{SEGMENT_LABEL[s]}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PreviewStat({
  icon, label, value, suffix, tone,
}: { icon: React.ReactNode; label: string; value: number; suffix?: string; tone?: "primary" }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === "primary" ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {suffix && <div className="text-[10px] text-muted-foreground">{suffix}</div>}
    </div>
  );
}
