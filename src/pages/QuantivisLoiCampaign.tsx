import { useMemo, useRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  quantivisLoiCampaignTemplate,
  quantivisLoiCsvExample,
} from "@/lib/quantivis-loi-campaign";
import { useImportProspects, parseProspectCsvDetailed } from "@/hooks/useProspects";
import { useApps } from "@/hooks/useApps";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Clock, FileText, ShieldCheck, Target, Upload, Users } from "lucide-react";

const template = quantivisLoiCampaignTemplate;

const statusOptions = {
  outreach: ["not_started", "drafted", "reviewed", "sent_manually", "replied", "declined"],
  loi: ["not_requested", "requested", "draft_sent", "signed", "declined"],
};

export default function QuantivisLoiCampaign() {
  const { data: apps } = useApps();
  const importer = useImportProspects();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // Resolve the Quantivis app id by name so imports from this page always
  // land scoped to the right offering, without the user having to remember
  // to pick it from a dropdown elsewhere.
  const quantivisAppId = useMemo(() => {
    const match = (apps ?? []).find((a: any) => /quantivis/i.test(a.name ?? ""));
    return match?.id;
  }, [apps]);

  const handleImport = async (file: File) => {
    const text = await file.text();
    const { rows, headersFound, headersRecognized } = parseProspectCsvDetailed(text);
    if (rows.length === 0) {
      const hasNameColumn = headersRecognized.includes("name");
      toast({
        title: "No valid rows found",
        description: !hasNameColumn
          ? `No "company_name" (or "name") column found. Columns in file: ${headersFound.join(", ") || "(none — is the file empty?)"}`
          : `Found a name column but every row was empty. Columns in file: ${headersFound.join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    if (!quantivisAppId) {
      toast({
        title: "Importing without an app scope",
        description: "No app named \"Quantivis\" was found, so these prospects will import under All offerings. Create/rename the app to scope them automatically next time.",
      });
    }
    importer.mutate({ appId: quantivisAppId, rows });
  };

  return (
    <DashboardLayout title="Quantivis LOI Outreach">
      <div className="space-y-6">
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Draft-only campaign</AlertTitle>
          <AlertDescription>
            This workflow prepares targeting, CSV structure, and outreach drafts only. It does not
            auto-send LinkedIn or email messages. Stanley must review and approve every message manually.
          </AlertDescription>
        </Alert>

        <Card className="shadow-card">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="font-display text-2xl">{template.name}</CardTitle>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{template.purpose}</p>
              </div>
              <Badge variant="secondary">EXIST LOI</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-5">
            <GoalMetric label="Companies contacted" value={template.goals.companiesContacted} />
            <GoalMetric label="Replies" value={template.goals.replies} />
            <GoalMetric label="Discovery calls" value={template.goals.discoveryCalls} />
            <GoalMetric label="Pilot discussions" value={template.goals.pilotDiscussions} />
            <GoalMetric label="Signed LOI" value={template.goals.signedLois} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-primary" /> Target audience
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {template.targetAudience.map((audience) => (
                <div key={audience} className="rounded-md border bg-card px-3 py-2 text-sm">
                  {audience}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-primary" /> Safe sending rules
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Rule label="Approval" value="No auto-send without Stanley approval" />
              <Rule label="LinkedIn cap" value={`${template.safeSendingRules.maxLinkedInDraftsPerDay} drafts/day`} />
              <Rule label="Email cap" value={`${template.safeSendingRules.maxEmailDraftsPerDay} drafts/day`} />
              <Rule
                label="Sending window"
                value={`${template.safeSendingRules.sendingWindow.start}–${template.safeSendingRules.sendingWindow.end} ${template.safeSendingRules.sendingWindow.timezone}`}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Target className="h-5 w-5 text-primary" /> ICP fields
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {template.icpFields.map((field) => (
              <div key={field.key} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{field.label}</p>
                  {field.required && <Badge variant="outline">Required</Badge>}
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{field.key}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-primary" /> CSV import/export format
              </CardTitle>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImport(f);
                    e.currentTarget.value = "";
                  }}
                />
                <Button size="sm" className="gap-1" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Import CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use this exact header order for Quantivis LOI target-company sheets. The Import CSV
              button above accepts this format directly — company_name, sector, decision_maker_role,
              reason_they_fit_quantivis, linkedin_url, email, and outreach_status all map onto the
              Prospects pipeline automatically, and loi_status is preserved in the prospect's notes.
            </p>
            <Textarea readOnly value={quantivisLoiCsvExample()} className="min-h-40 font-mono text-xs" />
            <div className="grid gap-2 md:grid-cols-2">
              <Rule label="Outreach status values" value={statusOptions.outreach.join(", ")} />
              <Rule label="LOI status values" value={statusOptions.loi.join(", ")} />
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 lg:grid-cols-2">
          {template.messageTemplates.map((message) => (
            <Card key={message.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{message.label}</CardTitle>
                  <Badge variant="secondary">{message.channel}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {message.subject && (
                  <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
                    <span className="font-medium">Subject: </span>
                    {message.subject}
                  </div>
                )}
                <Textarea readOnly value={message.body} className="min-h-44 text-sm" />
              </CardContent>
            </Card>
          ))}
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-primary" /> Manual operating checklist
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {[
              "Import or paste target companies using the CSV format above.",
              "Generate or copy drafts only; do not enable autopilot for this campaign.",
              "Review personalization fields before any LinkedIn or email send.",
              "Send only between 09:00 and 17:00 Germany time.",
              "Update outreach_status after manual contact.",
              "Move loi_status only after explicit prospect feedback.",
            ].map((item) => (
              <div key={item} className="flex gap-2 rounded-md border p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function GoalMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card p-3 text-center">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}
