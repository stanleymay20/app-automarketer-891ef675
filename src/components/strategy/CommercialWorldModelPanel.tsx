import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Database,
  GitFork,
  Link2,
  Loader2,
  Network,
  Plus,
  ShieldCheck,
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
import {
  CommercialGraphNode,
  CommercialRelationType,
  DurableCommercialEntityType,
  MemoryReusePurpose,
  MemoryReuseScope,
  useCommercialWorldModel,
  useCreateCommercialEdge,
  useCreateCommercialEntity,
  useCreateMemoryReuseReview,
  useRevokeCommercialEdge,
  useUpdateMemoryReuseReview,
} from "@/hooks/useCommercialWorldModel";

interface Props {
  appId?: string;
  apps?: Array<{ id: string; name: string }>;
}

const durableEntityTypes: Array<{ value: DurableCommercialEntityType; label: string }> = [
  { value: "competitor", label: "Competitor" },
  { value: "partner", label: "Partner" },
  { value: "channel", label: "Channel" },
  { value: "segment", label: "Segment" },
  { value: "pricing_offer", label: "Pricing offer" },
  { value: "customer_need", label: "Customer need" },
  { value: "market", label: "Market" },
  { value: "regulator", label: "Regulator" },
  { value: "supplier", label: "Supplier" },
  { value: "custom", label: "Custom" },
];

const relationTypes: CommercialRelationType[] = [
  "targets",
  "serves",
  "competes_with",
  "distributed_through",
  "partners_with",
  "priced_as",
  "supported_by",
  "challenged_by",
  "informs",
  "executes",
  "produced",
  "learned_from",
  "tests",
  "transfers_to",
  "depends_on",
  "influences",
  "related_to",
];

const reusePurposes: Array<{ value: MemoryReusePurpose; label: string }> = [
  { value: "strategy_recommendation", label: "Strategy recommendation" },
  { value: "campaign_generation", label: "Campaign generation" },
  { value: "content_generation", label: "Content generation" },
  { value: "prospect_qualification", label: "Prospect qualification" },
  { value: "market_ranking", label: "Market ranking" },
  { value: "scenario_planning", label: "Scenario planning" },
  { value: "bounded_autonomy", label: "Bounded autonomy" },
];

const nodeTypeLabels: Record<string, string> = {
  app: "Offering",
  objective: "Objective",
  decision: "Decision",
  market_option: "Market option",
  scenario: "Scenario",
  campaign: "Campaign",
  persona: "Persona",
  prospect: "Prospect",
  distribution_target: "Distribution",
  learning: "Learning",
  evidence: "Evidence",
  entity: "Commercial entity",
};

function nodeKey(node: CommercialGraphNode) {
  return `${node.node_type}:${node.node_id}`;
}

function parseNodeKey(value: string) {
  const splitAt = value.indexOf(":");
  return { type: value.slice(0, splitAt), id: value.slice(splitAt + 1) };
}

