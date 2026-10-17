import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Beaker,
  Brain,
  CheckCircle2,
  CircleHelp,
  Link2,
  Loader2,
  Plus,
  RefreshCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StrategicDecision } from "@/hooks/useStrategy";
import {
  CausalStatus,
  EvidenceRelationship,
  OutcomeDirection,
  StrategicLearningEvent,
  StrategicLearningKind,
  TransferTestResult,
  TransferabilityStatus,
  useCreateStrategicLearning,
  useCreateStrategicTransferTest,
  useInvalidateStrategicLearning,
  useLinkStrategicLearningEvidence,
  useStrategicMemory,
  useUpdateStrategicTransferTest,
} from "@/hooks/useStrategicMemory";

interface Props {
  appId?: string;
  decisions: StrategicDecision[];
}

const causalTone: Record<CausalStatus, string> = {
  unknown: "bg-muted text-muted-foreground",
  correlation: "bg-warning/10 text-warning border-warning/20",
  plausible: "bg-primary/10 text-primary border-primary/20",
  supported: "bg-success/10 text-success border-success/20",
  challenged: "bg-warning/10 text-warning border-warning/20",
  falsified: "bg-destructive/10 text-destructive border-destructive/20",
};

const kindLabel: Record<StrategicLearningKind, string> = {
  strategic_postmortem: "Postmortem",
  mechanism_hypothesis: "Mechanism hypothesis",
  correction: "Correction",
  transfer_result: "Transfer result",
};

