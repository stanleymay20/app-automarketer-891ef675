import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Database, GitBranch, Loader2, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phase9DecisionSupportContainer } from "@/components/strategy/Phase9DecisionSupportContainer";
import {
  DecisionContextPurpose,
  useGenerateStrategicRecommendations,
  usePreviewDecisionContext,
  useStrategicContextSnapshots,
} from "@/hooks/useDecisionContext";
import { CommercialGraphNode, CommercialNodeType, useCommercialWorldModel } from "@/hooks/useCommercialWorldModel";

const purposeLabels: Record<DecisionContextPurpose, string> = {
  strategy_recommendation: "Strategy recommendation",
  market_ranking: "Market ranking",
  scenario_planning: "Scenario planning",
};

const allowedFocus = new Set<CommercialNodeType>(["app", "objective", "decision", "market_option", "scenario"]);

function CountPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function ContextList({ title, rows, render }: { title: string; rows: Array<Record<string, any>>; render: (row: Record<string, any>) => React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">None in the assembled context.</div>
      ) : (
        <div className="space-y-2">{rows.slice(0, 6).map((row, index) => <div key={String(row.id ?? row.learning_event_id ?? index)} className="rounded-md border p-3 text-sm">{render(row)}</div>)}</div>
      )}
    </div>
  );
}

export function DecisionContextPanel({ appId }: { appId?: string }) {
  const [purpose, setPurpose] = useState<DecisionContextPurpose>("strategy_recommendation");
  const [focusKey, setFocusKey] = useState<string>("");
  const preview = usePreviewDecisionContext();
  const generate = useGenerateStrategicRecommendations();
  const { data: worldModel } = useCommercialWorldModel(appId);
  const { data: snapshots = [] } = useStrategicContextSnapshots(appId, 6);

  const focusNodes = useMemo(() => {
    if (!appId) return [] as CommercialGraphNode[];
    return (worldModel?.nodes ?? [])
      .filter((node) => allowedFocus.has(node.node_type))
      .filter((node) => node.app_id === appId || (node.node_type === "app" && node.node_id === appId))
      .sort((a, b) => {
        if (a.node_type === "app") return -1;
        if (b.node_type === "app") return 1;
        return a.label.localeCompare(b.label);
      });
  }, [appId, worldModel?.nodes]);

  useEffect(() => {
    if (!appId) {
      setFocusKey("");
      return;
    }
    const defaultKey = `app:${appId}`;
    if (!focusNodes.some((node) => `${node.node_type}:${node.node_id}` === focusKey)) setFocusKey(defaultKey);
  }, [appId, focusKey, focusNodes]);

  const focusNode = useMemo(() => {
    const [nodeType, nodeId] = focusKey.split(":");
    return focusNodes.find((node) => node.node_type === nodeType && node.node_id === nodeId);
  }, [focusKey, focusNodes]);

  const assemble = () => {
    if (!appId) return;
    preview.mutate({
      appId,
      purpose,
      focusType: (focusNode?.node_type ?? "app") as CommercialNodeType,
      focusId: focusNode?.node_id ?? appId,
    });
  };

  const generateRecommendations = () => {
    if (!appId || purpose !== "strategy_recommendation") return;
    generate.mutate({
      appId,
      focusType: (focusNode?.node_type ?? "app") as CommercialNodeType,
      focusId: focusNode?.node_id ?? appId,
    });
  };

  const context = preview.data;
  const counts = context?.counts;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Controlled Decision Context</CardTitle>
              <Badge variant="outline">Phase 8</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              Deterministically assemble only relevant graph context, validated observations, unresolved uncertainty, reviewed strategic memory and governance constraints. Previewing does not create an AI recommendation; generation creates proposed decisions only.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />No approval or execution
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[220px_minmax(220px,1fr)_auto]">
          <Select value={purpose} onValueChange={(value) => setPurpose(value as DecisionContextPurpose)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(purposeLabels) as DecisionContextPurpose[]).map((key) => <SelectItem key={key} value={key}>{purposeLabels[key]}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={focusKey} onValueChange={setFocusKey} disabled={!appId || focusNodes.length === 0}>
            <SelectTrigger><SelectValue placeholder="Choose strategic focus" /></SelectTrigger>
            <SelectContent>
              {focusNodes.map((node) => (
                <SelectItem key={`${node.node_type}:${node.node_id}`} value={`${node.node_type}:${node.node_id}`}>
                  {node.node_type.replaceAll("_", " ")} · {node.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            <Button variant="outline" onClick={assemble} disabled={!appId || preview.isPending}>
              {preview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              Assemble preview
            </Button>
            <Button onClick={generateRecommendations} disabled={!appId || purpose !== "strategy_recommendation" || generate.isPending}>
              {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Generate proposed decisions
            </Button>
          </div>
        </div>

        {context && counts && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <CountPill label="Graph nodes" value={counts.graph_nodes} />
              <CountPill label="Relationships" value={counts.graph_relationships} />
              <CountPill label="Validated facts" value={counts.validated_observations} />
              <CountPill label="Assumptions" value={counts.assumptions_or_inferences} />
              <CountPill label="Open questions" value={counts.open_questions} />
              <CountPill label="Unknowns" value={counts.unknown_evidence} />
              <CountPill label="Approved memory" value={counts.approved_memories} />
              <CountPill label="Policies" value={counts.enabled_governance_policies} />
            </div>

            {context.warnings.length > 0 && (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
                {context.warnings.map((warning) => (
                  <div key={warning} className="flex gap-2 text-xs"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /><span>{warning}</span></div>
                ))}
              </div>
            )}

            <div className="grid gap-5 xl:grid-cols-3">
              <ContextList
                title="Validated observations"
                rows={context.verified_observations}
                render={(row) => <><div>{row.claim}</div><div className="mt-1 text-[11px] text-muted-foreground">{row.source_type}{row.confidence === null || row.confidence === undefined ? "" : ` · confidence ${row.confidence}%`}</div></>}
              />
              <ContextList
                title="Unresolved questions"
                rows={context.unresolved_uncertainty.questions}
                render={(row) => <><div>{row.question}</div><div className="mt-1 text-[11px] text-muted-foreground">Information-value proxy {row.information_value_score ?? "—"} · urgency {row.urgency ?? "—"}</div></>}
              />
              <ContextList
                title="Approved strategic memory"
                rows={context.approved_strategic_memories}
                render={(row) => <><div>{row.lesson}</div><div className="mt-1 text-[11px] text-muted-foreground">Causal status: {String(row.causal_status ?? "unknown")} · transfer: {String(row.transferability_status ?? "unknown")}</div></>}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
              <span>Fingerprint: <span className="font-mono">{context.context_fingerprint}</span></span>
              <span>Context version: {context.context_version}</span>
            </div>
          </>
        )}

        {!context && (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            Assemble a preview to inspect exactly what a recommendation workflow is allowed to see before any model call is made.
          </div>
        )}

        {snapshots.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><GitBranch className="h-3.5 w-3.5" />Recent recommendation context snapshots</div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {snapshots.slice(0, 6).map((snapshot) => (
                <div key={snapshot.id} className="rounded-md border p-2 text-xs">
                  <div className="font-medium capitalize">{snapshot.purpose.replaceAll("_", " ")}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">{snapshot.context_fingerprint}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t pt-5">
          <Phase9DecisionSupportContainer appId={appId} />
        </div>
      </CardContent>
    </Card>
  );
}
