import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useApps } from "@/hooks/useApps";
import { CheckCircle2, Loader2, Mail, ShieldCheck, Sparkles, Target, Users } from "lucide-react";

type DraftMessage = {
  id: string;
  prospect_id: string;
  subject: string | null;
  body: string;
  to_address: string;
  status: string;
  created_at: string;
};

type ProspectLite = {
  id: string;
  name: string | null;
  url: string | null;
  contact_email: string | null;
  contact_name: string | null;
  category: string;
  status: string | null;
};

const TARGET_DEFAULT = 200;

export default function BulkLoiOutreach() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: apps } = useApps();
  const primaryAppId = apps?.[0]?.id ?? null;

  const [target, setTarget] = useState<number>(TARGET_DEFAULT);

  const eligibleQuery = useQuery({
    queryKey: ["bulk-loi-eligible", primaryAppId],
    queryFn: async () => {
      const q = supabase
        .from("prospects")
        .select("id,name,url,contact_email,contact_name,category,status")
        .eq("category", "customer")
        .not("contact_email", "is", null)
        .neq("status", "dismissed")
        .order("prospect_score", { ascending: false })
        .limit(400);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ProspectLite[];
    },
  });

  const draftsQuery = useQuery({
    queryKey: ["bulk-loi-drafts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospect_messages")
        .select("id,prospect_id,subject,body,to_address,status,created_at")
        .eq("status", "pending_approval")
        .eq("channel", "email")
        .order("created_at", { ascending: false })
        .limit(250);
      if (error) throw error;
      return (data ?? []) as DraftMessage[];
    },
  });

  const draftedProspectIds = useMemo(
    () => new Set((draftsQuery.data ?? []).map((d) => d.prospect_id)),
    [draftsQuery.data],
  );
  const eligibleNotDrafted = useMemo(
    () => (eligibleQuery.data ?? []).filter((p) => !draftedProspectIds.has(p.id)),
    [eligibleQuery.data, draftedProspectIds],
  );

  const discoverMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("discover-prospects", {
        body: { app_id: primaryAppId, categories: ["customer"] },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: { created?: number } | null) => {
      toast({
        title: "Discovery run complete",
        description: `Added ${data?.created ?? 0} prospects this run. You can run this several times to grow the pool toward 200.`,
      });
      qc.invalidateQueries({ queryKey: ["bulk-loi-eligible"] });
    },
    onError: (e: Error) => toast({ title: "Discovery failed", description: e.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("bulk-loi-outreach", {
        body: { app_id: primaryAppId, target_count: target, category: "customer" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: { drafted?: number; eligible?: number; errors?: number } | null) => {
      toast({
        title: "Drafts generated",
        description: `Drafted ${data?.drafted ?? 0} of ${data?.eligible ?? 0} eligible (errors: ${data?.errors ?? 0}). All require your approval before sending.`,
      });
      qc.invalidateQueries({ queryKey: ["bulk-loi-drafts"] });
      qc.invalidateQueries({ queryKey: ["bulk-loi-eligible"] });
    },
    onError: (e: Error) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const approveSend = useMutation({
    mutationFn: async (draft: DraftMessage) => {
      const { data, error } = await supabase.functions.invoke("send-outreach", {
        body: {
          prospect_id: draft.prospect_id,
          subject: draft.subject ?? "",
          body: draft.body,
          to_address: draft.to_address,
          approved: true,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Approved & sent" });
      qc.invalidateQueries({ queryKey: ["bulk-loi-drafts"] });
    },
    onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const eligibleCount = eligibleNotDrafted.length;
  const draftCount = draftsQuery.data?.length ?? 0;

  return (
    <DashboardLayout title="Bulk LOI Outreach (200)">
      <div className="space-y-6">
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Draft-only by design</AlertTitle>
          <AlertDescription>
            This page generates up to 200 personalized Letter-of-Intent email drafts in one run, but
            does <strong>not</strong> send anything automatically. Every message is held as
            <code className="mx-1 rounded bg-muted px-1">pending_approval</code> and only ships when you
            click <em>Approve &amp; send</em> per row. Stay within your provider&apos;s daily limits
            and CAN-SPAM / GDPR requirements.
          </AlertDescription>
        </Alert>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-2xl">Generate 200 LOI email drafts</CardTitle>
            <p className="text-sm text-muted-foreground">
              Pulls customer-category prospects with a contact email, then asks the AI gateway to draft a
              short outbound email + non-binding LOI ask for each.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <Metric icon={<Users className="h-4 w-4" />} label="Eligible (not yet drafted)" value={eligibleCount} />
            <Metric icon={<Sparkles className="h-4 w-4" />} label="Drafts pending approval" value={draftCount} />
            <Metric icon={<Target className="h-4 w-4" />} label="Target this run" value={target} />
            <div className="rounded-md border p-3">
              <Label htmlFor="target" className="text-xs uppercase tracking-wide text-muted-foreground">Adjust target</Label>
              <Input
                id="target"
                type="number"
                min={1}
                max={200}
                value={target}
                onChange={(e) => setTarget(Math.max(1, Math.min(200, Number(e.target.value) || 0)))}
                className="mt-1"
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-primary" /> Step 1 &mdash; Grow the prospect pool
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Each discovery run adds up to 5 prospects per ICP. Click multiple times (rate-limited at
                ~5 calls/minute) until eligible reaches your target.
              </p>
              <Button
                onClick={() => discoverMutation.mutate()}
                disabled={discoverMutation.isPending || !primaryAppId}
                className="w-full"
              >
                {discoverMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Run discover-prospects (customer)
              </Button>
              {!primaryAppId && (
                <p className="text-xs text-amber-500">Create an app first so discovery has offering context.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mail className="h-5 w-5 text-primary" /> Step 2 &mdash; Draft up to {target} LOI emails
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Generates personalized drafts for eligible prospects who don&apos;t already have a
                message on file. Drafts are inserted as <code className="rounded bg-muted px-1">pending_approval</code>.
              </p>
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || eligibleCount === 0}
                className="w-full"
              >
                {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate drafts ({Math.min(target, eligibleCount)} eligible)
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="h-5 w-5 text-primary" /> Drafts awaiting approval
              </CardTitle>
              <Badge variant="secondary">{draftCount}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {draftsQuery.isLoading && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading drafts&hellip;
              </div>
            )}
            {!draftsQuery.isLoading && draftCount === 0 && (
              <p className="text-sm text-muted-foreground">No pending drafts yet. Generate some above.</p>
            )}
            {(draftsQuery.data ?? []).map((draft) => (
              <div key={draft.id} className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{draft.subject || "(no subject)"}</p>
                    <p className="font-mono text-xs text-muted-foreground">to {draft.to_address}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => approveSend.mutate(draft)}
                    disabled={approveSend.isPending}
                  >
                    {approveSend.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Approve &amp; send
                  </Button>
                </div>
                <Textarea readOnly value={draft.body} className="mt-2 min-h-32 text-xs" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
