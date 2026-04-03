import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useGrowthGoals, useCreateGrowthGoal } from "@/hooks/useGrowthGoals";
import { useApps } from "@/hooks/useApps";
import { Target, Plus, CalendarIcon, TrendingUp, Loader2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { cn } from "@/lib/utils";

const goalTypeLabels: Record<string, { label: string; color: string }> = {
  signups: { label: "Signups", color: "bg-success/10 text-success" },
  traffic: { label: "Traffic", color: "bg-info/10 text-info" },
  awareness: { label: "Awareness", color: "bg-primary/10 text-primary" },
  engagement: { label: "Engagement", color: "bg-warning/10 text-warning" },
};

export function GrowthGoalsSection() {
  const { data: goals, isLoading } = useGrowthGoals();
  const { data: apps } = useApps();
  const createGoal = useCreateGrowthGoal();
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [goalType, setGoalType] = useState("awareness");
  const [targetValue, setTargetValue] = useState(100);
  const [endDate, setEndDate] = useState<Date>(addDays(new Date(), 30));

  const handleCreate = async () => {
    if (!appId) return;
    await createGoal.mutateAsync({
      app_id: appId,
      goal_type: goalType,
      target_value: targetValue,
      end_date: endDate.toISOString().split("T")[0],
    });
    setOpen(false);
    setAppId("");
    setGoalType("awareness");
    setTargetValue(100);
    setEndDate(addDays(new Date(), 30));
  };

  if (isLoading) {
    return <div className="h-48 rounded-lg bg-muted animate-pulse" />;
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-display flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Growth Goals
            </CardTitle>
            <CardDescription>
              Set measurable targets so the engine knows what to optimize for.
            </CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" />
                New Goal
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Growth Goal</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>App</Label>
                  <Select value={appId} onValueChange={setAppId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an app" />
                    </SelectTrigger>
                    <SelectContent>
                      {apps?.map((app) => (
                        <SelectItem key={app.id} value={app.id}>
                          {app.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Goal Type</Label>
                  <Select value={goalType} onValueChange={setGoalType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="signups">Signups</SelectItem>
                      <SelectItem value="traffic">Traffic</SelectItem>
                      <SelectItem value="awareness">Awareness</SelectItem>
                      <SelectItem value="engagement">Engagement</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Target Value</Label>
                  <Input
                    type="number"
                    min={1}
                    value={targetValue}
                    onChange={(e) => setTargetValue(parseInt(e.target.value) || 100)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The number you want to reach by the deadline.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Deadline</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !endDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={(d) => d && setEndDate(d)}
                        disabled={(date) => date < new Date()}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <Button
                  onClick={handleCreate}
                  disabled={!appId || createGoal.isPending}
                  className="w-full"
                >
                  {createGoal.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Create Goal
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(!goals || goals.length === 0) ? (
          <div className="rounded-xl border-2 border-dashed border-border bg-muted/30 p-8 text-center">
            <Target className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="font-semibold text-foreground mb-1">No active goals</p>
            <p className="text-sm text-muted-foreground mb-3">
              Set a growth goal so the engine knows what to optimize for.
            </p>
          </div>
        ) : (
          goals.map((goal) => {
            const meta = goalTypeLabels[goal.goal_type] || goalTypeLabels.awareness;
            const progress = Math.min(100, Math.round((goal.current_value / goal.target_value) * 100));
            const daysLeft = Math.max(0, Math.ceil((new Date(goal.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

            return (
              <div key={goal.id} className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge className={meta.color}>{meta.label}</Badge>
                  <span className="text-xs text-muted-foreground">{daysLeft}d remaining</span>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">
                    {goal.current_value} / {goal.target_value}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