function clampConfidence(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function StrategicMemoryPanel({ appId, decisions }: Props) {
  const { data, isLoading } = useStrategicMemory(appId);
  const createLearning = useCreateStrategicLearning();
  const linkEvidence = useLinkStrategicLearningEvidence();
  const createTransfer = useCreateStrategicTransferTest();
  const updateTransfer = useUpdateStrategicTransferTest();
  const invalidateLearning = useInvalidateStrategicLearning();

  const learnings = data?.learnings ?? [];
  const evidenceOptions = data?.evidenceOptions ?? [];
  const evidenceLinks = data?.evidenceLinks ?? [];
  const transferTests = data?.transferTests ?? [];

  const [learningOpen, setLearningOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  const [kind, setKind] = useState<StrategicLearningKind>("strategic_postmortem");
  const [decisionId, setDecisionId] = useState("none");
  const [lesson, setLesson] = useState("");
  const [actionSummary, setActionSummary] = useState("");
  const [outcomeSummary, setOutcomeSummary] = useState("");
  const [outcomeDirection, setOutcomeDirection] = useState<OutcomeDirection>("unknown");
  const [mechanism, setMechanism] = useState("");
  const [causalStatus, setCausalStatus] = useState<CausalStatus>("unknown");
  const [confidence, setConfidence] = useState(50);
  const [transferability, setTransferability] = useState<TransferabilityStatus>("unknown");
  const [transferScope, setTransferScope] = useState("");
  const [futureImpact, setFutureImpact] = useState("");
  const [supersedesId, setSupersedesId] = useState("none");

  const [selectedLearningId, setSelectedLearningId] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("none");
  const [relationship, setRelationship] = useState<EvidenceRelationship>("supports");
  const [linkNotes, setLinkNotes] = useState("");

  const [transferSourceId, setTransferSourceId] = useState<string | null>(null);
  const [transferTitle, setTransferTitle] = useState("");
  const [targetMarket, setTargetMarket] = useState("");
  const [targetSegment, setTargetSegment] = useState("");
  const [transferHypothesis, setTransferHypothesis] = useState("");
  const [transferMethod, setTransferMethod] = useState("");
  const [confidenceBefore, setConfidenceBefore] = useState(50);

  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [transferResult, setTransferResult] = useState<TransferTestResult>("supported");
  const [transferOutcome, setTransferOutcome] = useState("");
  const [confidenceAfter, setConfidenceAfter] = useState(50);

  const activeLearnings = learnings.filter((item) => item.status === "active");
  const mechanismLearnings = activeLearnings.filter((item) => Boolean(item.mechanism_hypothesis));
  const completedTests = transferTests.filter((test) => test.status === "completed");
  const challenged = activeLearnings.filter((item) => item.causal_status === "challenged" || item.causal_status === "falsified").length;

  const evidenceById = useMemo(
    () => new Map(evidenceOptions.map((item) => [item.id, item])),
    [evidenceOptions],
  );

  const resetLearning = () => {
    setKind("strategic_postmortem");
    setDecisionId("none");
    setLesson("");
    setActionSummary("");
    setOutcomeSummary("");
    setOutcomeDirection("unknown");
    setMechanism("");
    setCausalStatus("unknown");
    setConfidence(50);
    setTransferability("unknown");
    setTransferScope("");
    setFutureImpact("");
    setSupersedesId("none");
  };

  const submitLearning = async () => {
    if (!appId || !lesson.trim()) return;
    const linkedDecision = decisions.find((decision) => decision.id === decisionId);
    await createLearning.mutateAsync({
      app_id: appId,
      goal_id: linkedDecision?.goal_id ?? undefined,
      decision_id: decisionId === "none" ? undefined : decisionId,
      market_option_id: linkedDecision?.market_option_id ?? undefined,
      source_type: decisionId === "none" ? "manual" : "strategic_decision",
      source_id: decisionId === "none" ? undefined : decisionId,
      learning_kind: kind,
      lesson: lesson.trim(),
      action_summary: actionSummary.trim() || undefined,
      outcome_summary: outcomeSummary.trim() || undefined,
      outcome_direction: outcomeDirection,
      mechanism_hypothesis: mechanism.trim() || undefined,
      causal_status: mechanism.trim() ? causalStatus : "unknown",
      confidence: mechanism.trim() ? clampConfidence(confidence) : undefined,
      transferability_status: mechanism.trim() ? transferability : "unknown",
      transferability_scope: transferScope.trim() || undefined,
      future_impact: futureImpact.trim() || undefined,
      supersedes_learning_event_id: kind === "correction" && supersedesId !== "none" ? supersedesId : undefined,
      source_snapshot: linkedDecision ? {
        decision_id: linkedDecision.id,
        decision_type: linkedDecision.decision_type,
        recommendation: linkedDecision.recommendation,
        confidence: linkedDecision.confidence,
        reversibility: linkedDecision.reversibility,
        commitment_amount: linkedDecision.commitment_amount,
        currency: linkedDecision.currency,
        status: linkedDecision.status,
      } : {},
    });
    resetLearning();
    setLearningOpen(false);
  };

  const openLink = (learningId: string) => {
    setSelectedLearningId(learningId);
    setSelectedEvidenceId("none");
    setRelationship("supports");
    setLinkNotes("");
    setLinkOpen(true);
  };

  const submitLink = async () => {
    if (!selectedLearningId || selectedEvidenceId === "none") return;
    await linkEvidence.mutateAsync({
      learning_event_id: selectedLearningId,
      evidence_item_id: selectedEvidenceId,
      relationship,
      notes: linkNotes.trim() || undefined,
    });
    setLinkOpen(false);
  };

  const openTransfer = (learning: StrategicLearningEvent) => {
    setTransferSourceId(learning.id);
    setTransferTitle(`Test: ${learning.lesson.slice(0, 70)}`);
    setTransferHypothesis(learning.mechanism_hypothesis ?? "");
    setTransferMethod("");
    setTargetMarket("");
    setTargetSegment("");
    setConfidenceBefore(learning.confidence ?? 50);
    setTransferOpen(true);
  };

  const submitTransfer = async () => {
    if (!transferSourceId || !transferTitle.trim() || !transferHypothesis.trim()) return;
    await createTransfer.mutateAsync({
      source_learning_event_id: transferSourceId,
      target_app_id: appId,
      target_market: targetMarket.trim() || undefined,
      target_segment: targetSegment.trim() || undefined,
      test_title: transferTitle.trim(),
      hypothesis: transferHypothesis.trim(),
      method: transferMethod.trim() || undefined,
      confidence_before: clampConfidence(confidenceBefore),
    });
    setTransferOpen(false);
  };

  const openComplete = (testId: string) => {
    setSelectedTransferId(testId);
    setTransferResult("supported");
    setTransferOutcome("");
    setConfidenceAfter(50);
    setCompleteOpen(true);
  };

  const submitComplete = async () => {
    if (!selectedTransferId || transferResult === "unknown" || !transferOutcome.trim()) return;
    await updateTransfer.mutateAsync({
      id: selectedTransferId,
      patch: {
        status: "completed",
        result: transferResult,
        outcome_summary: transferOutcome.trim(),
        confidence_after: clampConfidence(confidenceAfter),
      },
    });
    setCompleteOpen(false);
  };

  const linkedEvidenceFor = (learningId: string) =>
    evidenceLinks.filter((link) => link.learning_event_id === learningId);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Strategic Memory & Causal Learning</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Preserve what happened, propose why, attach evidence, and test transfer before generalising.
          </p>
        </div>
        <Dialog open={learningOpen} onOpenChange={setLearningOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" disabled={!appId}><Plus className="mr-2 h-4 w-4" />Record learning</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader><DialogTitle>Record durable strategic learning</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2"><Label>Learning type</Label><Select value={kind} onValueChange={(v) => setKind(v as StrategicLearningKind)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="strategic_postmortem">Strategic postmortem</SelectItem><SelectItem value="mechanism_hypothesis">Mechanism hypothesis</SelectItem><SelectItem value="correction">Correction</SelectItem><SelectItem value="transfer_result">Transfer result</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Linked decision</Label><Select value={decisionId} onValueChange={setDecisionId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No decision</SelectItem>{decisions.map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}</SelectContent></Select></div>
              {kind === "correction" && <div className="space-y-2 sm:col-span-2"><Label>Corrects / supersedes</Label><Select value={supersedesId} onValueChange={setSupersedesId}><SelectTrigger><SelectValue placeholder="Choose prior learning" /></SelectTrigger><SelectContent><SelectItem value="none">No linked prior learning</SelectItem>{learnings.map((item) => <SelectItem key={item.id} value={item.id}>{item.lesson.slice(0, 90)}</SelectItem>)}</SelectContent></Select></div>}
              <div className="space-y-2 sm:col-span-2"><Label>Lesson</Label><Textarea value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="What should the organization remember?" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Action / intervention</Label><Textarea value={actionSummary} onChange={(e) => setActionSummary(e.target.value)} placeholder="What did we actually do?" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Observed outcome</Label><Textarea value={outcomeSummary} onChange={(e) => setOutcomeSummary(e.target.value)} placeholder="What happened? Keep observation separate from explanation." /></div>
              <div className="space-y-2"><Label>Outcome direction</Label><Select value={outcomeDirection} onValueChange={(v) => setOutcomeDirection(v as OutcomeDirection)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="positive">Positive</SelectItem><SelectItem value="negative">Negative</SelectItem><SelectItem value="mixed">Mixed</SelectItem><SelectItem value="neutral">Neutral</SelectItem><SelectItem value="unknown">Unknown</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Confidence (%)</Label><Input type="number" min={0} max={100} value={confidence} onChange={(e) => setConfidence(clampConfidence(Number(e.target.value)))} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Mechanism hypothesis</Label><Textarea value={mechanism} onChange={(e) => setMechanism(e.target.value)} placeholder="Why might the action have produced the outcome? This remains a hypothesis." /></div>
              <div className="space-y-2"><Label>Causal status</Label><Select value={causalStatus} onValueChange={(v) => setCausalStatus(v as CausalStatus)} disabled={!mechanism.trim()}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="correlation">Correlation only</SelectItem><SelectItem value="plausible">Plausible mechanism</SelectItem><SelectItem value="supported">Supported by evidence</SelectItem><SelectItem value="challenged">Challenged</SelectItem><SelectItem value="falsified">Falsified</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Transferability</Label><Select value={transferability} onValueChange={(v) => setTransferability(v as TransferabilityStatus)} disabled={!mechanism.trim()}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="local_only">Local only</SelectItem><SelectItem value="candidate">Candidate for transfer test</SelectItem><SelectItem value="tested">Tested elsewhere</SelectItem><SelectItem value="not_transferable">Not transferable</SelectItem></SelectContent></Select></div>
              <div className="space-y-2 sm:col-span-2"><Label>Transfer scope / conditions</Label><Input value={transferScope} onChange={(e) => setTransferScope(e.target.value)} placeholder="e.g. German SMEs with long sales cycles; do not assume other contexts" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Future impact</Label><Textarea value={futureImpact} onChange={(e) => setFutureImpact(e.target.value)} placeholder="How should this change future decisions or experiments?" /></div>
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              “Supported” means evidence currently supports the mechanism hypothesis. It does not mean ScrollMarketer has proven causation.
            </div>
            <DialogFooter><Button onClick={submitLearning} disabled={!lesson.trim() || (kind === "mechanism_hypothesis" && !mechanism.trim()) || createLearning.isPending}>{createLearning.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save learning</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Durable learnings</p><p className="mt-1 text-2xl font-bold">{activeLearnings.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Mechanism hypotheses</p><p className="mt-1 text-2xl font-bold">{mechanismLearnings.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Transfer tests completed</p><p className="mt-1 text-2xl font-bold">{completedTests.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Challenged / falsified</p><p className="mt-1 text-2xl font-bold">{challenged}</p></CardContent></Card>
      </div>

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading strategic memory…</Card>
      ) : learnings.length === 0 ? (
        <Card className="border-dashed p-8 text-center"><Brain className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">No durable strategic learning yet</p><p className="mt-1 text-sm text-muted-foreground">Record a postmortem after a meaningful decision or experiment. Tactical learning insights remain separate.</p></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {learnings.map((learning) => {
            const links = linkedEvidenceFor(learning.id);
            const tests = transferTests.filter((test) => test.source_learning_event_id === learning.id);
            return (
              <Card key={learning.id} className={learning.status === "invalidated" ? "opacity-60" : ""}>
                <CardHeader className="p-4 pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{learning.lesson}</CardTitle>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="secondary">{learning.learning_kind === "operational" ? "Operational" : kindLabel[learning.learning_kind]}</Badge>
                        <Badge variant="outline" className={causalTone[learning.causal_status]}>{learning.causal_status.replaceAll("_", " ")}</Badge>
                        <Badge variant="outline">{learning.transferability_status.replaceAll("_", " ")}</Badge>
                        {learning.status !== "active" && <Badge variant="destructive">{learning.status}</Badge>}
                      </div>
                    </div>
                    <div className="text-right"><div className="text-lg font-bold">{learning.confidence === null ? "—" : `${learning.confidence}%`}</div><div className="text-[10px] uppercase text-muted-foreground">mechanism confidence</div></div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 p-4 pt-2">
                  {learning.action_summary && <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Action</p><p className="text-sm">{learning.action_summary}</p></div>}
                  {learning.outcome_summary && <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Observed outcome · {learning.outcome_direction}</p><p className="text-sm">{learning.outcome_summary}</p></div>}
                  {learning.mechanism_hypothesis ? <div className="rounded-md border p-3"><div className="mb-1 flex items-center gap-1 text-xs font-semibold"><CircleHelp className="h-3.5 w-3.5" />Mechanism hypothesis</div><p className="text-sm text-muted-foreground">{learning.mechanism_hypothesis}</p><p className="mt-2 text-[11px] text-muted-foreground">Status: {learning.causal_status}. This label does not prove causation.</p></div> : <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">No mechanism hypothesis recorded. The outcome remains descriptive.</div>}
                  {learning.future_impact && <p className="text-xs"><span className="font-semibold">Future impact:</span> {learning.future_impact}</p>}
                  {learning.transferability_scope && <p className="text-xs"><span className="font-semibold">Transfer scope:</span> {learning.transferability_scope}</p>}

                  <div className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
                    <div className="flex items-center justify-between"><span className="font-semibold">Evidence links</span><span>{links.length}</span></div>
                    {links.slice(0, 3).map((link) => {
                      const evidence = evidenceById.get(link.evidence_item_id);
                      return <div key={link.id} className="flex gap-2 text-muted-foreground"><span className="capitalize">{link.relationship}:</span><span>{evidence?.claim ?? link.evidence_item_id}</span></div>;
                    })}
                  </div>

                  {tests.length > 0 && <div className="space-y-2"><p className="text-xs font-semibold">Transfer tests</p>{tests.map((test) => <div key={test.id} className="rounded-md border p-2 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{test.test_title}</span><Badge variant="outline">{test.status}{test.status === "completed" ? ` · ${test.result}` : ""}</Badge></div><p className="mt-1 text-muted-foreground">{[test.target_market, test.target_segment].filter(Boolean).join(" · ") || "Target context not specified"}</p>{test.outcome_summary && <p className="mt-1">{test.outcome_summary}</p>}<div className="mt-2 flex gap-2">{test.status === "planned" && <Button size="sm" variant="outline" className="h-7" onClick={() => updateTransfer.mutate({ id: test.id, patch: { status: "running" } })}>Start</Button>}{test.status !== "completed" && test.status !== "cancelled" && <Button size="sm" className="h-7" onClick={() => openComplete(test.id)}>Complete</Button>}</div></div>)}</div>}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <span className="text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(learning.created_at), { addSuffix: true })}</span>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="h-7" onClick={() => openLink(learning.id)}><Link2 className="mr-1 h-3.5 w-3.5" />Evidence</Button>
                      {learning.mechanism_hypothesis && learning.status === "active" && <Button size="sm" variant="outline" className="h-7" onClick={() => openTransfer(learning)}><Beaker className="mr-1 h-3.5 w-3.5" />Transfer test</Button>}
                      {learning.status === "active" && <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => invalidateLearning.mutate(learning.id)} disabled={invalidateLearning.isPending}><XCircle className="mr-1 h-3.5 w-3.5" />Invalidate</Button>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Link evidence to learning</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>Evidence item</Label><Select value={selectedEvidenceId} onValueChange={setSelectedEvidenceId}><SelectTrigger><SelectValue placeholder="Choose evidence" /></SelectTrigger><SelectContent><SelectItem value="none">Choose evidence</SelectItem>{evidenceOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.item_type}: {item.claim.slice(0, 95)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Relationship</Label><Select value={relationship} onValueChange={(v) => setRelationship(v as EvidenceRelationship)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="supports">Supports</SelectItem><SelectItem value="challenges">Challenges</SelectItem><SelectItem value="context">Context only</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={linkNotes} onChange={(e) => setLinkNotes(e.target.value)} placeholder="Why is this evidence relevant to the learning?" /></div>
          </div>
          <DialogFooter><Button onClick={submitLink} disabled={selectedEvidenceId === "none" || linkEvidence.isPending}>{linkEvidence.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Link evidence</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Plan a transfer test</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label>Test title</Label><Input value={transferTitle} onChange={(e) => setTransferTitle(e.target.value)} /></div>
            <div className="space-y-2"><Label>Target market</Label><Input value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)} placeholder="Austria" /></div>
            <div className="space-y-2"><Label>Target segment</Label><Input value={targetSegment} onChange={(e) => setTargetSegment(e.target.value)} placeholder="SMEs, 10–100 employees" /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Mechanism to test</Label><Textarea value={transferHypothesis} onChange={(e) => setTransferHypothesis(e.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Method</Label><Textarea value={transferMethod} onChange={(e) => setTransferMethod(e.target.value)} placeholder="Describe the smallest valid test and the observation that would support/challenge transfer." /></div>
            <div className="space-y-2"><Label>Confidence before (%)</Label><Input type="number" min={0} max={100} value={confidenceBefore} onChange={(e) => setConfidenceBefore(clampConfidence(Number(e.target.value)))} /></div>
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">A transfer test checks whether a mechanism survives a new context. It does not copy a tactic blindly.</div>
          <DialogFooter><Button onClick={submitTransfer} disabled={!transferTitle.trim() || !transferHypothesis.trim() || createTransfer.isPending}>{createTransfer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Plan test</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Complete transfer test</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>Result</Label><Select value={transferResult} onValueChange={(v) => setTransferResult(v as TransferTestResult)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="supported">Supported</SelectItem><SelectItem value="mixed">Mixed</SelectItem><SelectItem value="challenged">Challenged</SelectItem><SelectItem value="falsified">Falsified</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Observed outcome</Label><Textarea value={transferOutcome} onChange={(e) => setTransferOutcome(e.target.value)} placeholder="What actually happened in the target context?" /></div>
            <div className="space-y-2"><Label>Confidence after (%)</Label><Input type="number" min={0} max={100} value={confidenceAfter} onChange={(e) => setConfidenceAfter(clampConfidence(Number(e.target.value)))} /></div>
          </div>
          <DialogFooter><Button onClick={submitComplete} disabled={!transferOutcome.trim() || updateTransfer.isPending}>{updateTransfer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Complete test</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="border-dashed">
        <CardContent className="flex gap-3 p-4 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div><span className="font-semibold text-foreground">Causal discipline:</span> tactical `learning_insights` may suggest patterns, but they are not silently promoted into durable causal memory. Durable learning keeps the observed outcome, mechanism hypothesis, confidence, challenging evidence and transfer tests separate.</div>
        </CardContent>
      </Card>
    </section>
  );
}
