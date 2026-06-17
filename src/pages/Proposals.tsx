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
import {
  CheckCircle2, FileText, Loader2, Send, Sparkles, Wand2, XCircle,
} from "lucide-react";
import {
  useProposals, usePendingProposalsCount, useGenerateProposal,
  useUpdateProposal, useTransitionProposal, type Proposal, type ProposalStatus,
} from "@/hooks/useProposals";
import { useProspects } from "@/hooks/useProspects";

const STATUS_TONE: Record<ProposalStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-info/10 text-info border-info/20",
  viewed: "bg-info/10 text-info border-info/20",
  accepted: "bg-success/10 text-success border-success/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  expired: "bg-muted text-muted-foreground",
};

function money(v: number | null, ccy: string | null) {
  if (v == null) return "—";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy || "EUR", maximumFractionDigits: 0 }).format(Number(v)); }
  catch { return `${v} ${ccy ?? ""}`.trim(); }
}

export default function Proposals() {
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | "all">("all");
  const list = useProposals({ status: statusFilter });
  const pending = usePendingProposalsCount();
  const generate = useGenerateProposal();
  const update = useUpdateProposal();
  const transition = useTransitionProposal();
  const { data: prospects } = useProspects();

  const [genDialog, setGenDialog] = useState(false);
  const [genForm, setGenForm] = useState({ prospect_id: "", proposal_title: "", notes: "" });

  const [editing, setEditing] = useState<Proposal | null>(null);
  const [edit, setEdit] = useState({ proposal_title: "", proposal_value: "", currency: "EUR", proposal_text: "", scope: "", timeline: "", next_steps: "" });

  const [rejecting, setRejecting] = useState<Proposal | null>(null);
  const [rejReason, setRejReason] = useState("");

  const items = useMemo(() => list.data ?? [], [list.data]);

  const openEdit = (p: Proposal) => {
    setEditing(p);
    setEdit({
      proposal_title: p.proposal_title,
      proposal_value: p.proposal_value == null ? "" : String(p.proposal_value),
      currency: p.currency || "EUR",
      proposal_text: p.proposal_text ?? "",
      scope: p.scope ?? "",
      timeline: p.timeline ?? "",
      next_steps: p.next_steps ?? "",
    });
  };

  return (
    <DashboardLayout title="Proposals">
      <div className="space-y-6 p-4 md:p-8">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Proposals</h1>
            <p className="text-sm text-muted-foreground">
              {pending.data ? `${pending.data} open` : "Generate, edit, and decide proposals."} ·
              Drafts are AI-assisted — every send and acceptance is human-controlled.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="viewed">Viewed</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setGenDialog(true)}>
              <Wand2 className="mr-2 h-4 w-4" /> Draft with AI
            </Button>
          </div>
        </header>

        {list.isLoading ? (
          <Card><CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent></Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <FileText className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">No proposals yet</p>
              <p className="text-sm text-muted-foreground">Generate one from a qualified prospect.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {items.map((p) => (
              <Card key={p.id}>
                <CardHeader className="space-y-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{p.proposal_title}</CardTitle>
                      <CardDescription>
                        {money(p.proposal_value, p.currency)}
                        {p.pricing_model ? ` · ${p.pricing_model}` : ""}
                        {p.timeline ? ` · ${p.timeline}` : ""}
                        {p.confidence != null ? ` · ${p.confidence}% confidence` : ""}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className={STATUS_TONE[p.status]}>
                      {p.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {p.proposal_text && (
                    <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">{p.proposal_text}</p>
                  )}
                  {Array.isArray(p.deliverables) && p.deliverables.length > 0 && (
                    <div className="text-sm">
                      <p className="mb-1 font-medium">Deliverables</p>
                      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                        {p.deliverables.slice(0, 6).map((d: any, i: number) => <li key={i}>{String(d)}</li>)}
                      </ul>
                    </div>
                  )}
                  {p.reasoning && (
                    <div className="rounded-md bg-muted/40 p-3 text-xs">
                      <p className="font-medium">Why this proposal</p>
                      <p className="text-muted-foreground">{p.reasoning}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => openEdit(p)}>Edit</Button>
                    {p.status === "draft" && (
                      <Button size="sm" onClick={() => transition.mutate({ id: p.id, status: "sent" })}>
                        <Send className="mr-2 h-4 w-4" /> Mark as sent
                      </Button>
                    )}
                    {(p.status === "sent" || p.status === "viewed" || p.status === "draft") && (
                      <>
                        <Button size="sm" variant="outline"
                                className="border-success/30 text-success hover:bg-success/10"
                                onClick={() => transition.mutate({ id: p.id, status: "accepted" })}>
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Mark accepted
                        </Button>
                        <Button size="sm" variant="outline"
                                className="border-destructive/30 text-destructive hover:bg-destructive/10"
                                onClick={() => { setRejecting(p); setRejReason(""); }}>
                          <XCircle className="mr-2 h-4 w-4" /> Mark rejected
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* GENERATE */}
      <Dialog open={genDialog} onOpenChange={(o) => !o && setGenDialog(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Draft a proposal with AI</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label>Prospect</Label>
              <Select value={genForm.prospect_id} onValueChange={(v) => setGenForm({ ...genForm, prospect_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pick a prospect" /></SelectTrigger>
                <SelectContent>
                  {(prospects ?? []).slice(0, 200).map((p: any) =>
                    <SelectItem key={p.id} value={p.id}>
                      {p.company_name || p.name || "Untitled"}{p.opportunity_score ? ` · ${p.opportunity_score}` : ""}
                    </SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Title hint (optional)</Label>
              <Input value={genForm.proposal_title} onChange={(e) => setGenForm({ ...genForm, proposal_title: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Notes / context</Label>
              <Textarea rows={4} value={genForm.notes}
                onChange={(e) => setGenForm({ ...genForm, notes: e.target.value })}
                placeholder="Anything from the call: pricing band, scope hints, objections..." />
            </div>
            <p className="text-xs text-muted-foreground">
              The proposal will be saved as a draft. Nothing is sent. You can edit before sharing.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setGenDialog(false)}>Cancel</Button>
            <Button disabled={!genForm.prospect_id || generate.isPending}
              onClick={() => generate.mutate(
                { prospect_id: genForm.prospect_id, proposal_title: genForm.proposal_title || undefined, notes: genForm.notes || undefined },
                { onSuccess: () => { setGenDialog(false); setGenForm({ prospect_id: "", proposal_title: "", notes: "" }); } },
              )}>
              {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Generate draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit proposal</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Title</Label>
                <Input value={edit.proposal_title} onChange={(e) => setEdit({ ...edit, proposal_title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Value</Label>
                  <Input type="number" value={edit.proposal_value} onChange={(e) => setEdit({ ...edit, proposal_value: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Currency</Label>
                  <Input value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value.toUpperCase() })} maxLength={6} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Proposal text</Label>
                <Textarea rows={8} value={edit.proposal_text} onChange={(e) => setEdit({ ...edit, proposal_text: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Scope</Label>
                <Textarea rows={3} value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Timeline</Label>
                  <Input value={edit.timeline} onChange={(e) => setEdit({ ...edit, timeline: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Next steps</Label>
                  <Input value={edit.next_steps} onChange={(e) => setEdit({ ...edit, next_steps: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={update.isPending}
              onClick={() => editing && update.mutate({
                id: editing.id,
                patch: {
                  proposal_title: edit.proposal_title,
                  proposal_value: edit.proposal_value === "" ? null as any : Number(edit.proposal_value),
                  currency: edit.currency || "EUR",
                  proposal_text: edit.proposal_text,
                  scope: edit.scope,
                  timeline: edit.timeline,
                  next_steps: edit.next_steps,
                } as Partial<Proposal>,
              }, { onSuccess: () => setEditing(null) })}>
              {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REJECT REASON */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark proposal rejected</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This moves the prospect to <strong>lost</strong>, captures the reason as a learning event,
              and records an outcome row.
            </p>
            <Textarea rows={3} value={rejReason} onChange={(e) => setRejReason(e.target.value)}
              placeholder="Reason (e.g. budget, timing, fit)..." />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={transition.isPending}
              onClick={() => rejecting && transition.mutate(
                { id: rejecting.id, status: "rejected", rejection_reason: rejReason || undefined },
                { onSuccess: () => setRejecting(null) },
              )}>
              <XCircle className="mr-2 h-4 w-4" /> Mark rejected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