function shortText(value: string, max = 82) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function CommercialWorldModelPanel({ appId, apps = [] }: Props) {
  const { data, isLoading } = useCommercialWorldModel(appId);
  const createEntity = useCreateCommercialEntity();
  const createEdge = useCreateCommercialEdge();
  const revokeEdge = useRevokeCommercialEdge();
  const createReuseReview = useCreateMemoryReuseReview();
  const updateReuseReview = useUpdateMemoryReuseReview();

  const nodes = data?.nodes ?? [];
  const relationships = data?.relationships ?? [];
  const memories = data?.strategicMemories ?? [];
  const reviews = data?.reuseReviews ?? [];
  const approvedReuse = data?.approvedReuse ?? [];

  const [focusKey, setFocusKey] = useState("");
  const [entityOpen, setEntityOpen] = useState(false);
  const [edgeOpen, setEdgeOpen] = useState(false);
  const [reuseOpen, setReuseOpen] = useState(false);

  const [entityType, setEntityType] = useState<DurableCommercialEntityType>("competitor");
  const [entityLabel, setEntityLabel] = useState("");
  const [entityDescription, setEntityDescription] = useState("");
  const [entityScope, setEntityScope] = useState<"app" | "portfolio">("app");

  const [sourceKey, setSourceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [relationType, setRelationType] = useState<CommercialRelationType>("related_to");
  const [edgeScope, setEdgeScope] = useState<"app" | "portfolio">("app");
  const [edgeBasis, setEdgeBasis] = useState<"manual" | "evidence">("manual");
  const [edgeEvidenceId, setEdgeEvidenceId] = useState("none");
  const [edgeConfidence, setEdgeConfidence] = useState("");
  const [edgeNotes, setEdgeNotes] = useState("");

  const [reuseLearningId, setReuseLearningId] = useState("");
  const [reusePurpose, setReusePurpose] = useState<MemoryReusePurpose>("strategy_recommendation");
  const [reuseScope, setReuseScope] = useState<MemoryReuseScope>("source_app");
  const [reuseTargetAppId, setReuseTargetAppId] = useState("none");
  const [reuseRationale, setReuseRationale] = useState("");
  const [reuseExpiry, setReuseExpiry] = useState("");

  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [nodeKey(node), node])),
    [nodes]
  );
  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.node_type.localeCompare(b.node_type) || a.label.localeCompare(b.label)),
    [nodes]
  );
  const evidenceNodes = nodes.filter((node) => node.node_type === "evidence");
  const activeMemories = memories.filter((memory) => memory.status === "active");
  const explicitEdges = relationships.filter((edge) => edge.basis !== "structural");
  const structuralEdges = relationships.filter((edge) => edge.basis === "structural");
  const pendingReviews = reviews.filter((review) => review.status === "pending");
  const approvedReviews = reviews.filter((review) => review.status === "approved");

  const effectiveFocusKey = focusKey || (appId ? `app:${appId}` : sortedNodes[0] ? nodeKey(sortedNodes[0]) : "");
  const neighborhood = useMemo(() => {
    if (!effectiveFocusKey) return [];
    const { type, id } = parseNodeKey(effectiveFocusKey);
    return relationships.filter((edge) =>
      (edge.source_type === type && edge.source_id === id) ||
      (edge.target_type === type && edge.target_id === id)
    );
  }, [effectiveFocusKey, relationships]);

  const submitEntity = async () => {
    if (!entityLabel.trim()) return;
    await createEntity.mutateAsync({
      app_id: entityScope === "app" ? appId : undefined,
      entity_type: entityType,
      label: entityLabel.trim(),
      description: entityDescription.trim() || undefined,
    });
    setEntityLabel("");
    setEntityDescription("");
    setEntityType("competitor");
    setEntityScope("app");
    setEntityOpen(false);
  };

  const submitEdge = async () => {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    const source = parseNodeKey(sourceKey);
    const target = parseNodeKey(targetKey);
    const confidence = edgeConfidence.trim() === "" ? undefined : Math.min(100, Math.max(0, Number(edgeConfidence)));
    await createEdge.mutateAsync({
      app_id: edgeScope === "app" ? appId : undefined,
      edge_scope: edgeScope,
      source_type: source.type as CommercialGraphNode["node_type"],
      source_id: source.id,
      relation_type: relationType,
      target_type: target.type as CommercialGraphNode["node_type"],
      target_id: target.id,
      basis: edgeBasis,
      evidence_item_id: edgeBasis === "evidence" && edgeEvidenceId !== "none" ? edgeEvidenceId : undefined,
      confidence: Number.isFinite(confidence) ? confidence : undefined,
      notes: edgeNotes.trim() || undefined,
    });
    setSourceKey("");
    setTargetKey("");
    setRelationType("related_to");
    setEdgeScope("app");
    setEdgeBasis("manual");
    setEdgeEvidenceId("none");
    setEdgeConfidence("");
    setEdgeNotes("");
    setEdgeOpen(false);
  };

  const submitReuseReview = async () => {
    if (!reuseLearningId) return;
    if (reuseScope === "target_app" && reuseTargetAppId === "none") return;
    await createReuseReview.mutateAsync({
      learning_event_id: reuseLearningId,
      reuse_scope: reuseScope,
      target_app_id: reuseScope === "target_app" ? reuseTargetAppId : undefined,
      allowed_purposes: [reusePurpose],
      rationale: reuseRationale.trim() || undefined,
      expires_at: reuseExpiry ? new Date(`${reuseExpiry}T23:59:59`).toISOString() : undefined,
    });
    setReuseLearningId("");
    setReusePurpose("strategy_recommendation");
    setReuseScope("source_app");
    setReuseTargetAppId("none");
    setReuseRationale("");
    setReuseExpiry("");
    setReuseOpen(false);
  };

  if (isLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading Commercial World Model…</Card>;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Commercial World Model</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Native records stay authoritative. The graph exposes their relationships, adds explicit semantic links, and keeps agent memory reuse behind human review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={entityOpen} onOpenChange={setEntityOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="mr-1.5 h-3.5 w-3.5" />Commercial entity</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add durable commercial entity</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <div className="space-y-2"><Label>Type</Label><Select value={entityType} onValueChange={(v) => setEntityType(v as DurableCommercialEntityType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{durableEntityTypes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Scope</Label><Select value={entityScope} onValueChange={(v) => setEntityScope(v as "app" | "portfolio")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="app">Current offering</SelectItem><SelectItem value="portfolio">Portfolio</SelectItem></SelectContent></Select></div>
                <div className="space-y-2 sm:col-span-2"><Label>Label</Label><Input value={entityLabel} onChange={(e) => setEntityLabel(e.target.value)} placeholder="Competitor, partner, pricing offer…" /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Description</Label><Textarea value={entityDescription} onChange={(e) => setEntityDescription(e.target.value)} placeholder="Only create this when no native ScrollMarketer record already represents the entity." /></div>
              </div>
              <DialogFooter><Button onClick={submitEntity} disabled={!entityLabel.trim() || createEntity.isPending}>{createEntity.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add entity</Button></DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={edgeOpen} onOpenChange={setEdgeOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><Link2 className="mr-1.5 h-3.5 w-3.5" />Semantic link</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Record semantic relationship</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <div className="space-y-2"><Label>Source</Label><Select value={sourceKey} onValueChange={setSourceKey}><SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger><SelectContent>{sortedNodes.map((node) => <SelectItem key={`source-${nodeKey(node)}`} value={nodeKey(node)}>{nodeTypeLabels[node.node_type]} · {shortText(node.label)}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Relationship</Label><Select value={relationType} onValueChange={(v) => setRelationType(v as CommercialRelationType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{relationTypes.map((relation) => <SelectItem key={relation} value={relation}>{relation.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Target</Label><Select value={targetKey} onValueChange={setTargetKey}><SelectTrigger><SelectValue placeholder="Select target" /></SelectTrigger><SelectContent>{sortedNodes.map((node) => <SelectItem key={`target-${nodeKey(node)}`} value={nodeKey(node)}>{nodeTypeLabels[node.node_type]} · {shortText(node.label)}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Scope</Label><Select value={edgeScope} onValueChange={(v) => setEdgeScope(v as "app" | "portfolio")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="app">Current offering</SelectItem><SelectItem value="portfolio">Portfolio / cross-offering</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Basis</Label><Select value={edgeBasis} onValueChange={(v) => setEdgeBasis(v as "manual" | "evidence")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Explicit human relationship</SelectItem><SelectItem value="evidence">Evidence-backed relationship</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Confidence (optional)</Label><Input type="number" min={0} max={100} value={edgeConfidence} onChange={(e) => setEdgeConfidence(e.target.value)} placeholder="Unknown stays blank" /></div>
                {edgeBasis === "evidence" && <div className="space-y-2 sm:col-span-2"><Label>Supporting evidence</Label><Select value={edgeEvidenceId} onValueChange={setEdgeEvidenceId}><SelectTrigger><SelectValue placeholder="Select evidence" /></SelectTrigger><SelectContent><SelectItem value="none">Select evidence</SelectItem>{evidenceNodes.map((node) => <SelectItem key={node.node_id} value={node.node_id}>{shortText(node.label, 110)}</SelectItem>)}</SelectContent></Select></div>}
                <div className="space-y-2 sm:col-span-2"><Label>Notes</Label><Textarea value={edgeNotes} onChange={(e) => setEdgeNotes(e.target.value)} placeholder="Why this relationship matters. Do not turn an inference into an observed fact." /></div>
              </div>
              <DialogFooter><Button onClick={submitEdge} disabled={!sourceKey || !targetKey || sourceKey === targetKey || (edgeBasis === "evidence" && edgeEvidenceId === "none") || createEdge.isPending}>{createEdge.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record relationship</Button></DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={reuseOpen} onOpenChange={setReuseOpen}>
            <DialogTrigger asChild><Button size="sm"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Review memory reuse</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Create strategic-memory reuse review</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2"><Label>Strategic learning</Label><Select value={reuseLearningId} onValueChange={setReuseLearningId}><SelectTrigger><SelectValue placeholder="Select learning" /></SelectTrigger><SelectContent>{activeMemories.map((memory) => <SelectItem key={memory.id} value={memory.id}>{shortText(memory.lesson, 120)} · {memory.causal_status}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Purpose</Label><Select value={reusePurpose} onValueChange={(v) => setReusePurpose(v as MemoryReusePurpose)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{reusePurposes.map((purpose) => <SelectItem key={purpose.value} value={purpose.value}>{purpose.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Scope</Label><Select value={reuseScope} onValueChange={(v) => setReuseScope(v as MemoryReuseScope)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="source_app">Original offering only</SelectItem><SelectItem value="target_app">Specific other offering</SelectItem><SelectItem value="portfolio">Portfolio-wide</SelectItem></SelectContent></Select></div>
                {reuseScope === "target_app" && <div className="space-y-2 sm:col-span-2"><Label>Target offering</Label><Select value={reuseTargetAppId} onValueChange={setReuseTargetAppId}><SelectTrigger><SelectValue placeholder="Select target" /></SelectTrigger><SelectContent><SelectItem value="none">Select target</SelectItem>{apps.filter((app) => app.id !== appId).map((app) => <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>)}</SelectContent></Select></div>}
                <div className="space-y-2"><Label>Expiry (optional)</Label><Input type="date" value={reuseExpiry} onChange={(e) => setReuseExpiry(e.target.value)} /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Rationale</Label><Textarea value={reuseRationale} onChange={(e) => setReuseRationale(e.target.value)} placeholder="Why is this memory safe and relevant for this purpose/scope?" /></div>
                {reusePurpose === "bounded_autonomy" && <div className="sm:col-span-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">Bounded-autonomy reuse is intentionally strict: supported causal status is required; cross-offering use also requires tested transferability and a completed supporting transfer test for that exact target.</div>}
              </div>
              <DialogFooter><Button onClick={submitReuseReview} disabled={!reuseLearningId || (reuseScope === "target_app" && reuseTargetAppId === "none") || createReuseReview.isPending}>{createReuseReview.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create pending review</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Graph nodes</p><p className="mt-1 text-2xl font-bold">{nodes.length}</p><p className="text-xs text-muted-foreground">Native + non-duplicative durable entities</p></div><Database className="h-4 w-4 text-primary" /></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Structural links</p><p className="mt-1 text-2xl font-bold">{structuralEdges.length}</p><p className="text-xs text-muted-foreground">Derived from authoritative relationships</p></div><GitFork className="h-4 w-4 text-primary" /></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Semantic links</p><p className="mt-1 text-2xl font-bold">{explicitEdges.length}</p><p className="text-xs text-muted-foreground">Explicit, auditable relationship claims</p></div><Link2 className="h-4 w-4 text-primary" /></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Approved memories</p><p className="mt-1 text-2xl font-bold">{approvedReuse.length}</p><p className="text-xs text-muted-foreground">Reviewed reuse grants currently fresh</p></div><ShieldCheck className="h-4 w-4 text-primary" /></div></CardContent></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Focused commercial neighborhood</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Select value={effectiveFocusKey} onValueChange={setFocusKey}><SelectTrigger><SelectValue placeholder="Choose a graph node" /></SelectTrigger><SelectContent>{sortedNodes.map((node) => <SelectItem key={nodeKey(node)} value={nodeKey(node)}>{nodeTypeLabels[node.node_type]} · {shortText(node.label, 120)}</SelectItem>)}</SelectContent></Select>
            {effectiveFocusKey && nodeMap.get(effectiveFocusKey) && (
              <div className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{nodeTypeLabels[nodeMap.get(effectiveFocusKey)!.node_type]}</Badge><span className="font-semibold">{nodeMap.get(effectiveFocusKey)!.label}</span><Badge variant="outline">{nodeMap.get(effectiveFocusKey)!.state}</Badge></div>
              </div>
            )}
            {neighborhood.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No visible relationships for this node yet.</p> : neighborhood.slice(0, 16).map((edge) => {
              const focus = parseNodeKey(effectiveFocusKey);
              const outgoing = edge.source_type === focus.type && edge.source_id === focus.id;
              const otherKey = outgoing ? `${edge.target_type}:${edge.target_id}` : `${edge.source_type}:${edge.source_id}`;
              const other = nodeMap.get(otherKey);
              return (
                <div key={edge.relation_id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs"><Badge variant={edge.basis === "structural" ? "secondary" : "outline"}>{edge.basis}</Badge><span className="font-medium">{outgoing ? edge.relation_type.replaceAll("_", " ") : `← ${edge.relation_type.replaceAll("_", " ")}`}</span>{edge.confidence !== null && <span className="text-muted-foreground">{edge.confidence}% confidence</span>}</div>
                    <p className="mt-1 truncate text-sm">{other?.label ?? `${outgoing ? edge.target_type : edge.source_type} · ${outgoing ? edge.target_id : edge.source_id}`}</p>
                  </div>
                  {edge.basis !== "structural" && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={revokeEdge.isPending} onClick={() => revokeEdge.mutate(edge.relation_id)}>Revoke</Button>}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Memory reuse control</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">An approved review is a permission contract, not a truth claim. Strategic memory is not automatically injected into generation or autonomy merely because it exists.</div>
            {pendingReviews.length === 0 && approvedReviews.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">No reuse reviews yet.</p> : null}
            {pendingReviews.slice(0, 8).map((review) => {
              const memory = memories.find((item) => item.id === review.learning_event_id);
              return (
                <div key={review.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap gap-1"><Badge variant="outline">pending</Badge>{review.allowed_purposes.map((purpose) => <Badge key={purpose} variant="secondary">{purpose.replaceAll("_", " ")}</Badge>)}</div><p className="mt-2 text-sm font-medium">{memory ? shortText(memory.lesson, 115) : "Strategic learning"}</p><p className="mt-1 text-xs text-muted-foreground">Scope: {review.reuse_scope.replaceAll("_", " ")}</p></div></div>
                  <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" className="h-7" disabled={updateReuseReview.isPending} onClick={() => updateReuseReview.mutate({ id: review.id, status: "rejected" })}><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button><Button size="sm" className="h-7" disabled={updateReuseReview.isPending} onClick={() => updateReuseReview.mutate({ id: review.id, status: "approved" })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve</Button></div>
                </div>
              );
            })}
            {approvedReviews.slice(0, 8).map((review) => {
              const memory = memories.find((item) => item.id === review.learning_event_id);
              const fresh = approvedReuse.some((item) => item.review_id === review.id);
              return (
                <div key={review.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-1.5"><Badge variant={fresh ? "secondary" : "outline"}>{fresh ? "approved · fresh" : "approved · stale/expired"}</Badge>{review.allowed_purposes.map((purpose) => <Badge key={purpose} variant="outline">{purpose.replaceAll("_", " ")}</Badge>)}</div>
                  <p className="mt-2 text-sm font-medium">{memory ? shortText(memory.lesson, 115) : "Strategic learning"}</p>
                  <div className="mt-3"><Button size="sm" variant="ghost" className="h-7" disabled={updateReuseReview.isPending} onClick={() => updateReuseReview.mutate({ id: review.id, status: "revoked" })}>Revoke permission</Button></div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
