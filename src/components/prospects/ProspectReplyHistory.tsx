import { useReplies } from "@/hooks/useReplies";
import { Loader2, MessageSquare } from "lucide-react";
import { format } from "date-fns";

/**
 * Drop-in panel that lists all replies for a single prospect, newest first.
 * Use inside any prospect detail view: <ProspectReplyHistory prospectId={p.id} />
 */
export function ProspectReplyHistory({ prospectId }: { prospectId: string }) {
  const { data: replies = [], isLoading } = useReplies({ prospectId });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading replies…
      </div>
    );
  }
  if (!replies.length) {
    return (
      <div className="flex flex-col items-center gap-1 py-6 text-center text-xs text-muted-foreground">
        <MessageSquare className="h-5 w-5 opacity-50" />
        No replies recorded yet.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {replies.map((r) => (
        <li key={r.id} className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="capitalize">{r.channel} · {r.source}</span>
            <span>{format(new Date(r.received_at), "MMM d, h:mm a")}</span>
          </div>
          {r.subject && <p className="text-xs font-medium text-foreground">{r.subject}</p>}
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{r.body}</p>
        </li>
      ))}
    </ul>
  );
}
