import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  Clock3,
  GitBranch,
  Loader2,
  Plus,
  Scale,
  ShieldAlert,
  Target,
  XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { EvidenceUncertaintyPanel } from "@/components/strategy/EvidenceUncertaintyPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useApps } from "@/hooks/useApps";
import {
  CommitmentClass,
  DecisionType,
  useCreateStrategicDecision,
  useCreateStrategicObjective,
  useStrategicDecisions,
  useStrategicObjectives,
  useUpdateStrategicDecisionStatus,
} from "@/hooks/useStrategy";

const commitmentLabel: Record<CommitmentClass, string> = {
  reversible: "Reversible",
  partly_reversible: "Partly reversible",
  hard_to_reverse: "Hard to reverse",
};

const commitmentTone: Record<CommitmentClass, string> = {
  reversible: "bg-success/10 text-success border-success/20",
  partly_reversible: "bg-warning/10 text-warning border-warning/20",
  hard_to_reverse: "bg-destructive/10 text-destructive border-destructive/20",
};

const decisionTypes: { value: DecisionType; label: string }[] = [
  { value: "research", label: "Research" },
  { value: "wait", label: "Wait" },
  { value: "test", label: "Test" },
  { value: "partner", label: "Partner" },
  { value: "reposition", label: "Reposition" },
  { value: "product", label: "Product" },
  { value: "price", label: "Price" },
  { value: "enter", label: "Enter market" },
  { value: "exit", label: "Exit market" },
  { value: "advertise", label: "Advertise" },
  { value: "scale", label: "Scale" },
  { value: "other", label: "Other" },
];

