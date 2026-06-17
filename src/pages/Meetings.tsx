import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CalendarPlus, ExternalLink, Loader2, MessageSquare, Plus, Sparkles } from "lucide-react";
import {
  useMeetings, useCreateMeeting, useRecordMeetingOutcome, useUpdateMeeting,
  type Meeting, type MeetingOutcomeType, type MeetingType,
} from "@/hooks/useMeetings";
import { useProspects } from "@/hooks/useProspects";
import { useApps } from "@/hooks/useApps";

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-info/10 text-info border-info/20",
  completed: "bg-success/10 text-success border-success/20",
  cancelled: "bg-muted text-muted-foreground",
  no_show: "bg-destructive/10 text-destructive border-destructive/20",
};

const TYPE_OPTIONS: { value: MeetingType; label: string }[] = [
  { value: "discovery", label: "Discovery" },
  { value: "demo", label: "Demo" },
  { value: "follow_up", label: "Follow-up" },
  { value: "closing", label: "Closing" },
  { value: "check_in", label: "Check-in" },
  { value: "other", label: "Other" },
];

const OUTCOME_OPTIONS: { value: MeetingOutcomeType; label: string; tone: string }[] = [
  { value: "proposal_requested", label: "Proposal requested", tone: "default" },
  { value: "follow_up", label: "Follow-up needed", tone: "secondary" },
  { value: "nurture", label: "Nurture", tone: "secondary" },
  { value: "won", label: "Won", tone: "success" },
  { value: "lost", label: "Lost", tone: "destructive" },
  { value: "disqualified", label: "Disqualified", tone: "destructive" },
];

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}

function defaultDateLocal(): string {
  const d = new Date(); d.setMinutes(d.getMinutes() + 60); d.setSeconds(0, 0);
  // yyyy-MM-ddTHH:mm  for datetime-local input
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return tz.toISOString().slice(0, 16);
}

