import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Beaker,
  BrainCircuit,
  GitBranch,
  History,
  Loader2,
  Plus,
  Save,
  ShieldQuestion,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMarketOptions } from "@/hooks/useMarketChoice";
import { useStrategicEvidence } from "@/hooks/useStrategicEvidence";
import type { CommitmentClass, StrategicDecision, StrategicObjective } from "@/hooks/useStrategy";
import {
  DecisionEffect,
  LikelihoodBasis,
  ScenarioActorType,
  SensitivityEvidenceBasis,
  StrategicScenarioBranch,
  useCreateScenarioBranch,
  useCreateSensitivityTest,
  useCreateStrategicScenario,
  useStrategySimulation,
  useUpdateStrategicScenario,
} from "@/hooks/useStrategySimulation";

interface Props {
  appId?: string;
  objectives: StrategicObjective[];
  decisions: StrategicDecision[];
}

const actorTypes: ScenarioActorType[] = ["company", "competitor", "customer", "market", "regulator", "partner", "internal", "other"];
const likelihoodBases: { value: LikelihoodBasis; label: string }[] = [
  { value: "unknown", label: "Unknown — do not guess" },
  { value: "manual_assumption", label: "Manual assumption" },
  { value: "observed_frequency", label: "Observed historical frequency" },
];
const commitmentOptions: CommitmentClass[] = ["reversible", "partly_reversible", "hard_to_reverse"];