function MetricCard({ label, value, helper, icon: Icon }: { label: string; value: string | number; helper: string; icon: any }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
          </div>
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Strategy() {
  const { data: apps } = useApps();
  const [appId, setAppId] = useState<string | undefined>();
  const effectiveAppId = appId ?? apps?.[0]?.id;
  const { data: objectives = [], isLoading: objectivesLoading } = useStrategicObjectives(effectiveAppId);
  const { data: decisions = [], isLoading: decisionsLoading } = useStrategicDecisions(effectiveAppId);
  const createObjective = useCreateStrategicObjective();
  const createDecision = useCreateStrategicDecision();
  const updateDecision = useUpdateStrategicDecisionStatus();

  const [objectiveOpen, setObjectiveOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);

  const [objectiveName, setObjectiveName] = useState("");
  const [goalType, setGoalType] = useState("revenue");
  const [targetValue, setTargetValue] = useState(100);
  const [targetMarket, setTargetMarket] = useState("");
  const [targetSegment, setTargetSegment] = useState("");
  const [rationale, setRationale] = useState("");
  const [objectiveCommitment, setObjectiveCommitment] = useState<CommitmentClass>("reversible");
  const [evidenceThreshold, setEvidenceThreshold] = useState(70);
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });

  const [decisionTitle, setDecisionTitle] = useState("");
  const [decisionType, setDecisionType] = useState<DecisionType>("test");
  const [recommendation, setRecommendation] = useState("");
  const [decisionRationale, setDecisionRationale] = useState("");
  const [confidence, setConfidence] = useState(50);
  const [reversibility, setReversibility] = useState<CommitmentClass>("reversible");
  const [goalId, setGoalId] = useState("none");
  const [nextInformation, setNextInformation] = useState("");

  const openDecisions = decisions.filter((d) => d.status === "proposed" || d.status === "approved" || d.status === "executing");
  const avgConfidence = useMemo(() => {
    const known = decisions.filter((d) => d.confidence !== null);
    if (!known.length) return "—";
    return `${Math.round(known.reduce((sum, d) => sum + Number(d.confidence), 0) / known.length)}%`;
  }, [decisions]);
  const hardCommitments = decisions.filter((d) => d.reversibility === "hard_to_reverse" && d.status !== "rejected" && d.status !== "cancelled").length;

  const resetObjectiveForm = () => {
    setObjectiveName("");
    setGoalType("revenue");
    setTargetValue(100);
    setTargetMarket("");
    setTargetSegment("");
    setRationale("");
    setObjectiveCommitment("reversible");
    setEvidenceThreshold(70);
  };

  const submitObjective = async () => {
    if (!effectiveAppId || !objectiveName.trim()) return;
    await createObjective.mutateAsync({
      app_id: effectiveAppId,
      objective_name: objectiveName.trim(),
      goal_type: goalType,
      target_value: targetValue,
      end_date: endDate,
      strategic_rationale: rationale.trim() || undefined,
      target_market: targetMarket.trim() || undefined,
      target_segment: targetSegment.trim() || undefined,
      evidence_threshold: evidenceThreshold,
      commitment_class: objectiveCommitment,
    });
    resetObjectiveForm();
    setObjectiveOpen(false);
  };

  const resetDecisionForm = () => {
    setDecisionTitle("");
    setDecisionType("test");
    setRecommendation("");
    setDecisionRationale("");
    setConfidence(50);
    setReversibility("reversible");
    setGoalId("none");
    setNextInformation("");
  };

  const submitDecision = async () => {
    if (!effectiveAppId || !decisionTitle.trim() || !recommendation.trim()) return;
    await createDecision.mutateAsync({
      app_id: effectiveAppId,
      goal_id: goalId === "none" ? undefined : goalId,
      decision_type: decisionType,
      title: decisionTitle.trim(),
      recommendation: recommendation.trim(),
      rationale: decisionRationale.trim() || undefined,
      confidence,
      reversibility,
      next_information_needed: nextInformation.trim() || undefined,
      authority_level: reversibility === "hard_to_reverse" ? "executive_approval" : "recommend",
    });
    resetDecisionForm();
    setDecisionOpen(false);
  };

  return (
    <DashboardLayout title="Strategy">
      <div className="space-y-6 pb-12">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-6 w-6 text-primary" />
              <h1 className="font-display text-2xl font-bold">Strategy Command</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Objectives first. Evidence before commitment. Campaigns serve strategy — not the other way around.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {apps && apps.length > 1 && (
              <Select value={effectiveAppId} onValueChange={setAppId}>
                <SelectTrigger className="w-[190px]"><SelectValue placeholder="Select offering" /></SelectTrigger>
                <SelectContent>{apps.map((app) => <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>)}</SelectContent>
              </Select>
            )}

            <Dialog open={objectiveOpen} onOpenChange={setObjectiveOpen}>
              <DialogTrigger asChild><Button variant="outline" disabled={!effectiveAppId}><Plus className="mr-2 h-4 w-4" />Objective</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>Create strategic objective</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-2 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2"><Label>Objective</Label><Input value={objectiveName} onChange={(e) => setObjectiveName(e.target.value)} placeholder="Win 50 profitable German SME customers" /></div>
                  <div className="space-y-2"><Label>Measure</Label><Select value={goalType} onValueChange={setGoalType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="revenue">Revenue</SelectItem><SelectItem value="signups">Signups</SelectItem><SelectItem value="traffic">Traffic</SelectItem><SelectItem value="awareness">Awareness</SelectItem><SelectItem value="engagement">Engagement</SelectItem><SelectItem value="customers">Customers</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><Label>Target</Label><Input type="number" min={1} value={targetValue} onChange={(e) => setTargetValue(Number(e.target.value) || 1)} /></div>
                  <div className="space-y-2"><Label>Target market</Label><Input value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)} placeholder="Germany" /></div>
                  <div className="space-y-2"><Label>Target segment</Label><Input value={targetSegment} onChange={(e) => setTargetSegment(e.target.value)} placeholder="SMEs, 10–100 employees" /></div>
                  <div className="space-y-2"><Label>Commitment class</Label><Select value={objectiveCommitment} onValueChange={(v) => setObjectiveCommitment(v as CommitmentClass)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reversible">Reversible</SelectItem><SelectItem value="partly_reversible">Partly reversible</SelectItem><SelectItem value="hard_to_reverse">Hard to reverse</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><Label>Evidence threshold (%)</Label><Input type="number" min={0} max={100} value={evidenceThreshold} onChange={(e) => setEvidenceThreshold(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>
                  <div className="space-y-2"><Label>Deadline</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
                  <div className="space-y-2 sm:col-span-2"><Label>Strategic rationale</Label><Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this objective matters and why this market/segment is attractive." /></div>
                </div>
                <DialogFooter><Button onClick={submitObjective} disabled={!objectiveName.trim() || createObjective.isPending}>{createObjective.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create objective</Button></DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={decisionOpen} onOpenChange={setDecisionOpen}>
              <DialogTrigger asChild><Button disabled={!effectiveAppId}><GitBranch className="mr-2 h-4 w-4" />Record decision</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>Record strategic decision</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-2 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2"><Label>Decision title</Label><Input value={decisionTitle} onChange={(e) => setDecisionTitle(e.target.value)} placeholder="Validate Poland before subsidiary commitment" /></div>
                  <div className="space-y-2"><Label>Action type</Label><Select value={decisionType} onValueChange={(v) => setDecisionType(v as DecisionType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{decisionTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Linked objective</Label><Select value={goalId} onValueChange={setGoalId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No objective</SelectItem>{objectives.map((o) => <SelectItem key={o.id} value={o.id}>{o.objective_name || o.goal_type}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2 sm:col-span-2"><Label>Recommendation</Label><Textarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} placeholder="Run a €5k reversible market test before committing to local fixed costs." /></div>
                  <div className="space-y-2 sm:col-span-2"><Label>Rationale</Label><Textarea value={decisionRationale} onChange={(e) => setDecisionRationale(e.target.value)} placeholder="What evidence supports this recommendation? Keep assumptions separate from observed facts." /></div>
                  <div className="space-y-2"><Label>Confidence (%)</Label><Input type="number" min={0} max={100} value={confidence} onChange={(e) => setConfidence(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>
                  <div className="space-y-2"><Label>Reversibility</Label><Select value={reversibility} onValueChange={(v) => setReversibility(v as CommitmentClass)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reversible">Reversible</SelectItem><SelectItem value="partly_reversible">Partly reversible</SelectItem><SelectItem value="hard_to_reverse">Hard to reverse</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2 sm:col-span-2"><Label>Next information needed</Label><Input value={nextInformation} onChange={(e) => setNextInformation(e.target.value)} placeholder="Which evidence would most change this decision?" /></div>
                </div>
                <DialogFooter><Button onClick={submitDecision} disabled={!decisionTitle.trim() || !recommendation.trim() || createDecision.isPending}>{createDecision.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record as proposed</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Active objectives" value={objectives.length} helper="Business outcomes campaigns serve" icon={Target} />
          <MetricCard label="Open decisions" value={openDecisions.length} helper="Proposed, approved or executing" icon={GitBranch} />
          <MetricCard label="Average confidence" value={avgConfidence} helper="Explicit uncertainty, not false certainty" icon={CircleHelp} />
          <MetricCard label="Hard commitments" value={hardCommitments} helper="Require executive approval by default" icon={ShieldAlert} />
        </div>

        <EvidenceUncertaintyPanel appId={effectiveAppId} objectives={objectives} decisions={decisions} />

        <div className="grid gap-6 xl:grid-cols-[1fr_1.35fr]">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div><h2 className="font-display text-lg font-semibold">Strategic objectives</h2><p className="text-xs text-muted-foreground">The parent layer above campaigns and tactics.</p></div>
            </div>
            {objectivesLoading ? (
              <Card className="p-6 text-sm text-muted-foreground">Loading objectives…</Card>
            ) : objectives.length === 0 ? (
              <Card className="border-dashed p-8 text-center"><Target className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">No strategic objective yet</p><p className="mt-1 text-sm text-muted-foreground">Create the outcome first; campaigns can then be judged by whether they advance it.</p></Card>
            ) : (
              objectives.map((objective) => {
                const progress = Math.min(100, Math.round((Number(objective.current_value || 0) / Math.max(1, Number(objective.target_value))) * 100));
                return (
                  <Card key={objective.id}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="font-semibold leading-tight">{objective.objective_name || objective.goal_type}</p><p className="mt-1 text-xs text-muted-foreground">{[objective.target_market, objective.target_segment].filter(Boolean).join(" · ") || "Market/segment not specified"}</p></div>
                        <Badge variant="outline" className={commitmentTone[objective.commitment_class]}>{commitmentLabel[objective.commitment_class]}</Badge>
                      </div>
                      {objective.strategic_rationale && <p className="text-sm text-muted-foreground">{objective.strategic_rationale}</p>}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs"><span>{objective.current_value} / {objective.target_value} {objective.goal_type}</span><span>{progress}%</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span>Evidence gate: {objective.evidence_threshold}%</span><span>•</span><span>Risk: {objective.risk_tolerance}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </section>

          <section className="space-y-3">
            <div><h2 className="font-display text-lg font-semibold">Decision ledger</h2><p className="text-xs text-muted-foreground">Recommendation, uncertainty, reversibility and approval stay auditable.</p></div>
            {decisionsLoading ? (
              <Card className="p-6 text-sm text-muted-foreground">Loading decisions…</Card>
            ) : decisions.length === 0 ? (
              <Card className="border-dashed p-8 text-center"><Scale className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">No strategic decisions recorded</p><p className="mt-1 text-sm text-muted-foreground">Start with a proposed decision. Execution remains separate from recommendation.</p></Card>
            ) : (
              decisions.map((decision) => (
                <Card key={decision.id} className="overflow-hidden">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{decision.title}</CardTitle>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant="secondary" className="capitalize">{decision.decision_type.replaceAll("_", " ")}</Badge>
                          <Badge variant="outline" className={commitmentTone[decision.reversibility]}>{commitmentLabel[decision.reversibility]}</Badge>
                          <Badge variant="outline" className="capitalize">{decision.status}</Badge>
                        </div>
                      </div>
                      <div className="text-right"><div className="text-lg font-bold">{decision.confidence === null ? "—" : `${decision.confidence}%`}</div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">confidence</div></div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-2">
                    <p className="text-sm font-medium">{decision.recommendation}</p>
                    {decision.rationale && <p className="text-xs text-muted-foreground">{decision.rationale}</p>}
                    {decision.next_information_needed && <div className="rounded-md bg-muted/60 p-2 text-xs"><span className="font-semibold">Next information:</span> {decision.next_information_needed}</div>}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />{formatDistanceToNow(new Date(decision.created_at), { addSuffix: true })} · authority: {decision.authority_level.replaceAll("_", " ")}</span>
                      {decision.status === "proposed" && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="h-7 gap-1" disabled={updateDecision.isPending} onClick={() => updateDecision.mutate({ id: decision.id, status: "rejected" })}><XCircle className="h-3.5 w-3.5" />Reject</Button>
                          <Button size="sm" className="h-7 gap-1" disabled={updateDecision.isPending} onClick={() => updateDecision.mutate({ id: decision.id, status: "approved" })}><CheckCircle2 className="h-3.5 w-3.5" />Approve</Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