export default function Meetings() {
  const [statusFilter, setStatusFilter] = useState<"all" | "scheduled" | "completed">("all");
  const meetings = useMeetings({ status: statusFilter as any });
  const create = useCreateMeeting();
  const update = useUpdateMeeting();
  const recordOutcome = useRecordMeetingOutcome();
  const { data: prospects } = useProspects();
  const { data: apps } = useApps();

  const [dialog, setDialog] = useState<"create" | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<Meeting | null>(null);
  const [notesFor, setNotesFor] = useState<Meeting | null>(null);

  // Create form
  const [form, setForm] = useState({
    title: "", scheduled_at: defaultDateLocal(), duration_minutes: 30,
    meeting_type: "discovery" as MeetingType,
    prospect_id: "none", app_id: "none",
    meeting_url: "", location: "", agenda: "",
  });

  // Outcome form
  const [outcome, setOutcome] = useState<{ outcome_type: MeetingOutcomeType; summary: string; next_action: string; objections: string; opportunities: string; }>({
    outcome_type: "follow_up", summary: "", next_action: "", objections: "", opportunities: "",
  });

  // Notes form
  const [noteText, setNoteText] = useState("");

  const items = useMemo(() => meetings.data ?? [], [meetings.data]);

  return (
    <DashboardLayout title="Meetings">
      <div className="space-y-6 p-4 md:p-8">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Meetings</h1>
            <p className="text-sm text-muted-foreground">
              Track conversations and convert them into next steps. Manual entry today; calendar sync coming next.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setDialog("create")}>
              <Plus className="mr-2 h-4 w-4" /> Log meeting
            </Button>
          </div>
        </header>

        {meetings.isLoading ? (
          <Card><CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent></Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <CalendarPlus className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">No meetings yet</p>
              <p className="text-sm text-muted-foreground">Log a meeting to start the outcome-learning loop.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {items.map((m) => (
              <Card key={m.id}>
                <CardHeader className="space-y-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{m.title}</CardTitle>
                      <CardDescription>
                        {fmt(m.scheduled_at)} · {m.duration_minutes} min · {m.meeting_type.replace("_", " ")}
                        {m.source !== "manual" && ` · via ${m.source.replace("_", " ")}`}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className={STATUS_TONE[m.status] ?? ""}>
                      {m.status.replace("_", " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {m.agenda && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{m.agenda}</p>}
                  {m.notes && (
                    <div className="rounded-md bg-muted/40 p-3 text-sm">
                      <p className="mb-1 font-medium">Notes</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">{m.notes}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {m.meeting_url && (
                      <a className="inline-flex items-center gap-1 text-sm text-info hover:underline"
                         href={m.meeting_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />Join
                      </a>
                    )}
                    <Button size="sm" variant="outline" onClick={() => { setNotesFor(m); setNoteText(m.notes ?? ""); }}>
                      <MessageSquare className="mr-2 h-4 w-4" /> Notes
                    </Button>
                    <Button size="sm" onClick={() => {
                      setOutcomeFor(m);
                      setOutcome({ outcome_type: "follow_up", summary: "", next_action: "", objections: "", opportunities: "" });
                    }}>
                      <Sparkles className="mr-2 h-4 w-4" /> Record outcome
                    </Button>
                    {m.status === "scheduled" && (
                      <Button size="sm" variant="ghost" onClick={() =>
                        update.mutate({ id: m.id, patch: { status: "cancelled" } as any })
                      }>Cancel</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* CREATE */}
      <Dialog open={dialog === "create"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Log a meeting</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Discovery call with Acme" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Date & time</Label>
                <Input type="datetime-local" value={form.scheduled_at}
                       onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Duration (min)</Label>
                <Input type="number" min={5} max={480} value={form.duration_minutes}
                       onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) || 30 })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Type</Label>
                <Select value={form.meeting_type} onValueChange={(v) => setForm({ ...form, meeting_type: v as MeetingType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Offering</Label>
                <Select value={form.app_id} onValueChange={(v) => setForm({ ...form, app_id: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(apps ?? []).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Prospect (optional)</Label>
              <Select value={form.prospect_id} onValueChange={(v) => setForm({ ...form, prospect_id: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(prospects ?? []).slice(0, 200).map((p: any) =>
                    <SelectItem key={p.id} value={p.id}>{p.company_name || p.name || "Untitled"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Meeting URL</Label>
              <Input value={form.meeting_url} onChange={(e) => setForm({ ...form, meeting_url: e.target.value })} placeholder="https://meet…" />
            </div>
            <div className="grid gap-1.5">
              <Label>Agenda</Label>
              <Textarea rows={3} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button disabled={create.isPending || !form.title.trim()}
              onClick={() => create.mutate(
                {
                  ...form,
                  scheduled_at: new Date(form.scheduled_at).toISOString(),
                  prospect_id: form.prospect_id === "none" ? null : form.prospect_id,
                  app_id: form.app_id === "none" ? null : form.app_id,
                  meeting_url: form.meeting_url || undefined,
                  agenda: form.agenda || undefined,
                },
                { onSuccess: () => setDialog(null) },
              )}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RECORD OUTCOME */}
      <Dialog open={!!outcomeFor} onOpenChange={(o) => !o && setOutcomeFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record outcome</DialogTitle></DialogHeader>
          {outcomeFor && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{outcomeFor.title} · {fmt(outcomeFor.scheduled_at)}</p>
              <div className="grid gap-1.5">
                <Label>Outcome</Label>
                <Select value={outcome.outcome_type} onValueChange={(v) => setOutcome({ ...outcome, outcome_type: v as MeetingOutcomeType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OUTCOME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Summary</Label>
                <Textarea rows={3} value={outcome.summary}
                  onChange={(e) => setOutcome({ ...outcome, summary: e.target.value })}
                  placeholder="Key takeaways..." />
              </div>
              <div className="grid gap-1.5">
                <Label>Next action</Label>
                <Input value={outcome.next_action}
                  onChange={(e) => setOutcome({ ...outcome, next_action: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Objections (one per line)</Label>
                  <Textarea rows={3} value={outcome.objections}
                    onChange={(e) => setOutcome({ ...outcome, objections: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Opportunities (one per line)</Label>
                  <Textarea rows={3} value={outcome.opportunities}
                    onChange={(e) => setOutcome({ ...outcome, opportunities: e.target.value })} />
                </div>
              </div>
              {outcome.outcome_type === "proposal_requested" && (
                <p className="text-xs text-info">
                  This will move the prospect to the <strong>Proposal</strong> stage. You can then draft a proposal from the Proposals page.
                </p>
              )}
              {(outcome.outcome_type === "won" || outcome.outcome_type === "lost") && (
                <p className="text-xs text-muted-foreground">
                  This will record a learning event from the meeting. Final won/lost on a proposal is captured separately.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOutcomeFor(null)}>Cancel</Button>
            <Button disabled={recordOutcome.isPending}
              onClick={() => outcomeFor && recordOutcome.mutate({
                meeting_id: outcomeFor.id,
                outcome_type: outcome.outcome_type,
                summary: outcome.summary || undefined,
                next_action: outcome.next_action || undefined,
                objections: outcome.objections.split("\n").map(s => s.trim()).filter(Boolean),
                opportunities: outcome.opportunities.split("\n").map(s => s.trim()).filter(Boolean),
              }, { onSuccess: () => setOutcomeFor(null) })}>
              {recordOutcome.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Save outcome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NOTES */}
      <Dialog open={!!notesFor} onOpenChange={(o) => !o && setNotesFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Meeting notes</DialogTitle></DialogHeader>
          <Textarea rows={10} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNotesFor(null)}>Cancel</Button>
            <Button disabled={update.isPending}
              onClick={() => notesFor && update.mutate(
                { id: notesFor.id, patch: { notes: noteText } as any },
                { onSuccess: () => setNotesFor(null) },
              )}>
              {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
