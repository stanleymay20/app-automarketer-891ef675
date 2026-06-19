import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sunrise, Loader2, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react";
import { useLatestDawnRun, useRunDawnNow } from "@/hooks/useDawnAutopilot";
import { useUserSettings } from "@/hooks/useUserSettings";

export default function DawnAutopilotCard() {
  const { data: settings } = useUserSettings();
  const { data: run } = useLatestDawnRun();
  const runNow = useRunDawnNow();
  const enabled = (settings as any)?.dawn_autopilot_enabled ?? false;

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Sunrise className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-base font-display">Dawn Marketing Autopilot</CardTitle>
        </div>
        <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "Enabled" : "Off"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {run ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              {run.status === "completed" ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : run.status === "partial" ? (
                <AlertCircle className="h-4 w-4 text-amber-500" />
              ) : run.status === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="capitalize">{run.status}</span>
              <span className="text-muted-foreground">· {new Date(run.started_at).toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Stat label="Discovered" value={run.prospects_discovered} />
              <Stat label="Auto-sent" value={run.prospects_auto_sent} />
              <Stat label="Review" value={run.prospects_sent_to_review} />
              <Stat label="Content" value={run.content_generated} />
            </div>
            {run.summary && <p className="text-sm text-muted-foreground">{run.summary}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No runs yet. {enabled ? "Your first Dawn run will happen at your configured time." : "Enable Dawn Autopilot to start each morning automatically."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
          >
            {runNow.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Run now
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings/dawn-autopilot">Settings <ArrowRight className="ml-1 h-3 w-3" /></Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="text-base font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
