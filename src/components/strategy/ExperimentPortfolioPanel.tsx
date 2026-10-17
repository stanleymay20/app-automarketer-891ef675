import { useEffect, useMemo, useState } from "react";
import { Beaker, CircleDollarSign, FlaskConical, Gauge, Loader2, Pause, Play, Plus, ShieldCheck, Square, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ExperimentExecutionStatus,
  ExperimentObservationState,
  useCreateStrategicExperiment,
  useExperimentPortfolio,
  useRecordExperimentObservation,
  useReviewExperiment,
  useSubmitExperimentReview,
  useTransitionExperiment,
} from "@/hooks/useExperimentPortfolio";
import { useStrategicDecisions } from "@/hooks/useStrategy";

const splitLines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

function statusTone(status: string) {
  if (["running", "approved", "completed"].includes(status)) return "bg-success/10 text-success border-success/20";
  if (["pending", "paused"].includes(status)) return "bg-warning/10 text-warning border-warning/20";
  if (["rejected", "revoked", "stopped", "cancelled"].includes(status)) return "bg-destructive/10 text-destructive border-destructive/20";
  return "";
}

export function ExperimentPortfolioPanel({ appId }: { appId?: string }) {
  const { data: decisions = [] } = useStrategicDecisions(appId, 100);
  const { data: portfolio } = useExperimentPortfolio(appId);
  const createExperiment = useCreateStrategicExperiment();
  const submitReview = useSubmitExperimentReview();
  const reviewExperiment = useReviewExperiment();
  const transitionExperiment = useTransitionExperiment();
  const recordObservation = useRecordExperimentObservation();

  const experiments = portfolio?.experiments ?? [];
  const questions = portfolio?.questions ?? [];
  const approvedDecisions = useMemo(() => decisions.filter((decision) => decision.status === "approved"), [decisions]);

  const [createOpen, setCreateOpen] = useState(false);
  const [observationOpen, setObservationOpen] = useState(false);
  const [decisionId, setDecisionId] = useState("");
  const [questionId, setQuestionId] = useState("none");
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [informationObjective, setInformationObjective] = useState("");
  const [intervention, setIntervention] = useState("");
  const [comparisonBasis, setComparisonBasis] = useState("");
  const [primaryMetric, setPrimaryMetric] = useState("");
  const [metricUnit, setMetricUnit] = useState("");
  const [costCeiling, setCostCeiling] = useState(0);
  const [currency, setCurrency] = useState("EUR");
  const [commitmentClass, setCommitmentClass] = useState<"reversible" | "partly_reversible">("reversible");
  const [deadline, setDeadline] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return date.toISOString().slice(0, 10);
  });
  const [successConditions, setSuccessConditions] = useState("");
  const [killConditions, setKillConditions] = useState("");
  const [minimumSampleSize, setMinimumSampleSize] = useState("");
  const [successThreshold, setSuccessThreshold] = useState("");
  const [killThreshold, setKillThreshold] = useState("");

  const [observationExperimentId, setObservationExperimentId] = useState("");
  const [observationMetricValue, setObservationMetricValue] = useState("");
  const [observationSampleSize, setObservationSampleSize] = useState("");
  const [observationCost, setObservationCost] = useState("");
  const [observationState, setObservationState] = useState<ExperimentObservationState>("continue");
  const [observationNotes, setObservationNotes] = useState("");

  useEffect(() => {
    if (!decisionId && approvedDecisions[0]?.id) setDecisionId(approvedDecisions[0].id);
    if (decisionId && !approvedDecisions.some((decision) => decision.id === decisionId)) setDecisionId(approvedDecisions[0]?.id ?? "");
  }, [approvedDecisions, decisionId]);

  const selectedDecision = approvedDecisions.find((decision) => decision.id === decisionId);
  useEffect(() => {
    if (!selectedDecision) return;
    setCurrency(selectedDecision.currency || "EUR");
    if (selectedDecision.commitment_amount !== null && costCeiling > Number(selectedDecision.commitment_amount)) {
      setCostCeiling(Number(selectedDecision.commitment_amount));
    }
  }, [selectedDecision, costCeiling]);

  const eligibleQuestions = useMemo(() => questions.filter((question) => !question.decision_id || question.decision_id === decisionId), [questions, decisionId]);

  const totalCeiling = experiments.reduce((sum, experiment) => sum + Number(experiment.cost_ceiling || 0), 0);
  const runningCount = experiments.filter((experiment) => experiment.execution_status === "running").length;
  const freshApprovedCount = experiments.filter((experiment) => experiment.plan_review_status === "approved" && experiment.review_fresh).length;

  const resetCreate = () => {
    setTitle(""); setHypothesis(""); setInformationObjective(""); setIntervention(""); setComparisonBasis("");
    setPrimaryMetric(""); setMetricUnit(""); setCostCeiling(0); setCommitmentClass("reversible"); setQuestionId("none");
    setSuccessConditions(""); setKillConditions(""); setMinimumSampleSize(""); setSuccessThreshold(""); setKillThreshold("");
  };

  const createPlan = async () => {
    if (!decisionId || !title.trim() || !hypothesis.trim() || !informationObjective.trim() || !intervention.trim() || !primaryMetric.trim()) return;
    const success = splitLines(successConditions);
    const kill = splitLines(killConditions);
    if (!success.length || !kill.length) return;

    await createExperiment.mutateAsync({
      decision_id: decisionId,
      question_id: questionId === "none" ? undefined : questionId,
      title: title.trim(),
      hypothesis: hypothesis.trim(),
      information_objective: informationObjective.trim(),
      intervention: intervention.trim(),
      comparison_basis: comparisonBasis.trim() || undefined,
      primary_metric: primaryMetric.trim(),
      metric_unit: metricUnit.trim() || undefined,
      success_operator: successThreshold ? "gte" : undefined,
      success_threshold: successThreshold ? Number(successThreshold) : undefined,
      kill_operator: killThreshold ? "lte" : undefined,
      kill_threshold: killThreshold ? Number(killThreshold) : undefined,
      minimum_sample_size: minimumSampleSize ? Number(minimumSampleSize) : undefined,
      cost_ceiling: Math.max(0, costCeiling),
      currency,
      commitment_class: commitmentClass,
      deadline: new Date(`${deadline}T23:59:59`).toISOString(),
      success_conditions: success,
      kill_conditions: kill,
    });
    resetCreate();
    setCreateOpen(false);
  };

  const openObservation = (experimentId: string) => {
    setObservationExperimentId(experimentId);
    setObservationMetricValue(""); setObservationSampleSize(""); setObservationCost(""); setObservationState("continue"); setObservationNotes("");
    setObservationOpen(true);
  };

  const selectedObservationExperiment = experiments.find((experiment) => experiment.id === observationExperimentId);
  const logObservation = async () => {
    if (!selectedObservationExperiment) return;
    await recordObservation.mutateAsync({
      experiment_id: selectedObservationExperiment.id,
      metric_name: selectedObservationExperiment.primary_metric,
      metric_value: observationMetricValue === "" ? undefined : Number(observationMetricValue),
      metric_unit: selectedObservationExperiment.metric_unit || undefined,
      sample_size: observationSampleSize === "" ? undefined : Number(observationSampleSize),
      cost_to_date: observationCost === "" ? undefined : Number(observationCost),
      result_state: observationState,
      notes: observationNotes.trim() || undefined,
    });
    setObservationOpen(false);
  };

  const transition = (experimentId: string, status: Exclude<ExperimentExecutionStatus, "not_started">, reason?: string) => {
    transitionExperiment.mutate({ experimentId, status, reason });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Beaker className="h-4 w-4 text-primary" />Phase 10 · Experiment Portfolio & Real-options Planning</CardTitle>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">Convert an approved strategic decision into a smaller, time-boxed learning commitment. Running is ledger state only; this surface does not launch ads, spend money, publish, contact prospects or execute external actions.</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" disabled={!appId || !approvedDecisions.length}><Plus className="mr-2 h-3.5 w-3.5" />Experiment</Button></DialogTrigger>
            <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
              <DialogHeader><DialogTitle>Plan a bounded experiment</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-2 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2"><Label>Approved source decision</Label><Select value={decisionId} onValueChange={setDecisionId}><SelectTrigger><SelectValue placeholder="Select approved decision" /></SelectTrigger><SelectContent>{approvedDecisions.map((decision) => <SelectItem key={decision.id} value={decision.id}>{decision.title}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2 md:col-span-2"><Label>Uncertainty to resolve</Label><Select value={questionId} onValueChange={setQuestionId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No linked question</SelectItem>{eligibleQuestions.map((question) => <SelectItem key={question.id} value={question.id}>IV {question.information_value_score} · {question.question}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2 md:col-span-2"><Label>Experiment title</Label><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Validate paid demand before market-entry commitment" /></div>
                <div className="space-y-2 md:col-span-2"><Label>Hypothesis</Label><Textarea value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} placeholder="If we offer X to segment Y, qualified conversion should improve because…" /></div>
                <div className="space-y-2 md:col-span-2"><Label>Information objective</Label><Textarea value={informationObjective} onChange={(event) => setInformationObjective(event.target.value)} placeholder="What uncertainty must this experiment reduce?" /></div>
                <div className="space-y-2 md:col-span-2"><Label>Intervention</Label><Textarea value={intervention} onChange={(event) => setIntervention(event.target.value)} placeholder="The bounded action to test. This plan does not execute it automatically." /></div>
                <div className="space-y-2"><Label>Comparison / control</Label><Input value={comparisonBasis} onChange={(event) => setComparisonBasis(event.target.value)} placeholder="Current offer / holdout / baseline" /></div>
                <div className="space-y-2"><Label>Primary metric</Label><Input value={primaryMetric} onChange={(event) => setPrimaryMetric(event.target.value)} placeholder="qualified_conversion_rate" /></div>
                <div className="space-y-2"><Label>Metric unit</Label><Input value={metricUnit} onChange={(event) => setMetricUnit(event.target.value)} placeholder="%, EUR, customers" /></div>
                <div className="space-y-2"><Label>Minimum sample size</Label><Input type="number" min={1} value={minimumSampleSize} onChange={(event) => setMinimumSampleSize(event.target.value)} /></div>
                <div className="space-y-2"><Label>Success threshold ≥</Label><Input type="number" value={successThreshold} onChange={(event) => setSuccessThreshold(event.target.value)} placeholder="Optional structured gate" /></div>
                <div className="space-y-2"><Label>Kill threshold ≤</Label><Input type="number" value={killThreshold} onChange={(event) => setKillThreshold(event.target.value)} placeholder="Optional structured gate" /></div>
                <div className="space-y-2"><Label>Hard cost ceiling</Label><Input type="number" min={0} step="0.01" value={costCeiling} onChange={(event) => setCostCeiling(Math.max(0, Number(event.target.value) || 0))} /></div>
                <div className="space-y-2"><Label>Currency</Label><Input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} /></div>
                <div className="space-y-2"><Label>Commitment class</Label><Select value={commitmentClass} onValueChange={(value) => setCommitmentClass(value as "reversible" | "partly_reversible")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reversible">Reversible</SelectItem><SelectItem value="partly_reversible">Partly reversible</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Deadline</Label><Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></div>
                <div className="space-y-2"><Label>Success conditions · one per line</Label><Textarea value={successConditions} onChange={(event) => setSuccessConditions(event.target.value)} placeholder="Demand signal validated\nUnit economics remain inside limit" /></div>
                <div className="space-y-2"><Label>Kill conditions · one per line</Label><Textarea value={killConditions} onChange={(event) => setKillConditions(event.target.value)} placeholder="Cost ceiling reached\nTrust or compliance risk appears" /></div>
              </div>
              <DialogFooter><Button onClick={createPlan} disabled={!decisionId || !title.trim() || !hypothesis.trim() || !informationObjective.trim() || !intervention.trim() || !primaryMetric.trim() || !splitLines(successConditions).length || !splitLines(killConditions).length || createExperiment.isPending}>{createExperiment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create draft plan</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><FlaskConical className="h-3.5 w-3.5" />Experiments</div><div className="mt-1 text-xl font-semibold">{experiments.length}</div></div>
          <div className="rounded-lg border p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Play className="h-3.5 w-3.5" />Running</div><div className="mt-1 text-xl font-semibold">{runningCount}</div></div>
          <div className="rounded-lg border p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />Fresh approvals</div><div className="mt-1 text-xl font-semibold">{freshApprovedCount}</div></div>
          <div className="rounded-lg border p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><CircleDollarSign className="h-3.5 w-3.5" />Portfolio ceilings</div><div className="mt-1 text-xl font-semibold">{totalCeiling.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div><div className="text-[10px] text-muted-foreground">Mixed currencies are not converted.</div></div>
        </div>

        {!approvedDecisions.length && !experiments.length ? (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Approve a strategic decision first. Phase 10 deliberately refuses to create experiments from merely proposed recommendations.</div>
        ) : !experiments.length ? (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No experiment plans yet. Use a bounded experiment to buy information before increasing commitment.</div>
        ) : (
          <div className="space-y-3">
            {experiments.map((experiment) => {
              const canObserve = ["running", "paused"].includes(experiment.execution_status);
              const staleApproval = experiment.plan_review_status === "approved" && !experiment.review_fresh;
              const spendPct = experiment.cost_ceiling > 0 ? Math.min(100, Math.round((Number(experiment.cost_to_date) / Number(experiment.cost_ceiling)) * 100)) : 0;
              return (
                <div key={experiment.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{experiment.title}</span><Badge variant="outline" className={statusTone(experiment.execution_status)}>{experiment.execution_status.replaceAll("_", " ")}</Badge><Badge variant="outline" className={statusTone(experiment.plan_review_status)}>{experiment.plan_review_status} review</Badge>{staleApproval && <Badge variant="destructive">stale approval</Badge>}</div>
                      <p className="mt-1 text-xs text-muted-foreground">Source: {experiment.source_decision_title}</p>
                    </div>
                    <div className="text-right text-xs"><div className="font-semibold">{experiment.cost_to_date} / {experiment.cost_ceiling} {experiment.currency}</div><div className="text-muted-foreground">hard experiment ceiling</div></div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="rounded bg-muted/40 p-3"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Hypothesis</div><p className="mt-1 text-xs">{experiment.hypothesis}</p></div>
                    <div className="rounded bg-muted/40 p-3"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Information objective</div><p className="mt-1 text-xs">{experiment.information_objective}</p></div>
                    <div className="rounded bg-muted/40 p-3"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Primary metric</div><p className="mt-1 text-xs">{experiment.primary_metric}{experiment.metric_unit ? ` · ${experiment.metric_unit}` : ""}</p></div>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${spendPct}%` }} /></div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span>IV proxy {experiment.information_value_score_snapshot ?? "—"}</span>
                    <span>Commitment leverage {experiment.commitment_leverage_ratio === null ? "—" : `${Number(experiment.commitment_leverage_ratio).toFixed(1)}×`}</span>
                    <span>{experiment.observation_count} observations</span>
                    <span>Deadline {new Date(experiment.deadline).toLocaleDateString()}</span>
                    {experiment.success_gate_seen && <span className="text-success">success gate observed</span>}
                    {experiment.kill_gate_seen && <span className="text-destructive">kill gate observed</span>}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {["draft", "rejected", "revoked"].includes(experiment.plan_review_status) && experiment.execution_status === "not_started" && <Button size="sm" variant="outline" onClick={() => submitReview.mutate(experiment.id)} disabled={submitReview.isPending}>Submit review</Button>}
                    {experiment.plan_review_status === "pending" && <><Button size="sm" onClick={() => reviewExperiment.mutate({ experimentId: experiment.id, action: "approve" })} disabled={reviewExperiment.isPending}><ShieldCheck className="mr-1 h-3.5 w-3.5" />Approve plan</Button><Button size="sm" variant="outline" onClick={() => reviewExperiment.mutate({ experimentId: experiment.id, action: "reject", reason: "Plan requires revision." })} disabled={reviewExperiment.isPending}>Reject</Button></>}
                    {experiment.plan_review_status === "approved" && experiment.review_fresh && experiment.execution_status === "not_started" && <Button size="sm" onClick={() => transition(experiment.id, "running")} disabled={transitionExperiment.isPending}><Play className="mr-1 h-3.5 w-3.5" />Start ledger</Button>}
                    {experiment.execution_status === "running" && <Button size="sm" variant="outline" onClick={() => transition(experiment.id, "paused")}><Pause className="mr-1 h-3.5 w-3.5" />Pause</Button>}
                    {experiment.execution_status === "paused" && experiment.review_fresh && <Button size="sm" onClick={() => transition(experiment.id, "running")}><Play className="mr-1 h-3.5 w-3.5" />Resume</Button>}
                    {canObserve && <Button size="sm" variant="outline" onClick={() => openObservation(experiment.id)}><Gauge className="mr-1 h-3.5 w-3.5" />Log observation</Button>}
                    {experiment.execution_status === "running" && experiment.observation_count > 0 && <Button size="sm" variant="outline" onClick={() => transition(experiment.id, "completed")}><Target className="mr-1 h-3.5 w-3.5" />Complete</Button>}
                    {["running", "paused"].includes(experiment.execution_status) && <Button size="sm" variant="destructive" onClick={() => transition(experiment.id, "stopped", "Manual experiment stop.")}><Square className="mr-1 h-3.5 w-3.5" />Stop</Button>}
                    {experiment.plan_review_status === "approved" && !["completed", "stopped", "cancelled"].includes(experiment.execution_status) && <Button size="sm" variant="ghost" onClick={() => reviewExperiment.mutate({ experimentId: experiment.id, action: "revoke", reason: "Experiment approval revoked." })}>Revoke approval</Button>}
                    {experiment.execution_status === "not_started" && <Button size="sm" variant="ghost" onClick={() => transition(experiment.id, "cancelled", "Cancelled before start.")}>Cancel</Button>}
                  </div>
                  {experiment.stop_reason && <p className="mt-2 text-xs text-destructive">Stopped: {experiment.stop_reason}</p>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={observationOpen} onOpenChange={setObservationOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record experiment observation</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-muted/50 p-3 text-xs"><div className="font-semibold">{selectedObservationExperiment?.title}</div><div className="mt-1 text-muted-foreground">Primary metric: {selectedObservationExperiment?.primary_metric}</div></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>Metric value</Label><Input type="number" value={observationMetricValue} onChange={(event) => setObservationMetricValue(event.target.value)} /></div>
              <div className="space-y-2"><Label>Sample size</Label><Input type="number" min={0} value={observationSampleSize} onChange={(event) => setObservationSampleSize(event.target.value)} /></div>
              <div className="space-y-2"><Label>Cost to date</Label><Input type="number" min={0} step="0.01" value={observationCost} onChange={(event) => setObservationCost(event.target.value)} placeholder={`≤ ${selectedObservationExperiment?.cost_ceiling ?? 0}`} /></div>
              <div className="space-y-2"><Label>Interpretation</Label><Select value={observationState} onValueChange={(value) => setObservationState(value as ExperimentObservationState)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="continue">Continue</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="failure">Failure</SelectItem><SelectItem value="inconclusive">Inconclusive</SelectItem><SelectItem value="stop">Stop</SelectItem></SelectContent></Select></div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={observationNotes} onChange={(event) => setObservationNotes(event.target.value)} placeholder="Observed result, context and anything that could explain it." /></div>
          </div>
          <DialogFooter><Button onClick={logObservation} disabled={!selectedObservationExperiment || recordObservation.isPending}>{recordObservation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record observation</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
