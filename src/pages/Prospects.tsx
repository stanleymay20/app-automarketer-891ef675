import { useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Building2, Landmark, Handshake, TrendingUp, Users, Sparkles, ExternalLink,
  Bookmark, Eye, X, MessageSquare, Send, Check, Loader2, Copy, Linkedin,
  Mail, Upload, Download, Trophy, XCircle, Calendar as CalIcon, FileText,
} from "lucide-react";
import {
  useProspects, useDiscoverProspects, useProspectAction, useProspectActions,
  useImportProspects, parseProspectCsv, prospectsToCsv, PROSPECT_STAGES,
  type ProspectCategory, type Prospect, type ProspectStage,
} from "@/hooks/useProspects";
import { useApps } from "@/hooks/useApps";
import { useICPs } from "@/hooks/useAudience";
import { useSendOutreach, useEnrollSequence } from "@/hooks/useSequences";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_META: Record<ProspectCategory, { label: string; icon: any; blurb: string }> = {
  customer:  { label: "Customers",   icon: Building2, blurb: "Organizations that match your ICP." },
  grant:     { label: "Grants",      icon: Landmark,  blurb: "Open funding programs and accelerators." },
  partner:   { label: "Partners",    icon: Handshake, blurb: "Distributors, agencies, complementary tools." },
  investor:  { label: "Investors",   icon: TrendingUp,blurb: "Angels, accelerators, VCs for your stage." },
  community: { label: "Communities", icon: Users,     blurb: "Where your audience is already active." },
};

