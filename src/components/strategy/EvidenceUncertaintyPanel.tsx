import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Eye,
  FlaskConical,
  Lightbulb,
  Loader2,
  Plus,
  Search,
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
import type { StrategicDecision, StrategicObjective } from "@/hooks/useStrategy";
import {
  EvidenceItemType,
  EvidenceSourceType,
  QuestionEffort,
  StrategicQuestion,
  useCreateStrategicEvidence,
  useCreateStrategicQuestion,
  useResolveStrategicQuestion,
  useStrategicEvidence,
  useStrategicQuestions,
  useUpdateStrategicEvidenceStatus,
} from "@/hooks/useStrategicEvidence";

interface Props {
  appId?: string;
  objectives: StrategicObjective[];
  decisions: StrategicDecision[];
}

const evidenceTypeMeta: Record<EvidenceItemType, { label: string; icon: typeof Eye; className: string }> = {
  observation: { label: "Observation", icon: Eye, className: "bg-success/10 text-success border-success/20" },
  inference: { label: "Inference", icon: Lightbulb, className: "bg-info/10 text-info border-info/20" },
  assumption: { label: "Assumption", icon: FlaskConical, className: "bg-warning/10 text-warning border-warning/20" },
  unknown: { label: "Unknown", icon: CircleHelp, className: "bg-destructive/10 text-destructive border-destructive/20" },
};

const evidenceTypes: EvidenceItemType[] = ["observation", "inference", "assumption", "unknown"];
const sourceTypes: EvidenceSourceType[] = ["manual", "analytics", "customer", "market", "competitor", "experiment", "document", "model", "other"];

