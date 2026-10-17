import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  FileCheck2,
  Gauge,
  Loader2,
  LockKeyhole,
  Octagon,
  Plus,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CommitmentClass, DecisionType, StrategicDecision } from "@/hooks/useStrategy";
import {
  ExecutionMode,
  GovernanceAuthorityMode,
  StopRuleType,
  useConfigureDecisionExecution,
  useCreateGovernancePolicy,
  useCreateStrategicStopRule,
  useEvaluateStrategicGovernance,
  useStrategicGovernance,
  useUpdateApprovalRequest,
  useUpdateGovernancePolicy,
  useUpdateStrategicStopRule,
} from "@/hooks/useStrategicGovernance";

interface Props {
  appId?: string;
  decisions: StrategicDecision[];
}

const decisionTypes: { value: DecisionType | "all"; label: string }[] = [
  { value: "all", label: "All decision types" },
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

const resultTone: Record<string, string> = {
  allow: "bg-success/10 text-success border-success/20",
  review: "bg-warning/10 text-warning border-warning/20",
  block: "bg-destructive/10 text-destructive border-destructive/20",
};

function Metric({ label, value, helper }: { label: string; value: string | number; helper: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 font-display text-xl font-bold">{value}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{helper}</div>
      </CardContent>
    </Card>
  );
}

export function GovernanceAuthorityPanel({ appId, decisions }: Props) {
  const { data, isLoading } = useStrategicGovernance(appId);
  const createPolicy = useCreateGovernancePolicy();
  const updatePolicy = useUpdateGovernancePolicy();
  const configureDecision = useConfigureDecisionExecution();
  const evaluate = useEvaluateStrategicGovernance();
  const updateApproval = useUpdateApprovalRequest();
  const createStopRule = useCreateStrategicStopRule();
  const updateStopRule = useUpdateStrategicStopRule();

  const policies = data?.policies ?? [];
  const approvals = data?.approvals ?? [];
  const stopRules = data?.stopRules ?? [];
  const evaluations = data?.evaluations ?? [];
  const actionLog = data?.actionLog ?? [];

  const [selectedDecisionId, setSelectedDecisionId] = useState("");
  const effectiveDecisionId = selectedDecisionId || decisions[0]?.id || "";
  const selectedDecision = decisions.find((decision) => decision.id === effectiveDecisionId);

  const pendingApprovals = approvals.filter((item) => item.status === "pending");
  const triggeredStops = stopRules.filter((item) => item.status === "triggered");
  const latestEvaluation = evaluations.find((item) => item.decision_id === effectiveDecisionId);
  const decisionApprovals = approvals.filter((item) => item.decision_id === effectiveDecisionId);
  const decisionStops = stopRules.filter((item) => item.decision_id === effectiveDecisionId);
  const decisionLog = actionLog.filter((item) => item.decision_id === effectiveDecisionId).slice(0, 8);

  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyName, setPolicyName] = useState("");
  const [policyDecisionType, setPolicyDecisionType] = useState<DecisionType | "all">("all");
  const [authorityMode, setAuthorityMode] = useState<GovernanceAuthorityMode>("manual_only");
  const [minConfidence, setMinConfidence] = useState(80);
  const [maxCommitment, setMaxCommitment] = useState(0);
  const [currency, setCurrency] = useState("EUR");
  const [allowedReversibility, setAllowedReversibility] = useState<CommitmentClass[]>(["reversible"]);
  const [humanApproval, setHumanApproval] = useState(true);
  const [legalApproval, setLegalApproval] = useState(false);
  const [brandApproval, setBrandApproval] = useState(false);
  const [executiveApproval, setExecutiveApproval] = useState(false);
  const [policyNotes, setPolicyNotes] = useState("");

  const [executionMode, setExecutionMode] = useState<ExecutionMode>("manual");
  const [commitmentAmount, setCommitmentAmount] = useState(0);
  const [decisionCurrency, setDecisionCurrency] = useState("EUR");

  const [stopOpen, setStopOpen] = useState(false);
  const [stopName, setStopName] = useState("");
  const [stopType, setStopType] = useState<StopRuleType>("confidence_floor");
  const [stopThreshold, setStopThreshold] = useState(70);
  const [stopDeadline, setStopDeadline] = useState("");

  useEffect(() => {
    if (!selectedDecision) return;
    const withExecution = selectedDecision as StrategicDecision & { execution_mode?: ExecutionMode };
    setExecutionMode(withExecution.execution_mode ?? "manual");
    setCommitmentAmount(Number(selectedDecision.commitment_amount ?? 0));
    setDecisionCurrency(selectedDecision.currency || "EUR");
  }, [selectedDecision?.id, selectedDecision?.commitment_amount, selectedDecision?.currency]);

  const enabledPolicies = policies.filter((item) => item.enabled).length;
  const autonomousPolicies = policies.filter((item) => item.enabled && item.authority_mode === "bounded_execute").length;

  const resetPolicy = () => {
    setPolicyName("");
    setPolicyDecisionType("all");
    setAuthorityMode("manual_only");
    setMinConfidence(80);
    setMaxCommitment(0);
    setCurrency("EUR");
    setAllowedReversibility(["reversible"]);
    setHumanApproval(true);
    setLegalApproval(false);
    setBrandApproval(false);
    setExecutiveApproval(false);
    setPolicyNotes("");
  };

  const submitPolicy = async () => {
    if (!policyName.trim()) return;
    await createPolicy.mutateAsync({
      app_id: appId,
      policy_name: policyName.trim(),
      decision_types: policyDecisionType === "all" ? [] : [policyDecisionType],
      authority_mode: authorityMode,
      min_confidence: authorityMode === "bounded_execute" ? minConfidence : undefined,
      max_commitment_amount: authorityMode === "bounded_execute" ? maxCommitment : undefined,
      currency,
      allowed_reversibility: authorityMode === "bounded_execute" ? allowedReversibility : [],
      human_approval_required: humanApproval,
      legal_review_required: legalApproval,
      brand_review_required: brandApproval,
      executive_approval_required: executiveApproval,
      enabled: false,
      notes: policyNotes.trim() || undefined,
    });
    resetPolicy();
    setPolicyOpen(false);
  };

  const toggleReversibility = (value: CommitmentClass, checked: boolean) => {
    setAllowedReversibility((current) => checked
      ? Array.from(new Set([...current, value]))
      : current.filter((item) => item !== value));
  };

  const saveExecutionEnvelope = async () => {
    if (!selectedDecision) return;
    await configureDecision.mutateAsync({
      id: selectedDecision.id,
      execution_mode: executionMode,
      commitment_amount: Math.max(0, commitmentAmount),
      currency: decisionCurrency.trim().toUpperCase() || "EUR",
    });
  };

  const submitStopRule = async () => {
    if (!selectedDecision || !stopName.trim()) return;
    await createStopRule.mutateAsync({
      decision_id: selectedDecision.id,
      rule_name: stopName.trim(),
      rule_type: stopType,
      threshold_numeric: stopType === "confidence_floor" || stopType === "commitment_ceiling" ? stopThreshold : undefined,
      threshold_at: stopType === "deadline" && stopDeadline ? new Date(stopDeadline).toISOString() : undefined,
      currency: stopType === "commitment_ceiling" ? decisionCurrency : undefined,
    });
    setStopName("");
    setStopType("confidence_floor");
    setStopThreshold(70);
    setStopDeadline("");
    setStopOpen(false);
  };

  const policyReady = authorityMode !== "bounded_execute" || allowedReversibility.length > 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Governance & authority</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Explicit authority envelopes, approvals and stop rules. No enabled policy means no bounded autonomous strategic execution.
          </p>
        </div>
        <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={!appId}><Plus className="mr-2 h-4 w-4" />Policy</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create governance policy</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Policy name</Label><Input value={policyName} onChange={(event) => setPolicyName(event.target.value)} placeholder="Reversible campaign tests under explicit limits" /></div>
              <div className="space-y-2"><Label>Decision scope</Label><Select value={policyDecisionType} onValueChange={(value) => setPolicyDecisionType(value as DecisionType | "all")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{decisionTypes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Authority mode</Label><Select value={authorityMode} onValueChange={(value) => setAuthorityMode(value as GovernanceAuthorityMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual_only">Manual only</SelectItem><SelectItem value="recommend">Recommend</SelectItem><SelectItem value="draft">Draft only</SelectItem><SelectItem value="bounded_execute">Bounded execute</SelectItem></SelectContent></Select></div>
              {authorityMode === "bounded_execute" && (
                <>
                  <div className="space-y-2"><Label>Minimum confidence (%)</Label><Input type="number" min={0} max={100} value={minConfidence} onChange={(event) => setMinConfidence(Math.min(100, Math.max(0, Number(event.target.value))))} /></div>
                  <div className="space-y-2"><Label>Maximum commitment</Label><div className="flex gap-2"><Input type="number" min={0} value={maxCommitment} onChange={(event) => setMaxCommitment(Math.max(0, Number(event.target.value)))} /><Input className="w-24" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></div></div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Allowed reversibility</Label>
                    <div className="flex flex-wrap gap-4 rounded-md border p-3">
                      {(["reversible","partly_reversible","hard_to_reverse"] as CommitmentClass[]).map((value) => (
                        <label key={value} className="flex items-center gap-2 text-sm"><Checkbox checked={allowedReversibility.includes(value)} onCheckedChange={(checked) => toggleReversibility(value, checked === true)} /><span>{value.replaceAll("_", " ")}</span></label>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label>Required approvals</Label>
                <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={humanApproval} onCheckedChange={(checked) => setHumanApproval(checked === true)} />Human approval</label>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={legalApproval} onCheckedChange={(checked) => setLegalApproval(checked === true)} />Legal review</label>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={brandApproval} onCheckedChange={(checked) => setBrandApproval(checked === true)} />Brand review</label>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={executiveApproval} onCheckedChange={(checked) => setExecutiveApproval(checked === true)} />Executive approval</label>
                </div>
                <p className="text-[11px] text-muted-foreground">Hard-to-reverse decisions require executive approval even when the policy does not explicitly request it.</p>
              </div>
              <div className="space-y-2 sm:col-span-2"><Label>Notes</Label><Textarea value={policyNotes} onChange={(event) => setPolicyNotes(event.target.value)} placeholder="What this authority envelope is intended to cover." /></div>
            </div>
            <DialogFooter><Button onClick={submitPolicy} disabled={!policyName.trim() || !policyReady || createPolicy.isPending}>{createPolicy.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create disabled policy</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Enabled policies" value={enabledPolicies} helper="Explicit authority envelopes currently active" />
        <Metric label="Autonomy policies" value={autonomousPolicies} helper="Enabled bounded-execute policies" />
        <Metric label="Pending approvals" value={pendingApprovals.length} helper="Human/legal/brand/executive decisions waiting" />
        <Metric label="Triggered stops" value={triggeredStops.length} helper="Explicit halts currently blocking autonomy" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Authority policies</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? <div className="text-sm text-muted-foreground">Loading governance…</div> : policies.length === 0 ? (
              <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No strategic governance policy exists. Bounded autonomous execution therefore fails closed.</div>
            ) : policies.map((policy) => (
              <div key={policy.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-medium text-sm">{policy.policy_name}</div><div className="text-[11px] text-muted-foreground">{policy.app_id ? "This offering" : "Global"} · {policy.decision_types.length ? policy.decision_types.join(", ") : "all decisions"}</div></div>
                  <Badge variant="outline" className={policy.enabled ? "bg-success/10 text-success border-success/20" : ""}>{policy.enabled ? "enabled" : "disabled"}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="capitalize">{policy.authority_mode.replaceAll("_", " ")}</Badge>
                  {policy.min_confidence !== null && <Badge variant="outline">confidence ≥ {policy.min_confidence}%</Badge>}
                  {policy.max_commitment_amount !== null && <Badge variant="outline">≤ {policy.max_commitment_amount} {policy.currency}</Badge>}
                </div>
                {policy.authority_mode === "bounded_execute" && <div className="text-[11px] text-muted-foreground">Allowed: {policy.allowed_reversibility.map((value) => value.replaceAll("_", " ")).join(", ")}</div>}
                <Button size="sm" variant={policy.enabled ? "outline" : "default"} className="h-7" onClick={() => updatePolicy.mutate({ id: policy.id, patch: { enabled: !policy.enabled } })} disabled={updatePolicy.isPending}>{policy.enabled ? "Disable" : "Enable"}</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><LockKeyhole className="h-4 w-4" />Decision execution gate</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {decisions.length === 0 ? <div className="text-sm text-muted-foreground">Create a strategic decision first.</div> : (
              <>
                <div className="space-y-2"><Label>Decision</Label><Select value={effectiveDecisionId} onValueChange={setSelectedDecisionId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{decisions.map((decision) => <SelectItem key={decision.id} value={decision.id}>{decision.title}</SelectItem>)}</SelectContent></Select></div>
                {selectedDecision && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-2"><Label>Execution mode</Label><Select value={executionMode} onValueChange={(value) => setExecutionMode(value as ExecutionMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="bounded_autonomous">Bounded autonomous</SelectItem></SelectContent></Select></div>
                      <div className="space-y-2"><Label>Commitment amount</Label><Input type="number" min={0} value={commitmentAmount} onChange={(event) => setCommitmentAmount(Math.max(0, Number(event.target.value)))} /></div>
                      <div className="space-y-2"><Label>Currency</Label><Input value={decisionCurrency} onChange={(event) => setDecisionCurrency(event.target.value.toUpperCase())} /></div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={saveExecutionEnvelope} disabled={configureDecision.isPending}>{configureDecision.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save envelope</Button>
                      <Button size="sm" onClick={() => evaluate.mutate({ decision_id: selectedDecision.id })} disabled={evaluate.isPending}><Gauge className="mr-2 h-4 w-4" />Evaluate autonomy</Button>
                    </div>
                    <div className="rounded-md border p-3 text-xs">
                      <div className="flex items-center justify-between gap-2"><span className="font-semibold">Latest governance result</span>{latestEvaluation ? <Badge variant="outline" className={resultTone[latestEvaluation.result]}>{latestEvaluation.result}</Badge> : <Badge variant="outline">not evaluated</Badge>}</div>
                      {latestEvaluation && <div className="mt-2 space-y-1 text-muted-foreground">{(latestEvaluation.reasons ?? []).length ? latestEvaluation.reasons.map((reason, index) => <div key={`${reason}-${index}`}>• {reason}</div>) : <div>No blocking or review reason recorded.</div>}</div>}
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedDecision && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><FileCheck2 className="h-4 w-4" />Approvals</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {decisionApprovals.length === 0 ? <div className="text-sm text-muted-foreground">No approval request yet. Governance evaluation creates only the approvals required by the applicable policy.</div> : decisionApprovals.map((request) => (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                  <div><div className="text-sm font-medium capitalize">{request.approval_type} approval</div><div className="text-[11px] text-muted-foreground">{request.reason || "Required approval"}</div></div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={request.status === "approved" ? "bg-success/10 text-success border-success/20" : request.status === "rejected" ? "bg-destructive/10 text-destructive border-destructive/20" : ""}>{request.status}</Badge>
                    {request.status === "pending" && <><Button size="sm" variant="outline" className="h-7" onClick={() => updateApproval.mutate({ id: request.id, status: "rejected" })}><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button><Button size="sm" className="h-7" onClick={() => updateApproval.mutate({ id: request.id, status: "approved" })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve</Button></>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-base flex items-center gap-2"><Octagon className="h-4 w-4" />Stop rules</CardTitle><Dialog open={stopOpen} onOpenChange={setStopOpen}><DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="mr-1 h-3.5 w-3.5" />Rule</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Add deterministic stop rule</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div className="space-y-2"><Label>Name</Label><Input value={stopName} onChange={(event) => setStopName(event.target.value)} placeholder="Stop if confidence falls below validated floor" /></div><div className="space-y-2"><Label>Rule type</Label><Select value={stopType} onValueChange={(value) => setStopType(value as StopRuleType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="confidence_floor">Confidence floor</SelectItem><SelectItem value="commitment_ceiling">Commitment ceiling</SelectItem><SelectItem value="deadline">Deadline</SelectItem><SelectItem value="manual_halt">Manual halt</SelectItem></SelectContent></Select></div>{(stopType === "confidence_floor" || stopType === "commitment_ceiling") && <div className="space-y-2"><Label>{stopType === "confidence_floor" ? "Minimum confidence (%)" : `Maximum commitment (${decisionCurrency})`}</Label><Input type="number" min={0} value={stopThreshold} onChange={(event) => setStopThreshold(Math.max(0, Number(event.target.value)))} /></div>}{stopType === "deadline" && <div className="space-y-2"><Label>Deadline</Label><Input type="datetime-local" value={stopDeadline} onChange={(event) => setStopDeadline(event.target.value)} /></div>}</div><DialogFooter><Button onClick={submitStopRule} disabled={!stopName.trim() || (stopType === "deadline" && !stopDeadline) || createStopRule.isPending}>Create rule</Button></DialogFooter></DialogContent></Dialog></div></CardHeader>
            <CardContent className="space-y-2">
              {decisionStops.length === 0 ? <div className="text-sm text-muted-foreground">No machine-enforceable stop rules for this decision.</div> : decisionStops.map((rule) => (
                <div key={rule.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2"><div><div className="text-sm font-medium">{rule.rule_name}</div><div className="text-[11px] text-muted-foreground capitalize">{rule.rule_type.replaceAll("_", " ")}</div></div><Badge variant="outline" className={rule.status === "triggered" ? "bg-destructive/10 text-destructive border-destructive/20" : ""}>{rule.status}</Badge></div>
                  <div className="flex gap-2">{rule.status === "active" && <Button size="sm" variant="destructive" className="h-7" onClick={() => updateStopRule.mutate({ id: rule.id, status: "triggered", triggered_reason: "Manual halt from Strategy Command" })}>Trigger halt</Button>}{rule.status !== "disabled" && <Button size="sm" variant="outline" className="h-7" onClick={() => updateStopRule.mutate({ id: rule.id, status: "disabled" })}>Disable</Button>}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {selectedDecision && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Decision → approval → action audit chain</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {decisionLog.length === 0 ? <div className="text-sm text-muted-foreground">No governance events recorded for this decision yet.</div> : decisionLog.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 border-b py-2 last:border-0">
                <div><div className="text-sm font-medium">{entry.event_type.replaceAll("_", " ")}</div><div className="text-[11px] text-muted-foreground">{JSON.stringify(entry.next_state)}</div></div>
                <div className="shrink-0 text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
