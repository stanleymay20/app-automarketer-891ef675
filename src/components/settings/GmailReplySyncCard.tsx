import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function GmailReplySyncCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: row } = useQuery({
    queryKey: ["autopilot-gmail-sync", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("autopilot_settings")
        .select("gmail_reply_sync_enabled, gmail_last_synced_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [enabled, setEnabled] = useState(false);
  useEffect(() => { setEnabled(!!row?.gmail_reply_sync_enabled); }, [row?.gmail_reply_sync_enabled]);

  const saveToggle = useMutation({
    mutationFn: async (v: boolean) => {
      if (!user) throw new Error("Not signed in");
      const { error } = await (supabase as any)
        .from("autopilot_settings")
        .upsert({ user_id: user.id, gmail_reply_sync_enabled: v }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot-gmail-sync"] });
      toast({ title: enabled ? "Gmail reply sync enabled" : "Gmail reply sync paused" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("gmail-check-replies", { body: { user_id: user!.id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      const r = data?.results?.[0];
      if (data?.error) {
        toast({ title: "Gmail not connected", description: data.error, variant: "destructive" });
      } else if (r) {
        toast({ title: "Gmail sync complete", description: `Scanned ${r.scanned}, matched ${r.matched}, recorded ${r.recorded}.` });
      } else {
        toast({ title: "Sync ran", description: "No users matched (enable the toggle first)." });
      }
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="h-4 w-4" /> Gmail reply sync
            <Badge variant="outline" className="ml-1">Read-only</Badge>
          </CardTitle>
          <CardDescription>
            Each hour, scan the project's connected Gmail inbox and record any new replies from your prospects.
            Matches are based on the sender's email address matching a prospect's <code>contact_email</code>.
            This never sends mail — Resend stays in charge of outreach.
          </CardDescription>
        </div>
        <Switch
          checked={enabled}
          disabled={saveToggle.isPending}
          onCheckedChange={(v) => { setEnabled(v); saveToggle.mutate(v); }}
          aria-label="Enable Gmail reply sync"
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Requires the <strong>Gmail Standard Connector</strong> linked to this project (Project Settings → Connectors → Google Mail) with
          the <code>gmail.readonly</code> scope. Connects the project owner's Gmail, not each end-user's.
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            {runNow.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Sync now
          </Button>
          <span className="text-xs text-muted-foreground">
            {row?.gmail_last_synced_at
              ? `Last synced ${new Date(row.gmail_last_synced_at).toLocaleString()}`
              : "Never synced"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
