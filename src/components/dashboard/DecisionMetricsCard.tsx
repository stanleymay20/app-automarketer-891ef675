// Decision-intelligence summary card for the Today dashboard.
// Aggregates pipeline EV, monthly expected vs actual, acceptance, meeting conversion,
// autopilot send volume, and surfaces the latest learning lessons.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp, Loader2 } from "lucide-react";
import { useDecisionDashboard, type LearningEvent } from "@/hooks/useDecisionDashboard";

function money(n: number) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n); }
  catch { return `€${Math.round(n)}`; }
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function DecisionMetricsCard() {
  const { data, isLoading } = useDecisionDashboard();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Expected outcomes</CardTitle>
            <CardDescription>This month, learning from your decisions.</CardDescription>
          </div>
          <TrendingUp className="h-5 w-5 text-primary" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !data ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Pipeline EV" value={money(data.pipeline_expected_value)} hint="Open prospects" />
              <Tile label="Expected revenue" value={money(data.expected_revenue_month)} hint="Open proposals" />
              <Tile label="Actual revenue" value={money(data.actual_revenue_month)} hint="Won this month" />
              <Tile label="Acceptance" value={`${data.proposal_acceptance_pct}%`} hint={`${data.proposals_decided} decided`} />
              <Tile label="Meeting completion" value={`${data.meeting_completion_pct}%`} />
              <Tile label="Meeting → proposal" value={`${data.meeting_to_proposal_pct}%`} />
              <Tile label="Autopilot sent" value={String(data.autopilot_sent_7d)} hint="Last 7d" />
              <Tile label="Δ vs expected"
                value={money(data.actual_revenue_month - data.expected_revenue_month)} />
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <p className="text-sm font-medium">Latest lessons</p>
              </div>
              {data.top_learning_lessons.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Lessons appear here after meeting and proposal outcomes are recorded.
                </p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {data.top_learning_lessons.map((l: LearningEvent) => (
                    <li key={l.id} className="flex items-start gap-2">
                      <Badge variant="outline" className="shrink-0 text-[10px]">{l.source_type}</Badge>
                      <span className="text-muted-foreground">{l.lesson}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
