import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
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
import {
  Loader2, Check, X, Mail, Linkedin, RefreshCw, Pencil, Send, AlertCircle,
  Sparkles,
} from "lucide-react";
import {
  useReviewQueue, useApproveProspect, useRejectProspect,
  useApproveAndSendProspect, useSaveReviewDraft, type ReviewProspect,
} from "@/hooks/useReviewQueue";
import { useRunProspectPipeline } from "@/hooks/useRunProspectPipeline";
import { useApps } from "@/hooks/useApps";

const segmentClass: Record<string, string> = {
  hot: "bg-destructive/10 text-destructive border-destructive/20",
  warm: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  nurture: "bg-info/10 text-info border-info/20",
  disqualify: "bg-muted text-muted-foreground",
};

function fmtMoney(v: number | null, ccy: string | null) {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency: ccy || "EUR", maximumFractionDigits: 0,
    }).format(Number(v));
  } catch {
    return `${Number(v).toFixed(0)} ${ccy || ""}`.trim();
  }
}

function buildReason(p: ReviewProspect): string {
  const reasons: string[] = [];
  if (p.review_reason) reasons.push(p.review_reason);
  const oppConf = Number(p.opportunity_confidence ?? 0);
  const evConf = Number(p.expected_value_confidence ?? 0);
  if (oppConf > 0 && oppConf < 50) reasons.push(`Opportunity confidence is low (${oppConf}/100).`);
  if (evConf > 0 && evConf < 50) reasons.push(`Expected-value confidence is low (${evConf}/100).`);
  if (p.value_reasoning && /review/i.test(p.value_reasoning)) {
    reasons.push("Value estimate flagged as review-worthy.");
  }
  if (reasons.length === 0) reasons.push("Routed here by your automation rules.");
  return reasons.join(" ");
}

function topEvidence(p: ReviewProspect): string[] {
  const all: string[] = [];
  for (const list of [p.icp_fit_evidence, p.buying_signal_evidence, p.urgency_evidence, p.reachability_evidence]) {
    if (Array.isArray(list)) all.push(...list.filter((s) => typeof s === "string"));
  }
  return all.slice(0, 4);
}

function draftSubject(p: ReviewProspect): string {
  const co = p.company_name || p.name || "your team";
  return `Quick idea for ${co}`.slice(0, 120);
}
function draftBody(p: ReviewProspect): string {
  const who = p.name || p.company_name || "there";
  const why = p.segment_reason ||
    p.icp_fit_reasoning ||
    p.buying_signal_reasoning ||
    "your recent activity suggests there might be a good fit.";
  return [
    `Hi ${who.split(" ")[0] || who},`,
    "",
    why,
    "",
    "Would a 15-minute call next week be useful to see whether we can help? Happy to send a short loom first if that's easier.",
    "",
    "Thanks,",
  ].join("\n");
}

interface EditState {
  prospect: ReviewProspect;
  subject: string;
  body: string;
  to_address: string;
  mode: "edit" | "send";
}

