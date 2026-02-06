import { Card, CardContent } from "@/components/ui/card";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useContent } from "@/hooks/useContent";
import { Rocket, Clock, Pause } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function AutopilotStatusCard() {
  const { data: settings } = useUserSettings();
  const { data: content } = useContent();

  const isAutopilot = settings?.autopilot_mode ?? false;

  // Find next scheduled post
  const upcomingPosts = (content || [])
    .filter((c) => c.status === "approved" && c.scheduled_for)
    .sort((a, b) => new Date(a.scheduled_for!).getTime() - new Date(b.scheduled_for!).getTime());

  const nextPost = upcomingPosts[0];

  if (!isAutopilot) {
    return (
      <Card className="bg-muted/50 border-dashed">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <Pause className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Approval Mode Active</p>
            <p className="text-sm text-muted-foreground">
              Posts require manual approval before publishing
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-r from-success/10 to-primary/10 border-success/20">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="h-10 w-10 rounded-full bg-success/20 flex items-center justify-center">
          <Rocket className="h-5 w-5 text-success" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-foreground">Autopilot Active</p>
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
          </div>
          {nextPost ? (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Next post in {formatDistanceToNow(new Date(nextPost.scheduled_for!))}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Generating and scheduling content automatically
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
