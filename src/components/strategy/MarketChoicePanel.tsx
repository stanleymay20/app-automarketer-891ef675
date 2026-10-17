import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Compass,
  Edit3,
  FlaskConical,
  Loader2,
  MapPinned,
  Plus,
  Route,
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
import type { StrategicDecision, StrategicObjective, CommitmentClass } from "@/hooks/useStrategy";
import { useCreateStrategicDecision } from "@/hooks/useStrategy";
import {
  EntryMode,
  MarketOptionInput,
  StrategicMarketOption,
  TimingPosture,
  useCreateMarketOption,
  useMarketOptions,
  useUpdateMarketOption,
} from "@/hooks/useMarketChoice";

interface Props {
  appId?: string;
  objectives: StrategicObjective[];
  decisions: StrategicDecision[];
}

type ScoreKey =
  | "demand_score"
  | "growth_score"
  | "customer_value_score"
  | "strategic_fit_score"
  | "accessibility_score"
  | "distribution_readiness_score"
  | "competition_intensity_score"
  | "regulatory_risk_score"
  | "pioneering_cost_score"
  | "capital_intensity_score";

const scoreFields: { key: ScoreKey; label: string; helper: string; risk?: boolean }[] = [
  { key: "demand_score", label: "Demand", helper: "Observed/validated demand strength" },
  { key: "growth_score", label: "Growth", helper: "Market/segment growth evidence" },
  { key: "customer_value_score", label: "Customer value", helper: "Expected customer value fit" },
  { key: "strategic_fit_score", label: "Strategic fit", helper: "Fit with company capabilities" },
  { key: "accessibility_score", label: "Accessibility", helper: "Ability to reach and serve buyers" },
  { key: "distribution_readiness_score", label: "Distribution readiness", helper: "Route-to-market readiness" },
  { key: "competition_intensity_score", label: "Competition intensity", helper: "Higher means harder", risk: true },
  { key: "regulatory_risk_score", label: "Regulatory risk", helper: "Higher means riskier", risk: true },
  { key: "pioneering_cost_score", label: "Pioneering cost", helper: "Higher means costlier to educate/build", risk: true },
  { key: "capital_intensity_score", label: "Capital intensity", helper: "Higher means more capital required", risk: true },
];

const entryModes: { value: EntryMode; label: string }[] = [
  { value: "unknown", label: "Unknown" },
  { value: "digital_direct", label: "Digital direct" },
  { value: "export", label: "Export" },
  { value: "partner", label: "Local partner" },
  { value: "license", label: "License" },
  { value: "franchise", label: "Franchise" },
  { value: "joint_venture", label: "Joint venture" },
  { value: "owned_operation", label: "Owned operation" },
  { value: "other", label: "Other" },
];

const timingLabels: Record<TimingPosture, string> = {
  unknown: "Unknown",
  first_mover: "First mover",
  fast_follower: "Fast follower",
  wait: "Wait",
};

const commitmentLabels: Record<CommitmentClass, string> = {
  reversible: "Reversible",
  partly_reversible: "Partly reversible",
  hard_to_reverse: "Hard to reverse",
};

function blankScores(): Record<ScoreKey, string> {
  return Object.fromEntries(scoreFields.map((field) => [field.key, ""])) as Record<ScoreKey, string>;
}

function optionalScore(value: string) {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(100, Math.max(0, parsed));
}

function formatScore(value: number | null) {
  return value === null ? "—" : `${Math.round(Number(value))}`;
}

function readinessTone(value: number | null) {
  if (value === null) return "bg-muted text-muted-foreground";
  if (value >= 55) return "bg-success/10 text-success border-success/20";
  if (value >= 30) return "bg-warning/10 text-warning border-warning/20";
  return "bg-muted text-muted-foreground";
}