function clampScore(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

function SmallMetric({ label, value, helper }: { label: string; value: string | number; helper: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-xl font-bold">{value}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  );
}

export function EvidenceUncertaintyPanel({ appId, objectives, decisions }: Props) {
  const { data: evidence = [], isLoading: evidenceLoading } = useStrategicEvidence(appId);
  const { data: questions = [], isLoading: questionsLoading } = useStrategicQuestions(appId);
  const createEvidence = useCreateStrategicEvidence();
  const updateEvidence = useUpdateStrategicEvidenceStatus();
  const createQuestion = useCreateStrategicQuestion();
  const resolveQuestion = useResolveStrategicQuestion();

  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [answering, setAnswering] = useState<StrategicQuestion | null>(null);
  const [answerText, setAnswerText] = useState("");

  const [itemType, setItemType] = useState<EvidenceItemType>("observation");
  const [claim, setClaim] = useState("");
  const [sourceType, setSourceType] = useState<EvidenceSourceType>("manual");
  const [sourceReference, setSourceReference] = useState("");
  const [evidenceConfidence, setEvidenceConfidence] = useState(70);
  const [evidenceStrength, setEvidenceStrength] = useState(70);
  const [impactIfWrong, setImpactIfWrong] = useState(50);
  const [decisionRelevance, setDecisionRelevance] = useState(70);
  const [evidenceGoalId, setEvidenceGoalId] = useState("none");
  const [evidenceDecisionId, setEvidenceDecisionId] = useState("none");

  const [question, setQuestion] = useState("");
  const [questionConfidence, setQuestionConfidence] = useState(50);
  const [decisionImpact, setDecisionImpact] = useState(70);
  const [answerability, setAnswerability] = useState(70);
  const [urgency, setUrgency] = useState(50);
  const [effort, setEffort] = useState<QuestionEffort>("medium");
  const [questionGoalId, setQuestionGoalId] = useState("none");
  const [questionDecisionId, setQuestionDecisionId] = useState("none");

  const activeEvidence = evidence.filter((item) => !["invalidated", "resolved", "superseded"].includes(item.status));
  const observations = activeEvidence.filter((item) => item.item_type === "observation").length;
  const assumptions = activeEvidence.filter((item) => item.item_type === "assumption").length;
  const unresolvedUnknowns = activeEvidence.filter((item) => item.item_type === "unknown").length;
  const confidenceValues = activeEvidence.map((item) => item.confidence).filter((value): value is number => value !== null);
  const averageConfidence = confidenceValues.length
    ? `${Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)}%`
    : "—";

  const openQuestions = useMemo(
    () => questions.filter((item) => item.status === "open").sort((a, b) => b.information_value_score - a.information_value_score || b.urgency - a.urgency),
    [questions]
  );
  const nextQuestion = openQuestions[0];

  const resetEvidence = () => {
    setItemType("observation");
    setClaim("");
    setSourceType("manual");
    setSourceReference("");
    setEvidenceConfidence(70);
    setEvidenceStrength(70);
    setImpactIfWrong(50);
    setDecisionRelevance(70);
    setEvidenceGoalId("none");
    setEvidenceDecisionId("none");
  };

  const submitEvidence = async () => {
    if (!appId || !claim.trim()) return;
    await createEvidence.mutateAsync({
      app_id: appId,
      goal_id: evidenceGoalId === "none" ? undefined : evidenceGoalId,
      decision_id: evidenceDecisionId === "none" ? undefined : evidenceDecisionId,
      item_type: itemType,
      claim: claim.trim(),
      source_type: sourceType,
      source_reference: sourceReference.trim() || undefined,
      confidence: evidenceConfidence,
      evidence_strength: itemType === "unknown" ? undefined : evidenceStrength,
      impact_if_wrong: impactIfWrong,
      decision_relevance: decisionRelevance,
      observed_at: itemType === "observation" ? new Date().toISOString() : undefined,
    });
    resetEvidence();
    setEvidenceOpen(false);
  };

  const resetQuestion = () => {
    setQuestion("");
    setQuestionConfidence(50);
    setDecisionImpact(70);
    setAnswerability(70);
    setUrgency(50);
    setEffort("medium");
    setQuestionGoalId("none");
    setQuestionDecisionId("none");
  };

  const submitQuestion = async () => {
    if (!appId || !question.trim()) return;
    await createQuestion.mutateAsync({
      app_id: appId,
      goal_id: questionGoalId === "none" ? undefined : questionGoalId,
      decision_id: questionDecisionId === "none" ? undefined : questionDecisionId,
      question: question.trim(),
      current_confidence: questionConfidence,
      decision_impact: decisionImpact,
      answerability,
      urgency,
      effort,
    });
    resetQuestion();
    setQuestionOpen(false);
  };

  const beginAnswer = (item: StrategicQuestion) => {
    setAnswering(item);
    setAnswerText("");
    setAnswerOpen(true);
  };

  const submitAnswer = async () => {
    if (!answering || !answerText.trim()) return;
    await resolveQuestion.mutateAsync({ id: answering.id, status: "answered", answer: answerText.trim() });
    setAnswerOpen(false);
    setAnswering(null);
    setAnswerText("");
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Evidence & uncertainty</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Observations, inferences, assumptions and unknowns stay separate. Missing evidence stays missing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" disabled={!appId}><Plus className="mr-2 h-4 w-4" />Evidence</Button></DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle>Record evidence or uncertainty</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <div className="space-y-2"><Label>Classification</Label><Select value={itemType} onValueChange={(value) => setItemType(value as EvidenceItemType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{evidenceTypes.map((type) => <SelectItem key={type} value={type}>{evidenceTypeMeta[type].label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Source type</Label><Select value={sourceType} onValueChange={(value) => setSourceType(value as EvidenceSourceType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sourceTypes.map((type) => <SelectItem key={type} value={type} className="capitalize">{type}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2 sm:col-span-2"><Label>Claim</Label><Textarea value={claim} onChange={(event) => setClaim(event.target.value)} placeholder={itemType === "observation" ? "Observed fact, with no interpretation added." : itemType === "unknown" ? "What is currently unknown?" : "State the claim explicitly."} /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Source reference</Label><Input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="Dataset, interview, report, experiment ID or URL label" /></div>
                <div className="space-y-2"><Label>Confidence (%)</Label><Input type="number" min={0} max={100} value={evidenceConfidence} onChange={(event) => setEvidenceConfidence(clampScore(Number(event.target.value)))} /></div>
                <div className="space-y-2"><Label>Evidence strength (%)</Label><Input type="number" min={0} max={100} disabled={itemType === "unknown"} value={evidenceStrength} onChange={(event) => setEvidenceStrength(clampScore(Number(event.target.value)))} /></div>
                <div className="space-y-2"><Label>Impact if wrong (%)</Label><Input type="number" min={0} max={100} value={impactIfWrong} onChange={(event) => setImpactIfWrong(clampScore(Number(event.target.value)))} /></div>
                <div className="space-y-2"><Label>Decision relevance (%)</Label><Input type="number" min={0} max={100} value={decisionRelevance} onChange={(event) => setDecisionRelevance(clampScore(Number(event.target.value)))} /></div>
                <div className="space-y-2"><Label>Linked objective</Label><Select value={evidenceGoalId} onValueChange={setEvidenceGoalId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No objective</SelectItem>{objectives.map((item) => <SelectItem key={item.id} value={item.id}>{item.objective_name || item.goal_type}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Linked decision</Label><Select value={evidenceDecisionId} onValueChange={setEvidenceDecisionId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No decision</SelectItem>{decisions.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <DialogFooter><Button onClick={submitEvidence} disabled={!claim.trim() || createEvidence.isPending}>{createEvidence.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record</Button></DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={questionOpen} onOpenChange={setQuestionOpen}>
            <DialogTrigger asChild><Button size="sm" disabled={!appId}><CircleHelp className="mr-2 h-4 w-4" />Question</Button></DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle>Add decision question</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2"><Label>Question</Label><Textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Which fact, if known, would most change the decision?" /></div>
                <div className="space-y-2"><Label>Current confidence (%)</Label><Input type="number" min={0} max={100} value={questionConfidence} onChange={(event) => setQuestionConfidence(clampScore(Number(event.target.value)))} /></div>
                <div className="space-y-2"><Label>Decision impact (%)</Label><Input type="number" min={0} max={100} value={decisionImpact} onChange={(event) => setDecisionImpact(clampScore(Number(event.target.value)))} /></div>
                <div className="space-y-2"><Label>Answerability (%)</Label><Input type="number" min={0} max={100} value={answerability} onChange={(event) => setAnswerability(clampScore(Number(event.target.value)))} /></div>
                <div className="space-y-2"><Label>Urgency (%)</Label><Input type="number" min={0} max={100} value={urgency} onChange={(event) => setUrgency(clampScore(Number(event.target.value)))} /></div>
                <div className="space-y-2"><Label>Effort</Label><Select value={effort} onValueChange={(value) => setEffort(value as QuestionEffort)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Linked objective</Label><Select value={questionGoalId} onValueChange={setQuestionGoalId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No objective</SelectItem>{objectives.map((item) => <SelectItem key={item.id} value={item.id}>{item.objective_name || item.goal_type}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2 sm:col-span-2"><Label>Linked decision</Label><Select value={questionDecisionId} onValueChange={setQuestionDecisionId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No decision</SelectItem>{decisions.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <p className="text-xs text-muted-foreground">Information-value proxy = uncertainty × decision impact × answerability. It is a 0–100 prioritisation score, not expected monetary value.</p>
              <DialogFooter><Button onClick={submitQuestion} disabled={!question.trim() || createQuestion.isPending}>{createQuestion.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add question</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SmallMetric label="Observed facts" value={observations} helper="Active observations only" />
        <SmallMetric label="Assumptions" value={assumptions} helper="Explicitly exposed to testing" />
        <SmallMetric label="Unknowns" value={unresolvedUnknowns} helper="Unresolved uncertainty" />
        <SmallMetric label="Recorded confidence" value={averageConfidence} helper="Average of explicit confidence entries" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CircleHelp className="h-4 w-4 text-primary" />Next best question</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {questionsLoading ? (
              <p className="text-sm text-muted-foreground">Ranking questions…</p>
            ) : !nextQuestion ? (
              <div className="rounded-lg border border-dashed p-5 text-center"><p className="text-sm font-medium">No open question yet</p><p className="mt-1 text-xs text-muted-foreground">Add an uncertainty that could change a meaningful decision.</p></div>
            ) : (
              <>
                <p className="font-medium leading-snug">{nextQuestion.question}</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-background/80 p-2"><span className="text-muted-foreground">Information value</span><div className="text-lg font-bold">{nextQuestion.information_value_score}/100</div></div>
                  <div className="rounded-md bg-background/80 p-2"><span className="text-muted-foreground">Urgency</span><div className="text-lg font-bold">{nextQuestion.urgency}/100</div></div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>Confidence {nextQuestion.current_confidence}%</span><span>•</span><span>Impact {nextQuestion.decision_impact}%</span><span>•</span><span>Answerability {nextQuestion.answerability}%</span><span>•</span><span>Effort {nextQuestion.effort}</span></div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => beginAnswer(nextQuestion)}><CheckCircle2 className="mr-1.5 h-4 w-4" />Record answer</Button>
                  <Button size="sm" variant="outline" onClick={() => resolveQuestion.mutate({ id: nextQuestion.id, status: "dismissed" })}><XCircle className="mr-1.5 h-4 w-4" />Dismiss</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Evidence register</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {evidenceLoading ? (
              <p className="text-sm text-muted-foreground">Loading evidence…</p>
            ) : activeEvidence.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-center"><AlertTriangle className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">No classified evidence yet</p><p className="mt-1 text-xs text-muted-foreground">Do not treat a rationale as evidence. Record what was observed, inferred, assumed or remains unknown.</p></div>
            ) : (
              activeEvidence.slice(0, 8).map((item) => {
                const meta = evidenceTypeMeta[item.item_type];
                const Icon = meta.icon;
                return (
                  <div key={item.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5"><Badge variant="outline" className={meta.className}><Icon className="mr-1 h-3 w-3" />{meta.label}</Badge><Badge variant="secondary" className="capitalize">{item.status}</Badge></div>
                        <p className="text-sm leading-snug">{item.claim}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">source: {item.source_type}{item.source_reference ? ` · ${item.source_reference}` : ""}</p>
                      </div>
                      <div className="shrink-0 text-right"><div className="font-bold">{item.confidence === null ? "—" : `${item.confidence}%`}</div><div className="text-[10px] text-muted-foreground">confidence</div></div>
                    </div>
                    {item.status === "active" && (
                      <div className="mt-2 flex justify-end gap-2">
                        {item.item_type === "unknown" ? (
                          <Button size="sm" variant="outline" className="h-7" disabled={updateEvidence.isPending} onClick={() => updateEvidence.mutate({ id: item.id, status: "resolved" })}>Resolve</Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7" disabled={updateEvidence.isPending} onClick={() => updateEvidence.mutate({ id: item.id, status: "validated" })}>Validate</Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {openQuestions.length > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Question queue</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {openQuestions.slice(1, 6).map((item) => (
              <div key={item.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.question}</p><p className="mt-1 text-[11px] text-muted-foreground">value {item.information_value_score}/100 · urgency {item.urgency}/100 · effort {item.effort}</p></div>
                <Button size="sm" variant="outline" onClick={() => beginAnswer(item)}>Answer</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={answerOpen} onOpenChange={setAnswerOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record answer</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm font-medium">{answering?.question}</p>
            <div className="space-y-2"><Label>Answer / finding</Label><Textarea value={answerText} onChange={(event) => setAnswerText(event.target.value)} placeholder="Record what was learned. Add the supporting observation separately to the evidence register." /></div>
          </div>
          <DialogFooter><Button onClick={submitAnswer} disabled={!answerText.trim() || resolveQuestion.isPending}>{resolveQuestion.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Mark answered</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
