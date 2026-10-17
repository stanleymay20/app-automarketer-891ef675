import { useEffect, useMemo, useState } from "react";
import { BarChart3, CircleHelp, FlaskConical, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMarketOptions } from "@/hooks/useMarketChoice";
import {
  useAssessStrategicScenario,
  usePhase9DecisionSupport,
  useRunStrategicMarketRanking,
} from "@/hooks/usePhase9DecisionSupport";
import { useStrategySimulation } from "@/hooks/useStrategySimulation";
import type { StrategicObjective } from "@/hooks/useStrategy";

export function MarketScenarioDecisionSupportPanel({
  appId,
  objectives,
}: {
  appId?: string;
  objectives: StrategicObjective[];
}) {
  const { data: marketData } = useMarketOptions(appId);
  const { data: simulation } = useStrategySimulation(appId);
  const { data: phase9 } = usePhase9DecisionSupport(appId);
  const rankMarkets = useRunStrategicMarketRanking();
  const assessScenario = useAssessStrategicScenario();

  const [objectiveId, setObjectiveId] = useState("all");
  const [scenarioId, setScenarioId] = useState("");
  const options = marketData?.options ?? [];
  const scenarios = simulation?.scenarios ?? [];
  const branches = simulation?.branches ?? [];

  useEffect(() => {
    if (!scenarioId && scenarios[0]?.id) setScenarioId(scenarios[0].id);
    if (scenarioId && !scenarios.some((s) => s.id === scenarioId)) setScenarioId(scenarios[0]?.id ?? "");
  }, [scenarioId, scenarios]);

  const deterministicPreview = useMemo(() => {
    const scoped = options.filter((m) => objectiveId === "all" || !m.goal_id || m.goal_id === objectiveId);
    const ranked = scoped
      .filter((m) => !["entered", "rejected"].includes(m.status) && m.decision_readiness_score !== null)
      .sort((a, b) =>
        Number(b.decision_readiness_score ?? -1) - Number(a.decision_readiness_score ?? -1) ||
        Number(b.attractiveness_score ?? -1) - Number(a.attractiveness_score ?? -1) ||
        b.evidence_coverage - a.evidence_coverage ||
        Number(b.evidence_confidence ?? -1) - Number(a.evidence_confidence ?? -1) ||
        a.id.localeCompare(b.id)
      );
    const rankById = new Map(ranked.map((m, i) => [m.id, i + 1]));
    return scoped
      .map((m) => ({
        ...m,
        rankState: ["entered", "rejected"].includes(m.status)
          ? "excluded"
          : m.decision_readiness_score === null ? "insufficient_evidence" : "ranked",
        rank: rankById.get(m.id) ?? null,
      }))
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.market_name.localeCompare(b.market_name));
  }, [options, objectiveId]);

  const latestRanking = (phase9?.rankingRuns ?? []).find((run) =>
    objectiveId === "all" ? run.objective_id === null : run.objective_id === objectiveId
  ) ?? phase9?.rankingRuns?.[0];
  const latestRankingItems = latestRanking
    ? (phase9?.rankingItems ?? []).filter((item) => item.run_id === latestRanking.id)
    : [];
  const optionById = new Map(options.map((m) => [m.id, m]));

  const selectedScenario = scenarios.find((s) => s.id === scenarioId);
  const selectedBranches = branches.filter((b) => b.scenario_id === scenarioId);
  const latestAssessment = (phase9?.scenarioAssessments ?? []).find((run) => run.scenario_id === scenarioId);

  const runRanking = () => {
    if (!appId) return;
    rankMarkets.mutate({ appId, objectiveId: objectiveId === "all" ? undefined : objectiveId });
  };
  const runAssessment = () => {
    if (!appId || !scenarioId) return;
    assessScenario.mutate({ appId, scenarioId });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Phase 9 · Market Ranking & Scenario Planning
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Deterministic ranking first; AI interpretation second. Recommendation-only, with immutable context provenance.
            </p>
          </div>
          <Badge variant="outline">No execution authority</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4" />Market ranking</h3>
              <p className="text-xs text-muted-foreground">NULL readiness stays unranked rather than receiving a made-up neutral score.</p>
            </div>
            <div className="flex gap-2">
              <Select value={objectiveId} onValueChange={setObjectiveId}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All objectives</SelectItem>
                  {objectives.map((o) => <SelectItem key={o.id} value={o.id}>{o.objective_name || o.goal_type}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={runRanking} disabled={!appId || !options.length || rankMarkets.isPending}>
                {rankMarkets.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Rank
              </Button>
            </div>
          </div>

          {!deterministicPreview.length ? (
            <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">Add market options before ranking them.</div>
          ) : (
            <div className="space-y-2">
              {deterministicPreview.slice(0, 8).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{m.market_name}{m.segment_name ? ` · ${m.segment_name}` : ""}</span>
                      {m.rankState === "ranked" ? <Badge variant="secondary">#{m.rank}</Badge> : <Badge variant="outline">{m.rankState.replaceAll("_", " ")}</Badge>}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Coverage {m.evidence_coverage}% · evidence confidence {m.evidence_confidence ?? "—"}%</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{m.decision_readiness_score === null ? "—" : Number(m.decision_readiness_score).toFixed(1)}</div>
                    <div className="text-[10px] text-muted-foreground">readiness</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {latestRanking && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">Latest immutable ranking</span><span>{latestRanking.ranked_count}/{latestRanking.market_count} ranked</span></div>
              {latestRanking.summary && <p className="mt-2 text-muted-foreground">{latestRanking.summary}</p>}
              {latestRankingItems.filter((x) => x.deterministic_rank !== null).slice(0, 3).map((item) => (
                <div key={item.id} className="mt-2 border-t pt-2">
                  <span className="font-medium">#{item.deterministic_rank} {optionById.get(item.market_option_id)?.market_name ?? "Market option"}</span>
                  {item.recommendation && <span className="ml-2 text-muted-foreground">· {item.recommendation}</span>}
                  {item.rationale && <p className="mt-1 text-muted-foreground">{item.rationale}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4" />Scenario assessment</h3>
              <p className="text-xs text-muted-foreground">Unknown likelihood stays unknown; stored assumptions remain visibly assumptions.</p>
            </div>
            <div className="flex gap-2">
              <Select value={scenarioId} onValueChange={setScenarioId} disabled={!scenarios.length}>
                <SelectTrigger className="w-[190px]"><SelectValue placeholder="Select scenario" /></SelectTrigger>
                <SelectContent>{scenarios.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" onClick={runAssessment} disabled={!appId || !scenarioId || assessScenario.isPending}>
                {assessScenario.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Assess
              </Button>
            </div>
          </div>

          {!selectedScenario ? (
            <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">Create a scenario and branches in Scenario Lab before assessing robustness.</div>
          ) : (
            <div className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-sm font-medium">{selectedScenario.title}</p><p className="mt-1 text-xs text-muted-foreground">{selectedScenario.decision_question || selectedScenario.base_move}</p></div>
                <Badge variant="outline">{selectedBranches.length} branches</Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded bg-muted/60 p-2"><div className="font-semibold">{selectedBranches.filter((b) => b.decision_effect !== "unknown").length}</div><div className="text-[10px] text-muted-foreground">effects assessed</div></div>
                <div className="rounded bg-muted/60 p-2"><div className="font-semibold">{selectedBranches.filter((b) => b.likelihood_pct !== null).length}</div><div className="text-[10px] text-muted-foreground">likelihood stated</div></div>
                <div className="rounded bg-muted/60 p-2"><div className="font-semibold">{selectedBranches.filter((b) => b.likelihood_pct === null).length}</div><div className="text-[10px] text-muted-foreground">likelihood unknown</div></div>
              </div>
            </div>
          )}

          {latestAssessment ? (
            <div className="rounded-lg bg-muted/50 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold capitalize">{latestAssessment.recommendation.replaceAll("_", " ")}</span>
                <Badge variant="secondary">{latestAssessment.confidence}% confidence</Badge>
              </div>
              {latestAssessment.rationale && <p className="mt-2 text-muted-foreground">{latestAssessment.rationale}</p>}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{latestAssessment.assessed_branch_count}/{latestAssessment.branch_count} branch effects assessed</span>
                <span>{latestAssessment.unknown_likelihood_count} unknown likelihoods</span>
                <span>{latestAssessment.sensitivity_count} sensitivity cases</span>
              </div>
              {latestAssessment.next_information_needed && <div className="mt-2 flex gap-1.5 rounded bg-background/70 p-2"><CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{latestAssessment.next_information_needed}</span></div>}
            </div>
          ) : selectedScenario ? (
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">No immutable assessment has been recorded for this scenario yet.</div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}