export default function Review() {
  const { data: apps } = useApps();
  const [appId, setAppId] = useState<string | "all">("all");
  const scopedAppId = appId === "all" ? undefined : appId;
  const { data: items, isLoading, isError, refetch } = useReviewQueue(scopedAppId);
  const approve = useApproveProspect();
  const reject = useRejectProspect();
  const approveSend = useApproveAndSendProspect();
  const rerun = useRunProspectPipeline();

  const [edit, setEdit] = useState<EditState | null>(null);
  const [rejecting, setRejecting] = useState<{ prospect: ReviewProspect; reason: string } | null>(null);

  const openEditor = (p: ReviewProspect, mode: "edit" | "send") =>
    setEdit({
      prospect: p,
      subject: draftSubject(p),
      body: draftBody(p),
      to_address: p.contact_email || "",
      mode,
    });

  const sortedItems = useMemo(() => items ?? [], [items]);

  return (
    <DashboardLayout title="Review queue">
      <div className="space-y-6 p-4 md:p-8">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Review queue</h1>
            <p className="text-sm text-muted-foreground">
              Prospects your automation thinks need a human call before any outreach goes out.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={appId} onValueChange={(v) => setAppId(v as any)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All offerings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All offerings</SelectItem>
                {(apps ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </div>
        </header>

        {isLoading ? (
          <Card><CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent></Card>
        ) : isError ? (
          <Card><CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">Couldn't load the review queue. Refresh to try again.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </CardContent></Card>
        ) : sortedItems.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Sparkles className="h-6 w-6 text-success" />
            <p className="text-sm font-medium">Nothing to review</p>
            <p className="text-sm text-muted-foreground">
              Autopilot is handling everything within your rules.
            </p>
          </CardContent></Card>
        ) : (
          <div className="grid gap-4">
            {sortedItems.map((p) => {
              const segKey = (p.segment ?? "nurture") as keyof typeof segmentClass;
              const evidence = topEvidence(p);
              const reason = buildReason(p);
              const isBusy =
                (approve.isPending && approve.variables === p.id) ||
                (reject.isPending && rejecting?.prospect.id === p.id) ||
                (approveSend.isPending && approveSend.variables?.prospect_id === p.id) ||
                (rerun.isPending);
              return (
                <Card key={p.id}>
                  <CardHeader className="space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">
                          {p.company_name || p.name || "Untitled prospect"}
                        </CardTitle>
                        {p.company_name && p.name && (
                          <CardDescription>{p.name}</CardDescription>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {p.segment && (
                          <Badge variant="outline" className={segmentClass[segKey] ?? ""}>
                            {p.segment.toUpperCase()}
                          </Badge>
                        )}
                        <Badge variant="outline">
                          Opportunity {p.opportunity_score ?? "—"}/100
                          {p.opportunity_confidence != null && ` · ${p.opportunity_confidence}% conf`}
                        </Badge>
                        <Badge variant="outline">
                          EV {fmtMoney(p.expected_value, p.value_currency)}
                          {p.expected_value_confidence != null && ` · ${p.expected_value_confidence}% conf`}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-md bg-muted/40 p-3 text-sm">
                      <p className="font-medium">Why this needs review</p>
                      <p className="text-muted-foreground">{reason}</p>
                      {p.segment_reason && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Segment reason: </span>
                          {p.segment_reason}
                        </p>
                      )}
                    </div>

                    {evidence.length > 0 && (
                      <div className="text-sm">
                        <p className="mb-1 font-medium">Top evidence</p>
                        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                          {evidence.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      </div>
                    )}

                    {(p.contact_email || p.linkedin_url) && (
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        {p.contact_email && (
                          <a className="inline-flex items-center gap-1 text-info hover:underline"
                             href={`mailto:${p.contact_email}`}>
                            <Mail className="h-3.5 w-3.5" />{p.contact_email}
                          </a>
                        )}
                        {p.linkedin_url && (
                          <a className="inline-flex items-center gap-1 text-info hover:underline"
                             href={p.linkedin_url} target="_blank" rel="noreferrer">
                            <Linkedin className="h-3.5 w-3.5" />LinkedIn
                          </a>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={() => openEditor(p, "send")}
                        disabled={isBusy || !p.contact_email}
                        title={!p.contact_email ? "No contact email on file" : undefined}
                      >
                        <Send className="mr-2 h-4 w-4" /> Approve & Send
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => approve.mutate(p.id)}
                        disabled={isBusy}
                      >
                        <Check className="mr-2 h-4 w-4" /> Approve only
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditor(p, "edit")}
                        disabled={isBusy}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit message
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          rerun.mutate({ prospect_id: p.id, mode: "single" })
                        }
                        disabled={isBusy}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" /> Re-run pipeline
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setRejecting({ prospect: p, reason: "" })}
                        disabled={isBusy}
                      >
                        <X className="mr-2 h-4 w-4" /> Reject
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit / Approve & Send dialog */}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {edit?.mode === "send" ? "Approve & send outreach" : "Edit message"}
            </DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="to">To</Label>
                <Input
                  id="to"
                  value={edit.to_address}
                  onChange={(e) => setEdit({ ...edit, to_address: e.target.value })}
                  placeholder="recipient@company.com"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={edit.subject}
                  onChange={(e) => setEdit({ ...edit, subject: e.target.value })}
                  maxLength={150}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="body">Message</Label>
                <Textarea
                  id="body"
                  value={edit.body}
                  onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                  rows={10}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Nothing is sent until you click <strong>Approve & Send</strong>. Editing only saves
                the draft locally for this approval.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            {edit?.mode === "edit" ? (
              <Button
                onClick={() => {
                  if (!edit) return;
                  approve.mutate(edit.prospect.id, { onSuccess: () => setEdit(null) });
                }}
                disabled={approve.isPending}
              >
                <Check className="mr-2 h-4 w-4" /> Approve with this draft
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (!edit) return;
                  approveSend.mutate(
                    {
                      prospect_id: edit.prospect.id,
                      subject: edit.subject,
                      body: edit.body,
                      to_address: edit.to_address || undefined,
                    },
                    { onSuccess: () => setEdit(null) },
                  );
                }}
                disabled={approveSend.isPending || !edit?.to_address}
              >
                {approveSend.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Approve & Send
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject prospect</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This blocks any outreach for{" "}
              <strong>
                {rejecting?.prospect.company_name || rejecting?.prospect.name || "this prospect"}
              </strong>
              . You can reverse it from the prospect record later.
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea
                id="reason"
                rows={3}
                value={rejecting?.reason ?? ""}
                onChange={(e) =>
                  setRejecting((r) => (r ? { ...r, reason: e.target.value } : r))
                }
                placeholder="Not a fit, wrong region, already a customer…"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!rejecting) return;
                reject.mutate(
                  { prospect_id: rejecting.prospect.id, reason: rejecting.reason || undefined },
                  { onSuccess: () => setRejecting(null) },
                );
              }}
              disabled={reject.isPending}
            >
              {reject.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-2 h-4 w-4" />
              )}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