const STAGE_LABEL: Record<ProspectStage, string> = {
  new: "New", saved: "Saved", qualified: "Qualified",
  contacted: "Contacted", responded: "Responded",
  meeting: "Meeting", proposal: "Proposal",
  won: "Won", lost: "Lost",
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="w-7 text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}

function ProspectCard({ p, onOpen }: { p: Prospect; onOpen: (p: Prospect) => void }) {
  const action = useProspectAction();
  const stage = (p.stage ?? "new") as ProspectStage;
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{p.name}</CardTitle>
            {p.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
            {(p.contact_name || p.contact_role) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {[p.contact_name, p.contact_role].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-bold leading-none text-primary">{p.prospect_score}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">score</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <ScoreBar label="Fit" value={p.fit_score} />
          <ScoreBar label="Opportunity" value={p.opportunity_score} />
          <ScoreBar label="Urgency" value={p.urgency_score} />
          <ScoreBar label="Reachability" value={p.reachability_score} />
        </div>
        {(p.evidence_summary || p.match_reason) && (
          <p className="rounded-md bg-muted/50 p-2 text-xs italic text-muted-foreground">
            {p.evidence_summary ?? p.match_reason}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={stage === "won" ? "default" : stage === "lost" ? "destructive" : "secondary"}>
            {STAGE_LABEL[stage]}
          </Badge>
          {p.source_confidence != null && (
            <Badge variant="outline" className="text-[10px]">conf {p.source_confidence}</Badge>
          )}
          {p.source_type && <Badge variant="outline" className="text-[10px] capitalize">{p.source_type}</Badge>}
          {p.industry && <Badge variant="outline">{p.industry}</Badge>}
          {p.deadline && <Badge variant="outline">Closes {new Date(p.deadline).toLocaleDateString()}</Badge>}
          {p.next_action_at && (
            <Badge variant="outline" className="gap-1">
              <CalIcon className="h-3 w-3" /> {new Date(p.next_action_at).toLocaleDateString()}
            </Badge>
          )}
          {p.url && (
            <a href={p.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Visit <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => onOpen(p)} className="gap-1">
            <Sparkles className="h-3.5 w-3.5" /> Outreach
          </Button>
          <Button size="sm" variant="outline" onClick={() => action.mutate({ prospect_id: p.id, action: "generate_campaign" })}>
            Campaign
          </Button>
          <Button size="sm" variant="ghost" onClick={() => action.mutate({ prospect_id: p.id, action: "save" })}>
            <Bookmark className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => action.mutate({ prospect_id: p.id, action: "watch" })}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => action.mutate({ prospect_id: p.id, action: "dismiss" })}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ContactPanel({ prospect }: { prospect: Prospect }) {
  const action = useProspectAction();
  const [form, setForm] = useState({
    contact_name: prospect.contact_name ?? "",
    contact_email: prospect.contact_email ?? "",
    contact_linkedin: prospect.contact_linkedin ?? "",
    contact_role: prospect.contact_role ?? "",
    industry: prospect.industry ?? "",
    company_size: prospect.company_size ?? "",
    notes: prospect.notes ?? "",
    next_action_at: prospect.next_action_at ? prospect.next_action_at.slice(0, 10) : "",
  });
  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div><Label className="text-xs">Contact name</Label><Input value={form.contact_name} onChange={set("contact_name")} /></div>
      <div><Label className="text-xs">Role / title</Label><Input value={form.contact_role} onChange={set("contact_role")} /></div>
      <div><Label className="text-xs">Email</Label><Input type="email" value={form.contact_email} onChange={set("contact_email")} /></div>
      <div><Label className="text-xs">LinkedIn URL</Label><Input value={form.contact_linkedin} onChange={set("contact_linkedin")} placeholder="https://linkedin.com/in/..." /></div>
      <div><Label className="text-xs">Industry</Label><Input value={form.industry} onChange={set("industry")} /></div>
      <div><Label className="text-xs">Company size</Label><Input value={form.company_size} onChange={set("company_size")} placeholder="e.g. 11-50" /></div>
      <div><Label className="text-xs">Next action</Label><Input type="date" value={form.next_action_at} onChange={set("next_action_at")} /></div>
      <div><Label className="text-xs">Stage</Label>
        <Select value={prospect.stage} onValueChange={(v) => action.mutate({ prospect_id: prospect.id, action: "set_stage", stage: v as ProspectStage })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROSPECT_STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2"><Label className="text-xs">Notes</Label><Textarea rows={3} value={form.notes} onChange={set("notes")} /></div>
      <div className="sm:col-span-2 flex justify-end">
        <Button
          size="sm"
          onClick={() =>
            action.mutate({
              prospect_id: prospect.id,
              action: "update_contact",
              contact: {
                ...form,
                next_action_at: form.next_action_at ? new Date(form.next_action_at).toISOString() : null,
              },
            })
          }
        >
          Save contact details
        </Button>
      </div>
    </div>
  );
}

function OutreachDialog({ prospect, onClose }: { prospect: Prospect | null; onClose: () => void }) {
  const action = useProspectAction();
  const send = useSendOutreach();
  const enroll = useEnrollSequence();
  const { data: history } = useProspectActions(prospect?.id);
  const [channel, setChannel] = useState<string>("linkedin_message");
  const { toast } = useToast();

  if (!prospect) return null;
  const channels = prospect.category === "grant"
    ? [{ v: "grant_application", l: "Grant draft" }]
    : prospect.category === "partner"
    ? [{ v: "partnership_pitch", l: "Partnership pitch" }, { v: "email", l: "Email" }]
    : [{ v: "linkedin_message", l: "LinkedIn DM" }, { v: "email", l: "Email" }];

  const drafts = ((history ?? []) as any[]).filter((a) => a.body);
  const latest = drafts[0];

  const copyLatest = async () => {
    if (!latest) return toast({ title: "No draft to copy" });
    const text = latest.subject ? `Subject: ${latest.subject}\n\n${latest.body}` : latest.body;
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const openLinkedIn = () => {
    const url = prospect.contact_linkedin || prospect.url;
    if (!url) return toast({ title: "No LinkedIn or URL on file" });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const mailtoFallback = () => {
    if (!prospect.contact_email) return toast({ title: "No contact email on file" });
    const subject = latest?.subject ?? `Quick note about ${prospect.name}`;
    const body = latest?.body ?? "";
    window.location.href = `mailto:${prospect.contact_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const sendEmail = () => {
    if (!prospect.contact_email) return toast({ title: "No contact email on file" });
    if (!latest?.body) return toast({ title: "Generate a draft first" });
    send.mutate({
      prospect_id: prospect.id,
      subject: latest.subject || `Quick note about ${prospect.name}`,
      body: latest.body,
    });
  };

  const enrollSequence = () => {
    if (!prospect.contact_email) return toast({ title: "No contact email on file" });
    enroll.mutate({
      prospect_id: prospect.id,
      sequence_name: "default-3-step",
      step_days: [0, 3, 7],
      steps: [
        { subject: latest?.subject || `Quick note about ${prospect.name}`, body: latest?.body || "" },
        { subject: `Re: ${latest?.subject || prospect.name}`, body: "Following up in case my last note got buried." },
        { subject: `Last note re: ${prospect.name}`, body: "Closing the loop — happy to reconnect when timing is better." },
      ],
    });
  };

  return (
    <Dialog open={!!prospect} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>{prospect.name}</span>
            <Badge variant="secondary">{STAGE_LABEL[(prospect.stage ?? "new") as ProspectStage]}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <ContactPanel prospect={prospect} />

          <div className="flex flex-wrap gap-2 border-t pt-4">
            {channels.map((c) => (
              <Button key={c.v} size="sm" variant={channel === c.v ? "default" : "outline"} onClick={() => setChannel(c.v)}>
                {c.l}
              </Button>
            ))}
            <Button
              size="sm"
              className="ml-auto gap-1"
              disabled={action.isPending}
              onClick={() => action.mutate({ prospect_id: prospect.id, action: "generate_outreach", channel })}
            >
              {action.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copyLatest} className="gap-1"><Copy className="h-3.5 w-3.5" /> Copy message</Button>
            <Button size="sm" variant="outline" onClick={openLinkedIn} className="gap-1"><Linkedin className="h-3.5 w-3.5" /> Open LinkedIn</Button>
            <Button
              size="sm"
              onClick={sendEmail}
              disabled={send.isPending || !prospect.contact_email}
              className="gap-1"
            >
              {send.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send Email
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={enrollSequence}
              disabled={enroll.isPending || !prospect.contact_email}
              className="gap-1"
            >
              {enroll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalIcon className="h-3.5 w-3.5" />}
              Schedule 3-step follow-up
            </Button>
            <Button size="sm" variant="ghost" onClick={mailtoFallback} className="gap-1">
              <Mail className="h-3.5 w-3.5" /> mailto fallback
            </Button>
          </div>

          <div className="max-h-64 space-y-3 overflow-y-auto">
            {drafts.length === 0 && (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No drafts yet. Choose a channel and click Generate.
              </p>
            )}
            {drafts.map((d) => (
              <div key={d.id} className="rounded-md border p-3">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium capitalize">{d.channel ?? d.action_type}</span>
                  <span>{new Date(d.created_at).toLocaleString()}</span>
                </div>
                {d.subject && <p className="mb-1 text-sm font-medium">Subject: {d.subject}</p>}
                <Textarea defaultValue={d.body} className="min-h-32 text-xs" />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => action.mutate({ prospect_id: prospect.id, action: "mark_contacted" })}>
              <Send className="mr-1 h-3.5 w-3.5" /> Mark sent
            </Button>
            <Button size="sm" variant="outline" onClick={() => action.mutate({ prospect_id: prospect.id, action: "mark_responded" })}>
              <MessageSquare className="mr-1 h-3.5 w-3.5" /> Responded
            </Button>
            <Button size="sm" variant="outline" onClick={() => action.mutate({ prospect_id: prospect.id, action: "mark_meeting" })}>
              <CalIcon className="mr-1 h-3.5 w-3.5" /> Meeting
            </Button>
            <Button size="sm" variant="outline" onClick={() => action.mutate({ prospect_id: prospect.id, action: "mark_proposal" })}>
              <FileText className="mr-1 h-3.5 w-3.5" /> Proposal
            </Button>
            <Button size="sm" onClick={() => action.mutate({ prospect_id: prospect.id, action: "mark_won" })}>
              <Trophy className="mr-1 h-3.5 w-3.5" /> Won
            </Button>
            <Button size="sm" variant="ghost" onClick={() => action.mutate({ prospect_id: prospect.id, action: "mark_lost" })}>
              <XCircle className="mr-1 h-3.5 w-3.5" /> Lost
            </Button>
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Prospects() {
  const { data: apps } = useApps();
  const [appId, setAppId] = useState<string | undefined>(undefined);
  const { data: prospects = [], isLoading } = useProspects(appId);
  const discover = useDiscoverProspects();
  const importer = useImportProspects();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Prospect | null>(null);
  const [tab, setTab] = useState<ProspectCategory | "all">("all");
  const [stageFilter, setStageFilter] = useState<ProspectStage | "all">("all");
  const { toast } = useToast();

  const stageCounts = useMemo(() => {
    const c: Record<string, number> = { all: prospects.length };
    PROSPECT_STAGES.forEach((s) => (c[s] = 0));
    prospects.forEach((p) => { c[(p.stage ?? "new") as string] = (c[(p.stage ?? "new") as string] ?? 0) + 1; });
    return c;
  }, [prospects]);

  const filtered = useMemo(() => {
    return prospects.filter((p) => {
      if (tab !== "all" && p.category !== tab) return false;
      if (stageFilter !== "all" && (p.stage ?? "new") !== stageFilter) return false;
      return true;
    });
  }, [prospects, tab, stageFilter]);

  const memory = useMemo(() => ({
    total: prospects.length,
    saved: prospects.filter((p) => ["saved", "qualified"].includes(p.stage ?? "")).length,
    contacted: prospects.filter((p) => p.contacted_at).length,
    responded: prospects.filter((p) => p.responded_at).length,
    won: prospects.filter((p) => p.stage === "won").length,
    revenue: prospects.reduce((s, p) => s + Number(p.revenue_attributed ?? 0), 0),
  }), [prospects]);

  const handleImport = async (file: File) => {
    const text = await file.text();
    const rows = parseProspectCsv(text);
    if (rows.length === 0) return toast({ title: "No valid rows found", variant: "destructive" });
    importer.mutate({ appId, rows });
  };

  const handleExport = () => {
    const csv = prospectsToCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout title="Prospects">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Prospects</h1>
            <p className="text-sm text-muted-foreground">
              Who you should talk to next — and where each one stands in your pipeline.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={appId ?? ""}
              onChange={(e) => setAppId(e.target.value || undefined)}
            >
              <option value="">All offerings</option>
              {(apps ?? []).map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.currentTarget.value = ""; }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-1">
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0} className="gap-1">
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button onClick={() => discover.mutate({ appId })} disabled={discover.isPending} className="gap-1">
              {discover.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Discover
            </Button>
          </div>
        </div>

        {/* Pipeline summary */}
        <Card>
          <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-6">
            {[
              { k: "Discovered", v: memory.total },
              { k: "Saved", v: memory.saved },
              { k: "Contacted", v: memory.contacted },
              { k: "Responded", v: memory.responded },
              { k: "Won", v: memory.won },
              { k: "Revenue", v: `$${memory.revenue.toFixed(0)}` },
            ].map((m) => (
              <div key={m.k} className="text-center">
                <div className="text-xl font-bold">{m.v}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.k}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Stage filter */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...PROSPECT_STAGES] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={stageFilter === s ? "default" : "outline"}
              onClick={() => setStageFilter(s as any)}
              className="h-7 px-2.5 text-xs"
            >
              {s === "all" ? "All stages" : STAGE_LABEL[s as ProspectStage]} ({stageCounts[s] ?? 0})
            </Button>
          ))}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto">
            <TabsTrigger value="all">All ({prospects.length})</TabsTrigger>
            {(Object.keys(CATEGORY_META) as ProspectCategory[]).map((c) => {
              const M = CATEGORY_META[c];
              const Icon = M.icon;
              const n = prospects.filter((p) => p.category === c).length;
              return (
                <TabsTrigger key={c} value={c} className="gap-1">
                  <Icon className="h-3.5 w-3.5" />
                  {M.label} ({n})
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            {tab !== "all" && (
              <p className="mb-3 text-sm text-muted-foreground">{CATEGORY_META[tab as ProspectCategory].blurb}</p>
            )}
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                  <Sparkles className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No prospects in this view. Try a different stage, import a CSV, or click <b>Discover</b>.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p) => <ProspectCard key={p.id} p={p} onOpen={setOpen} />)}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <OutreachDialog prospect={open} onClose={() => setOpen(null)} />
    </DashboardLayout>
  );
}