export function MarketChoicePanel({ appId, objectives, decisions }: Props) {
  const { data, isLoading } = useMarketOptions(appId);
  const options = data?.options ?? [];
  const distribution = data?.distribution;
  const createOption = useCreateMarketOption();
  const updateOption = useUpdateMarketOption();
  const createDecision = useCreateStrategicDecision();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StrategicMarketOption | null>(null);
  const [marketName, setMarketName] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [goalId, setGoalId] = useState("none");
  const [unmetNeed, setUnmetNeed] = useState("");
  const [competitorGap, setCompetitorGap] = useState("");
  const [whiteSpaceHypothesis, setWhiteSpaceHypothesis] = useState("");
  const [routeToMarket, setRouteToMarket] = useState("");
  const [distributionConstraints, setDistributionConstraints] = useState("");
  const [entryMode, setEntryMode] = useState<EntryMode>("unknown");
  const [timingPosture, setTimingPosture] = useState<TimingPosture>("unknown");
  const [commitmentClass, setCommitmentClass] = useState<CommitmentClass>("reversible");
  const [commitmentAmount, setCommitmentAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [evidenceConfidence, setEvidenceConfidence] = useState("");
  const [nextTest, setNextTest] = useState("");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [scores, setScores] = useState<Record<ScoreKey, string>>(blankScores);

  const topReady = useMemo(
    () => options.find((option) => option.decision_readiness_score !== null) ?? null,
    [options]
  );

  const resetForm = () => {
    setEditing(null);
    setMarketName("");
    setSegmentName("");
    setGoalId("none");
    setUnmetNeed("");
    setCompetitorGap("");
    setWhiteSpaceHypothesis("");
    setRouteToMarket("");
    setDistributionConstraints("");
    setEntryMode("unknown");
    setTimingPosture("unknown");
    setCommitmentClass("reversible");
    setCommitmentAmount("");
    setCurrency("EUR");
    setEvidenceConfidence("");
    setNextTest("");
    setEvidenceNotes("");
    setScores(blankScores());
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (option: StrategicMarketOption) => {
    setEditing(option);
    setMarketName(option.market_name);
    setSegmentName(option.segment_name ?? "");
    setGoalId(option.goal_id ?? "none");
    setUnmetNeed(option.unmet_need ?? "");
    setCompetitorGap(option.competitor_gap ?? "");
    setWhiteSpaceHypothesis(option.white_space_hypothesis ?? "");
    setRouteToMarket(option.route_to_market ?? "");
    setDistributionConstraints(option.distribution_constraints ?? "");
    setEntryMode(option.entry_mode);
    setTimingPosture(option.timing_posture);
    setCommitmentClass(option.commitment_class);
    setCommitmentAmount(option.estimated_commitment_amount === null ? "" : String(option.estimated_commitment_amount));
    setCurrency(option.currency);
    setEvidenceConfidence(option.evidence_confidence === null ? "" : String(option.evidence_confidence));
    setNextTest(option.next_test ?? "");
    setEvidenceNotes(option.evidence_notes ?? "");
    setScores(Object.fromEntries(scoreFields.map((field) => [field.key, option[field.key] === null ? "" : String(option[field.key])])) as Record<ScoreKey, string>);
    setDialogOpen(true);
  };

  const buildInput = (): MarketOptionInput | null => {
    if (!appId || !marketName.trim()) return null;
    const parsedCommitment = commitmentAmount.trim() === "" ? undefined : Number(commitmentAmount);
    const input: MarketOptionInput = {
      app_id: appId,
      goal_id: goalId === "none" ? undefined : goalId,
      market_name: marketName.trim(),
      segment_name: segmentName.trim() || undefined,
      unmet_need: unmetNeed.trim() || undefined,
      competitor_gap: competitorGap.trim() || undefined,
      white_space_hypothesis: whiteSpaceHypothesis.trim() || undefined,
      route_to_market: routeToMarket.trim() || undefined,
      distribution_constraints: distributionConstraints.trim() || undefined,
      entry_mode: entryMode,
      timing_posture: timingPosture,
      commitment_class: commitmentClass,
      estimated_commitment_amount: Number.isFinite(parsedCommitment) ? parsedCommitment : undefined,
      currency: currency.trim().toUpperCase() || "EUR",
      evidence_confidence: optionalScore(evidenceConfidence),
      next_test: nextTest.trim() || undefined,
      evidence_notes: evidenceNotes.trim() || undefined,
    };
    for (const field of scoreFields) input[field.key] = optionalScore(scores[field.key]);
    return input;
  };

  const submit = async () => {
    const input = buildInput();
    if (!input) return;
    if (editing) await updateOption.mutateAsync({ id: editing.id, patch: input });
    else await createOption.mutateAsync(input);
    setDialogOpen(false);
    resetForm();
  };

  const missingFactors = (option: StrategicMarketOption) =>
    scoreFields.filter((field) => option[field.key] === null).map((field) => field.label);

  const proposeValidation = async (option: StrategicMarketOption) => {
    if (!appId) return;
    const missing = missingFactors(option);
    const place = option.segment_name ? `${option.market_name} / ${option.segment_name}` : option.market_name;
    await createDecision.mutateAsync({
      app_id: appId,
      goal_id: option.goal_id ?? undefined,
      market_option_id: option.id,
      decision_type: "test",
      title: `Validate ${place} before increasing commitment`,
      recommendation: option.next_test?.trim() || `Run a reversible validation test in ${place} before making a larger market-entry commitment.`,
      rationale: `Current market attractiveness is ${option.attractiveness_score === null ? "not yet scoreable" : `${Number(option.attractiveness_score).toFixed(1)}/100`}; evidence coverage is ${option.evidence_coverage}%${option.evidence_confidence === null ? " and evidence confidence is not yet recorded" : ` with ${option.evidence_confidence}% evidence confidence`}. Treat these scores as prioritisation aids, not financial forecasts.`,
      confidence: option.evidence_confidence ?? undefined,
      reversibility: "reversible",
      authority_level: "recommend",
      next_information_needed: missing.length
        ? `Resolve missing market evidence for: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}`
        : "Observe the validation result before increasing commitment.",
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Market choice & white space</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Rank markets with explicit evidence coverage. Unknown factors stay unknown; high scores never substitute for proof.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild><Button size="sm" onClick={openCreate} disabled={!appId}><Plus className="mr-2 h-4 w-4" />Market option</Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader><DialogTitle>{editing ? "Update market assessment" : "Assess a market / segment"}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2"><Label>Market</Label><Input value={marketName} onChange={(e) => setMarketName(e.target.value)} placeholder="Poland" /></div>
              <div className="space-y-2"><Label>Segment</Label><Input value={segmentName} onChange={(e) => setSegmentName(e.target.value)} placeholder="Urban SME fleet buyers" /></div>
              <div className="space-y-2"><Label>Linked objective</Label><Select value={goalId} onValueChange={setGoalId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No objective</SelectItem>{objectives.map((objective) => <SelectItem key={objective.id} value={objective.id}>{objective.objective_name || objective.goal_type}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Evidence confidence (%)</Label><Input type="number" min={0} max={100} value={evidenceConfidence} onChange={(e) => setEvidenceConfidence(e.target.value)} placeholder="Unknown" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Unmet need — evidence, not assumption</Label><Textarea value={unmetNeed} onChange={(e) => setUnmetNeed(e.target.value)} placeholder="Leave blank if not established." /></div>
              <div className="space-y-2"><Label>Competitor gap</Label><Textarea value={competitorGap} onChange={(e) => setCompetitorGap(e.target.value)} placeholder="Observed weakness or blank if unknown." /></div>
              <div className="space-y-2"><Label>White-space hypothesis</Label><Textarea value={whiteSpaceHypothesis} onChange={(e) => setWhiteSpaceHypothesis(e.target.value)} placeholder="Hypothesis only; do not state as fact without evidence." /></div>
              <div className="space-y-2"><Label>Route to market</Label><Textarea value={routeToMarket} onChange={(e) => setRouteToMarket(e.target.value)} placeholder="Direct, distributor, marketplace, partner…" /></div>
              <div className="space-y-2"><Label>Distribution constraints</Label><Textarea value={distributionConstraints} onChange={(e) => setDistributionConstraints(e.target.value)} placeholder="Known access, channel, logistics or sales constraints." /></div>
              <div className="space-y-2"><Label>Entry mode</Label><Select value={entryMode} onValueChange={(value) => setEntryMode(value as EntryMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{entryModes.map((mode) => <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Timing posture</Label><Select value={timingPosture} onValueChange={(value) => setTimingPosture(value as TimingPosture)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="first_mover">First mover</SelectItem><SelectItem value="fast_follower">Fast follower</SelectItem><SelectItem value="wait">Wait</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Commitment class</Label><Select value={commitmentClass} onValueChange={(value) => setCommitmentClass(value as CommitmentClass)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reversible">Reversible</SelectItem><SelectItem value="partly_reversible">Partly reversible</SelectItem><SelectItem value="hard_to_reverse">Hard to reverse</SelectItem></SelectContent></Select></div>
              <div className="grid grid-cols-[1fr_90px] gap-2"><div className="space-y-2"><Label>Estimated commitment</Label><Input type="number" min={0} value={commitmentAmount} onChange={(e) => setCommitmentAmount(e.target.value)} placeholder="Unknown" /></div><div className="space-y-2"><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} /></div></div>
            </div>

            <div className="mt-2 border-t pt-4">
              <div className="mb-3">
                <p className="text-sm font-semibold">Factor evidence</p>
                <p className="text-xs text-muted-foreground">0–100. Leave blank when the factor is unknown. Risk factors are inverted only for attractiveness scoring.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {scoreFields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs">{field.label}{field.risk ? " ↓" : " ↑"}</Label>
                    <Input type="number" min={0} max={100} value={scores[field.key]} onChange={(e) => setScores((current) => ({ ...current, [field.key]: e.target.value }))} placeholder="Unknown" />
                    <p className="text-[10px] text-muted-foreground">{field.helper}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2 grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Next reversible test</Label><Textarea value={nextTest} onChange={(e) => setNextTest(e.target.value)} placeholder="Smallest experiment that would reduce uncertainty." /></div>
              <div className="space-y-2"><Label>Evidence notes / provenance</Label><Textarea value={evidenceNotes} onChange={(e) => setEvidenceNotes(e.target.value)} placeholder="Datasets, interviews, reports, experiments, dates or evidence IDs." /></div>
            </div>
            <DialogFooter><Button onClick={submit} disabled={!marketName.trim() || createOption.isPending || updateOption.isPending}>{(createOption.isPending || updateOption.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Update assessment" : "Record assessment"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Markets assessed</p><p className="mt-1 font-display text-xl font-bold">{options.length}</p><p className="mt-1 text-[11px] text-muted-foreground">Market/segment options in this strategy</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Top readiness</p><p className="mt-1 font-display text-xl font-bold">{topReady?.decision_readiness_score === null || !topReady ? "—" : Number(topReady.decision_readiness_score).toFixed(0)}</p><p className="mt-1 text-[11px] text-muted-foreground">Conservative evidence-adjusted proxy</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Distribution targets</p><p className="mt-1 font-display text-xl font-bold">{distribution?.total_targets ?? 0}</p><p className="mt-1 text-[11px] text-muted-foreground">Existing app-level route-to-market evidence</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Distribution score</p><p className="mt-1 font-display text-xl font-bold">{distribution?.average_distribution_score ?? "—"}</p><p className="mt-1 text-[11px] text-muted-foreground">App-wide only; not proof for a specific country</p></CardContent></Card>
      </div>

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading market assessments…</Card>
      ) : options.length === 0 ? (
        <Card className="border-dashed p-8 text-center"><MapPinned className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">No market options assessed</p><p className="mt-1 text-sm text-muted-foreground">Add candidate markets without forcing unknown factors into fake scores.</p></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {options.map((option, index) => {
            const missing = missingFactors(option);
            const linkedDecision = decisions.find((decision) => decision.market_option_id === option.id && !["rejected", "cancelled"].includes(decision.status));
            return (
              <Card key={option.id} className="overflow-hidden">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">{index + 1}. {option.market_name}{option.segment_name ? ` · ${option.segment_name}` : ""}</CardTitle><Badge variant="outline" className="capitalize">{option.status}</Badge></div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="outline">Attractiveness {formatScore(option.attractiveness_score)}</Badge>
                        <Badge variant="outline" className={readinessTone(option.decision_readiness_score)}>Readiness {formatScore(option.decision_readiness_score)}</Badge>
                        <Badge variant="secondary">Coverage {option.evidence_coverage}%</Badge>
                        <Badge variant="secondary">Confidence {option.evidence_confidence ?? "—"}%</Badge>
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(option)} aria-label={`Edit ${option.market_name}`}><Edit3 className="h-4 w-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 p-4 pt-2">
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-md bg-muted/50 p-2"><span className="font-semibold">Entry:</span> {entryModes.find((mode) => mode.value === option.entry_mode)?.label ?? option.entry_mode} · {timingLabels[option.timing_posture]}</div>
                    <div className="rounded-md bg-muted/50 p-2"><span className="font-semibold">Commitment:</span> {commitmentLabels[option.commitment_class]}{option.estimated_commitment_amount !== null ? ` · ${option.currency} ${Number(option.estimated_commitment_amount).toLocaleString()}` : ""}</div>
                  </div>

                  {option.white_space_hypothesis ? (
                    <div className="rounded-md border border-dashed p-3 text-xs"><div className="mb-1 flex items-center gap-2 font-semibold"><Compass className="h-3.5 w-3.5" />White-space hypothesis <Badge variant="outline" className="text-[10px]">proxy {formatScore(option.white_space_score)}</Badge></div><p className="text-muted-foreground">{option.white_space_hypothesis}</p></div>
                  ) : option.white_space_score !== null ? (
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">White-space proxy: {formatScore(option.white_space_score)}/100, but no explicit gap hypothesis is recorded. The score alone does not prove white space.</div>
                  ) : null}

                  {(option.route_to_market || option.distribution_constraints) && <div className="rounded-md bg-muted/40 p-3 text-xs"><div className="mb-1 flex items-center gap-1 font-semibold"><Route className="h-3.5 w-3.5" />Route to market</div>{option.route_to_market && <p>{option.route_to_market}</p>}{option.distribution_constraints && <p className="mt-1 text-muted-foreground"><span className="font-medium">Constraint:</span> {option.distribution_constraints}</p>}</div>}

                  {missing.length > 0 && <div className="flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs text-warning"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Missing evidence: {missing.slice(0, 5).join(", ")}{missing.length > 5 ? "…" : ""}</span></div>}
                  {option.next_test && <div className="flex items-start gap-2 rounded-md bg-primary/5 p-2 text-xs"><FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><span><span className="font-semibold">Next reversible test:</span> {option.next_test}</span></div>}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <div className="flex gap-2">
                      {option.status !== "candidate" && option.status !== "rejected" && <Button size="sm" variant="outline" className="h-7" disabled={updateOption.isPending} onClick={() => updateOption.mutate({ id: option.id, patch: { status: "candidate" } })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Candidate</Button>}
                      {option.status !== "rejected" && <Button size="sm" variant="ghost" className="h-7" disabled={updateOption.isPending} onClick={() => updateOption.mutate({ id: option.id, patch: { status: "rejected" } })}><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button>}
                    </div>
                    <Button size="sm" className="h-7" disabled={!!linkedDecision || createDecision.isPending || option.status === "rejected"} onClick={() => proposeValidation(option)}>{linkedDecision ? "Decision linked" : "Propose validation"}</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Scoring weights are deterministic and documented in the migration. Attractiveness requires at least four known factors. Decision readiness multiplies attractiveness by evidence coverage and evidence confidence; it is not expected ROI, TAM, or a forecast of market success.
      </p>
    </section>
  );
}