function optionalNumber(value: string) {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function likelihoodLabel(branch: StrategicScenarioBranch) {
  if (branch.likelihood_basis === "unknown" || branch.likelihood_pct === null) return "Likelihood unknown";
  if (branch.likelihood_basis === "observed_frequency") {
    return `${Number(branch.likelihood_pct).toFixed(0)}% historical frequency (${branch.observed_response_count}/${branch.comparable_event_count})`;
  }
  return `${Number(branch.likelihood_pct).toFixed(0)}% manual assumption`;
}

function stressTone(score: number | null) {
  if (score === null) return "bg-muted text-muted-foreground";
  if (score >= 50) return "bg-destructive/10 text-destructive border-destructive/20";
  if (score >= 25) return "bg-warning/10 text-warning border-warning/20";
  return "bg-success/10 text-success border-success/20";
}

export function ScenarioLabPanel({ appId, objectives, decisions }: Props) {
  const { data, isLoading } = useStrategySimulation(appId);
  const { data: evidence = [] } = useStrategicEvidence(appId);
  const { data: marketData } = useMarketOptions(appId);
  const marketOptions = marketData?.options ?? [];
  const scenarios = data?.scenarios ?? [];
  const allBranches = data?.branches ?? [];
  const allSensitivities = data?.sensitivities ?? [];

  const createScenario = useCreateStrategicScenario();
  const createBranch = useCreateScenarioBranch();
  const createSensitivity = useCreateSensitivityTest();
  const updateScenario = useUpdateStrategicScenario();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0];

  useEffect(() => {
    if (!selectedId && scenarios[0]) setSelectedId(scenarios[0].id);
    if (selectedId && !scenarios.some((scenario) => scenario.id === selectedId)) setSelectedId(scenarios[0]?.id);
  }, [scenarios, selectedId]);

  const branches = useMemo(
    () => allBranches.filter((branch) => branch.scenario_id === selected?.id),
    [allBranches, selected?.id]
  );
  const sensitivities = useMemo(
    () => allSensitivities.filter((test) => test.scenario_id === selected?.id),
    [allSensitivities, selected?.id]
  );

  const observedEvidence = evidence.filter(
    (item) => item.item_type === "observation" && !["invalidated", "resolved", "superseded"].includes(item.status)
  );

  const assessedBranches = branches.filter((branch) => branch.decision_effect !== "unknown");
  const holdCount = assessedBranches.filter((branch) => branch.decision_effect === "holds").length;
  const changeCount = assessedBranches.filter((branch) => branch.decision_effect === "changes").length;
  const historicalBranches = branches.filter((branch) => branch.likelihood_basis === "observed_frequency").length;
  const highestStress = branches
    .filter((branch) => branch.stress_score !== null)
    .sort((a, b) => Number(b.stress_score) - Number(a.stress_score))[0];

  const branchMap = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const depthOf = (branch: StrategicScenarioBranch) => {
    let depth = 0;
    let parent = branch.parent_branch_id ? branchMap.get(branch.parent_branch_id) : undefined;
    const visited = new Set<string>();
    while (parent && depth < 6 && !visited.has(parent.id)) {
      visited.add(parent.id);
      depth += 1;
      parent = parent.parent_branch_id ? branchMap.get(parent.parent_branch_id) : undefined;
    }
    return depth;
  };

  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [scenarioTitle, setScenarioTitle] = useState("");
  const [scenarioDescription, setScenarioDescription] = useState("");
  const [baseMove, setBaseMove] = useState("");
  const [decisionQuestion, setDecisionQuestion] = useState("");
  const [timeHorizon, setTimeHorizon] = useState("");
  const [scenarioGoalId, setScenarioGoalId] = useState("none");
  const [scenarioDecisionId, setScenarioDecisionId] = useState("none");
  const [scenarioMarketId, setScenarioMarketId] = useState("none");

  const [branchOpen, setBranchOpen] = useState(false);
  const [parentBranchId, setParentBranchId] = useState("root");
  const [actorType, setActorType] = useState<ScenarioActorType>("market");
  const [actorName, setActorName] = useState("");
  const [eventType, setEventType] = useState("other");
  const [eventDescription, setEventDescription] = useState("");
  const [likelihoodBasis, setLikelihoodBasis] = useState<LikelihoodBasis>("unknown");
  const [manualLikelihood, setManualLikelihood] = useState("");
  const [responseCount, setResponseCount] = useState("");
  const [comparableCount, setComparableCount] = useState("");
  const [branchEvidenceId, setBranchEvidenceId] = useState("none");
  const [impactScore, setImpactScore] = useState("0");
  const [decisionEffect, setDecisionEffect] = useState<DecisionEffect>("unknown");
  const [responseMove, setResponseMove] = useState("");
  const [responseReversibility, setResponseReversibility] = useState<CommitmentClass>("reversible");
  const [branchNotes, setBranchNotes] = useState("");

  const [sensitivityOpen, setSensitivityOpen] = useState(false);
  const [variableName, setVariableName] = useState("");
  const [variableUnit, setVariableUnit] = useState("");
  const [lowValue, setLowValue] = useState("");
  const [baseValue, setBaseValue] = useState("");
  const [highValue, setHighValue] = useState("");
  const [outcomeMetric, setOutcomeMetric] = useState("");
  const [outcomeUnit, setOutcomeUnit] = useState("");
  const [lowOutcome, setLowOutcome] = useState("");
  const [baseOutcome, setBaseOutcome] = useState("");
  const [highOutcome, setHighOutcome] = useState("");
  const [sensitivityBasis, setSensitivityBasis] = useState<SensitivityEvidenceBasis>("assumption");
  const [sensitivityEvidenceId, setSensitivityEvidenceId] = useState("none");
  const [sensitivityNotes, setSensitivityNotes] = useState("");

  const [conclusion, setConclusion] = useState("");
  useEffect(() => setConclusion(selected?.conclusion ?? ""), [selected?.id, selected?.conclusion]);

  const submitScenario = async () => {
    if (!appId || !scenarioTitle.trim() || !baseMove.trim()) return;
    const created = await createScenario.mutateAsync({
      app_id: appId,
      goal_id: scenarioGoalId === "none" ? undefined : scenarioGoalId,
      decision_id: scenarioDecisionId === "none" ? undefined : scenarioDecisionId,
      market_option_id: scenarioMarketId === "none" ? undefined : scenarioMarketId,
      title: scenarioTitle.trim(),
      description: scenarioDescription.trim() || undefined,
      base_move: baseMove.trim(),
      decision_question: decisionQuestion.trim() || undefined,
      time_horizon: timeHorizon.trim() || undefined,
      status: "active",
    });
    setSelectedId(created.id);
    setScenarioOpen(false);
    setScenarioTitle(""); setScenarioDescription(""); setBaseMove(""); setDecisionQuestion(""); setTimeHorizon("");
    setScenarioGoalId("none"); setScenarioDecisionId("none"); setScenarioMarketId("none");
  };

  const submitBranch = async () => {
    if (!selected || !eventDescription.trim()) return;
    if (likelihoodBasis === "manual_assumption" && optionalNumber(manualLikelihood) === undefined) return;
    if (likelihoodBasis === "observed_frequency" && (branchEvidenceId === "none" || optionalNumber(responseCount) === undefined || optionalNumber(comparableCount) === undefined)) return;
    await createBranch.mutateAsync({
      scenario_id: selected.id,
      parent_branch_id: parentBranchId === "root" ? undefined : parentBranchId,
      evidence_item_id: branchEvidenceId === "none" ? undefined : branchEvidenceId,
      actor_type: actorType,
      actor_name: actorName.trim() || undefined,
      event_type: eventType.trim() || "other",
      event_description: eventDescription.trim(),
      likelihood_basis: likelihoodBasis,
      likelihood_pct: likelihoodBasis === "manual_assumption" ? optionalNumber(manualLikelihood) : undefined,
      observed_response_count: likelihoodBasis === "observed_frequency" ? optionalNumber(responseCount) : undefined,
      comparable_event_count: likelihoodBasis === "observed_frequency" ? optionalNumber(comparableCount) : undefined,
      impact_score: Math.max(-100, Math.min(100, optionalNumber(impactScore) ?? 0)),
      decision_effect: decisionEffect,
      response_move: responseMove.trim() || undefined,
      response_reversibility: responseReversibility,
      notes: branchNotes.trim() || undefined,
    });
    setBranchOpen(false);
    setParentBranchId("root"); setActorType("market"); setActorName(""); setEventType("other"); setEventDescription("");
    setLikelihoodBasis("unknown"); setManualLikelihood(""); setResponseCount(""); setComparableCount(""); setBranchEvidenceId("none");
    setImpactScore("0"); setDecisionEffect("unknown"); setResponseMove(""); setResponseReversibility("reversible"); setBranchNotes("");
  };

  const submitSensitivity = async () => {
    if (!selected || !variableName.trim() || !outcomeMetric.trim()) return;
    await createSensitivity.mutateAsync({
      scenario_id: selected.id,
      evidence_item_id: sensitivityEvidenceId === "none" ? undefined : sensitivityEvidenceId,
      variable_name: variableName.trim(),
      variable_unit: variableUnit.trim() || undefined,
      low_value: optionalNumber(lowValue),
      base_value: optionalNumber(baseValue),
      high_value: optionalNumber(highValue),
      outcome_metric: outcomeMetric.trim(),
      outcome_unit: outcomeUnit.trim() || undefined,
      low_outcome: optionalNumber(lowOutcome),
      base_outcome: optionalNumber(baseOutcome),
      high_outcome: optionalNumber(highOutcome),
      evidence_basis: sensitivityBasis,
      notes: sensitivityNotes.trim() || undefined,
    });
    setSensitivityOpen(false);
    setVariableName(""); setVariableUnit(""); setLowValue(""); setBaseValue(""); setHighValue("");
    setOutcomeMetric(""); setOutcomeUnit(""); setLowOutcome(""); setBaseOutcome(""); setHighOutcome("");
    setSensitivityBasis("assumption"); setSensitivityEvidenceId("none"); setSensitivityNotes("");
  };

  const saveConclusion = async () => {
    if (!selected) return;
    await updateScenario.mutateAsync({ id: selected.id, patch: { conclusion: conclusion.trim() || null, status: conclusion.trim() ? "completed" : selected.status } });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><BrainCircuit className="h-5 w-5 text-primary" /><h2 className="font-display text-lg font-semibold">Scenario Lab</h2></div>
          <p className="mt-1 text-xs text-muted-foreground">Stress-test a move across plausible futures. Unknown likelihood stays unknown; historical frequency requires observation evidence.</p>
        </div>
        <Dialog open={scenarioOpen} onOpenChange={setScenarioOpen}>
          <DialogTrigger asChild><Button size="sm" disabled={!appId}><Plus className="mr-2 h-4 w-4" />Scenario</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Create strategic scenario</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Scenario title</Label><Input value={scenarioTitle} onChange={(e) => setScenarioTitle(e.target.value)} placeholder="Poland entry under competitor response" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Base move</Label><Textarea value={baseMove} onChange={(e) => setBaseMove(e.target.value)} placeholder="Run a 90-day partner-led market validation before fixed local investment." /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Decision question</Label><Input value={decisionQuestion} onChange={(e) => setDecisionQuestion(e.target.value)} placeholder="Would this move still hold if demand weakens or a competitor cuts price?" /></div>
              <div className="space-y-2"><Label>Objective</Label><Select value={scenarioGoalId} onValueChange={setScenarioGoalId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No objective</SelectItem>{objectives.map((item) => <SelectItem key={item.id} value={item.id}>{item.objective_name || item.goal_type}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Decision</Label><Select value={scenarioDecisionId} onValueChange={setScenarioDecisionId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No decision</SelectItem>{decisions.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Market option</Label><Select value={scenarioMarketId} onValueChange={setScenarioMarketId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No market option</SelectItem>{marketOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.market_name}{item.segment_name ? ` · ${item.segment_name}` : ""}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Time horizon</Label><Input value={timeHorizon} onChange={(e) => setTimeHorizon(e.target.value)} placeholder="90 days" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Description</Label><Textarea value={scenarioDescription} onChange={(e) => setScenarioDescription(e.target.value)} placeholder="Scope and constraints. Do not add facts that are not established." /></div>
            </div>
            <DialogFooter><Button onClick={submitScenario} disabled={!scenarioTitle.trim() || !baseMove.trim() || createScenario.isPending}>{createScenario.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create scenario</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <Card className="p-6 text-sm text-muted-foreground">Loading scenarios…</Card> : scenarios.length === 0 ? (
        <Card className="border-dashed p-8 text-center"><ShieldQuestion className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">No scenario yet</p><p className="mt-1 text-sm text-muted-foreground">Create a base move, then add plausible events and countermoves without inventing probabilities.</p></Card>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">{scenarios.map((scenario) => <Button key={scenario.id} size="sm" variant={selected?.id === scenario.id ? "default" : "outline"} onClick={() => setSelectedId(scenario.id)} className="shrink-0">{scenario.title}</Button>)}</div>

          {selected && <Card>
            <CardHeader className="p-4 pb-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{selected.title}</CardTitle><p className="mt-1 text-xs text-muted-foreground">Base move: {selected.base_move}</p>{selected.decision_question && <p className="mt-1 text-xs"><span className="font-semibold">Decision question:</span> {selected.decision_question}</p>}</div><Badge variant="outline" className="capitalize">{selected.status}</Badge></div></CardHeader>
            <CardContent className="space-y-4 p-4 pt-2">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md bg-muted/50 p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Branches</p><p className="mt-1 text-xl font-bold">{branches.length}</p></div>
                <div className="rounded-md bg-muted/50 p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Decision holds</p><p className="mt-1 text-xl font-bold">{assessedBranches.length ? `${holdCount}/${assessedBranches.length}` : "—"}</p><p className="text-[10px] text-muted-foreground">Across assessed branches, not probability-weighted</p></div>
                <div className="rounded-md bg-muted/50 p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Decision changes</p><p className="mt-1 text-xl font-bold">{assessedBranches.length ? `${changeCount}/${assessedBranches.length}` : "—"}</p></div>
                <div className="rounded-md bg-muted/50 p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">History-backed</p><p className="mt-1 text-xl font-bold">{historicalBranches}</p><p className="text-[10px] text-muted-foreground">Branches using observed-frequency evidence</p></div>
              </div>

              {highestStress && <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs"><span className="font-semibold">Highest recorded stress:</span> {highestStress.event_description} · {Number(highestStress.stress_score).toFixed(0)}/100. Stress is likelihood × absolute impact, not expected loss.</div>}

              <div className="flex flex-wrap gap-2">
                <Dialog open={branchOpen} onOpenChange={setBranchOpen}>
                  <DialogTrigger asChild><Button size="sm"><GitBranch className="mr-2 h-4 w-4" />Add branch / countermove</Button></DialogTrigger>
                  <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                    <DialogHeader><DialogTitle>Add plausible branch</DialogTitle></DialogHeader>
                    <div className="grid gap-4 py-2 sm:grid-cols-2">
                      <div className="space-y-2"><Label>Parent branch</Label><Select value={parentBranchId} onValueChange={setParentBranchId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="root">Root: follows base move</SelectItem>{branches.map((item) => <SelectItem key={item.id} value={item.id}>{item.event_description.slice(0, 70)}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-2"><Label>Actor</Label><Select value={actorType} onValueChange={(value) => setActorType(value as ScenarioActorType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{actorTypes.map((type) => <SelectItem key={type} value={type} className="capitalize">{type}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-2"><Label>Actor name</Label><Input value={actorName} onChange={(e) => setActorName(e.target.value)} placeholder="Competitor A, regulator, partner…" /></div>
                      <div className="space-y-2"><Label>Event type</Label><Input value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="price_cut, partner_exit, demand_drop…" /></div>
                      <div className="space-y-2 sm:col-span-2"><Label>Event / move</Label><Textarea value={eventDescription} onChange={(e) => setEventDescription(e.target.value)} placeholder="Competitor reduces entry-tier pricing by 20%." /></div>
                      <div className="space-y-2"><Label>Likelihood basis</Label><Select value={likelihoodBasis} onValueChange={(value) => setLikelihoodBasis(value as LikelihoodBasis)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{likelihoodBases.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
                      {likelihoodBasis === "manual_assumption" && <div className="space-y-2"><Label>Assumed likelihood (%)</Label><Input type="number" min={0} max={100} value={manualLikelihood} onChange={(e) => setManualLikelihood(e.target.value)} /></div>}
                      {likelihoodBasis === "observed_frequency" && <><div className="space-y-2"><Label>Observed response count</Label><Input type="number" min={0} value={responseCount} onChange={(e) => setResponseCount(e.target.value)} /></div><div className="space-y-2"><Label>Comparable event count</Label><Input type="number" min={1} value={comparableCount} onChange={(e) => setComparableCount(e.target.value)} /></div><div className="space-y-2 sm:col-span-2"><Label>Required observation evidence</Label><Select value={branchEvidenceId} onValueChange={setBranchEvidenceId}><SelectTrigger><SelectValue placeholder="Select observation" /></SelectTrigger><SelectContent><SelectItem value="none">Select an observation</SelectItem>{observedEvidence.map((item) => <SelectItem key={item.id} value={item.id}>{item.claim.slice(0, 100)}</SelectItem>)}</SelectContent></Select><p className="text-[10px] text-muted-foreground">Historical frequency is descriptive. It does not guarantee the same future response.</p></div></>}
                      <div className="space-y-2"><Label>Impact (-100 to +100)</Label><Input type="number" min={-100} max={100} value={impactScore} onChange={(e) => setImpactScore(e.target.value)} /><p className="text-[10px] text-muted-foreground">Negative harms the objective; positive helps.</p></div>
                      <div className="space-y-2"><Label>Does current decision hold?</Label><Select value={decisionEffect} onValueChange={(value) => setDecisionEffect(value as DecisionEffect)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="holds">Holds</SelectItem><SelectItem value="changes">Changes</SelectItem></SelectContent></Select></div>
                      <div className="space-y-2 sm:col-span-2"><Label>Planned response / countermove</Label><Textarea value={responseMove} onChange={(e) => setResponseMove(e.target.value)} placeholder="Keep flagship price; test a segmented starter offer instead." /></div>
                      <div className="space-y-2"><Label>Response reversibility</Label><Select value={responseReversibility} onValueChange={(value) => setResponseReversibility(value as CommitmentClass)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{commitmentOptions.map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-2"><Label>Notes</Label><Input value={branchNotes} onChange={(e) => setBranchNotes(e.target.value)} /></div>
                    </div>
                    <DialogFooter><Button onClick={submitBranch} disabled={!eventDescription.trim() || createBranch.isPending}>{createBranch.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add branch</Button></DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={sensitivityOpen} onOpenChange={setSensitivityOpen}>
                  <DialogTrigger asChild><Button size="sm" variant="outline"><Beaker className="mr-2 h-4 w-4" />Sensitivity</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Record low / base / high sensitivity</DialogTitle></DialogHeader>
                    <div className="grid gap-4 py-2 sm:grid-cols-2">
                      <div className="space-y-2"><Label>Variable</Label><Input value={variableName} onChange={(e) => setVariableName(e.target.value)} placeholder="CAC" /></div>
                      <div className="space-y-2"><Label>Variable unit</Label><Input value={variableUnit} onChange={(e) => setVariableUnit(e.target.value)} placeholder="EUR" /></div>
                      <div className="grid grid-cols-3 gap-2 sm:col-span-2"><div className="space-y-1"><Label>Low</Label><Input type="number" value={lowValue} onChange={(e) => setLowValue(e.target.value)} /></div><div className="space-y-1"><Label>Base</Label><Input type="number" value={baseValue} onChange={(e) => setBaseValue(e.target.value)} /></div><div className="space-y-1"><Label>High</Label><Input type="number" value={highValue} onChange={(e) => setHighValue(e.target.value)} /></div></div>
                      <div className="space-y-2"><Label>Outcome metric</Label><Input value={outcomeMetric} onChange={(e) => setOutcomeMetric(e.target.value)} placeholder="Contribution margin" /></div>
                      <div className="space-y-2"><Label>Outcome unit</Label><Input value={outcomeUnit} onChange={(e) => setOutcomeUnit(e.target.value)} placeholder="%" /></div>
                      <div className="grid grid-cols-3 gap-2 sm:col-span-2"><div className="space-y-1"><Label>Low outcome</Label><Input type="number" value={lowOutcome} onChange={(e) => setLowOutcome(e.target.value)} /></div><div className="space-y-1"><Label>Base outcome</Label><Input type="number" value={baseOutcome} onChange={(e) => setBaseOutcome(e.target.value)} /></div><div className="space-y-1"><Label>High outcome</Label><Input type="number" value={highOutcome} onChange={(e) => setHighOutcome(e.target.value)} /></div></div>
                      <div className="space-y-2"><Label>Evidence basis</Label><Select value={sensitivityBasis} onValueChange={(value) => setSensitivityBasis(value as SensitivityEvidenceBasis)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="observation">Observation</SelectItem><SelectItem value="experiment">Experiment</SelectItem><SelectItem value="assumption">Assumption</SelectItem><SelectItem value="model">Model</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                      <div className="space-y-2"><Label>Linked evidence (optional)</Label><Select value={sensitivityEvidenceId} onValueChange={setSensitivityEvidenceId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No evidence link</SelectItem>{evidence.map((item) => <SelectItem key={item.id} value={item.id}>{item.claim.slice(0, 90)}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-2 sm:col-span-2"><Label>Notes</Label><Textarea value={sensitivityNotes} onChange={(e) => setSensitivityNotes(e.target.value)} placeholder="Explain the source or assumption behind the range." /></div>
                    </div>
                    <DialogFooter><Button onClick={submitSensitivity} disabled={!variableName.trim() || !outcomeMetric.trim() || createSensitivity.isPending}>{createSensitivity.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record sensitivity</Button></DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Move / countermove tree</h3><span className="text-[10px] text-muted-foreground">{branches.length} branches</span></div>
                {branches.length === 0 ? <div className="rounded-md border border-dashed p-5 text-center text-xs text-muted-foreground">Add a plausible event. Leave likelihood unknown unless you have a stated assumption or observation-backed historical frequency.</div> : branches.map((branch) => {
                  const depth = depthOf(branch);
                  return <div key={branch.id} className="rounded-md border p-3" style={{ marginLeft: `${Math.min(depth, 4) * 16}px` }}>
                    <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2"><Badge variant="secondary" className="capitalize">{branch.actor_type}</Badge>{branch.actor_name && <span className="text-xs font-semibold">{branch.actor_name}</span>}{depth > 0 && <Badge variant="outline" className="text-[10px]">countermove depth {depth}</Badge>}</div><p className="mt-2 text-sm font-medium">{branch.event_description}</p></div><Badge variant="outline" className={stressTone(branch.stress_score)}>Stress {branch.stress_score === null ? "—" : Number(branch.stress_score).toFixed(0)}</Badge></div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>{likelihoodLabel(branch)}</span><span>•</span><span>impact {branch.impact_score > 0 ? "+" : ""}{branch.impact_score}</span><span>•</span><span>decision {branch.decision_effect}</span>{branch.evidence_item_id && <><span>•</span><span className="flex items-center gap-1"><History className="h-3 w-3" />observation linked</span></>}</div>
                    {branch.response_move && <div className="mt-2 flex items-start gap-2 rounded bg-muted/50 p-2 text-xs"><ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><span className="font-semibold">Response:</span> {branch.response_move} <span className="text-muted-foreground">({branch.response_reversibility.replaceAll("_", " ")})</span></span></div>}
                  </div>;
                })}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Sensitivity cases</h3>
                {sensitivities.length === 0 ? <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">No low/base/high sensitivity cases recorded.</div> : <div className="grid gap-2 lg:grid-cols-2">{sensitivities.map((test) => <div key={test.id} className="rounded-md border p-3 text-xs"><div className="flex items-center justify-between"><span className="font-semibold">{test.variable_name}</span><Badge variant="outline" className="capitalize">{test.evidence_basis}</Badge></div><p className="mt-2 text-muted-foreground">Variable: {test.low_value ?? "—"} / {test.base_value ?? "—"} / {test.high_value ?? "—"} {test.variable_unit ?? ""}</p><p>Outcome — {test.outcome_metric}: {test.low_outcome ?? "—"} / {test.base_outcome ?? "—"} / {test.high_outcome ?? "—"} {test.outcome_unit ?? ""}</p></div>)}</div>}
              </div>

              <div className="space-y-2 border-t pt-3"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Scenario conclusion</h3></div><Textarea value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="What survives the stress test? What changes? What evidence is still missing?" /><div className="flex justify-end"><Button size="sm" variant="outline" onClick={saveConclusion} disabled={updateScenario.isPending}><Save className="mr-2 h-3.5 w-3.5" />Save conclusion</Button></div></div>
            </CardContent>
          </Card>}
        </>
      )}

      <p className="text-[11px] text-muted-foreground">Observed frequency is descriptive history, not a guaranteed future probability. Manual likelihood is displayed as an assumption. Unknown likelihood remains blank and receives no stress score.</p>
    </section>
  );
}
