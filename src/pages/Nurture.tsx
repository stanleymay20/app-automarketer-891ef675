import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Mail, Plus, Trash2, Users, Clock, ShieldCheck, AlertCircle } from "lucide-react";
import {
  useNurtureSequences, useNurtureSteps, useSubscribers, useSubscriberCounts,
  useCreateSequence, useUpdateSequence, useDeleteSequence, useUpsertStep, useDeleteStep,
  useUnsubscribeSubscriber, type NurtureSequence, type NurtureStep,
} from "@/hooks/useNurture";

const STEP_TYPES = [
  { value: "welcome", label: "Welcome" },
  { value: "value", label: "Value" },
  { value: "proof", label: "Proof / Case study" },
  { value: "offer", label: "Offer" },
  { value: "reengagement", label: "Re-engagement" },
  { value: "custom", label: "Custom" },
];

function SequenceEditor({ sequence }: { sequence: NurtureSequence }) {
  const { data: steps = [] } = useNurtureSteps(sequence.id);
  const updateSeq = useUpdateSequence();
  const upsertStep = useUpsertStep();
  const deleteStep = useDeleteStep();
  const [editing, setEditing] = useState<Partial<NurtureStep> | null>(null);

  const openNew = () => {
    const nextOrder = (steps[steps.length - 1]?.step_order ?? 0) + 1;
    setEditing({
      sequence_id: sequence.id,
      step_order: nextOrder,
      step_type: nextOrder === 1 ? "welcome" : "value",
      delay_hours: nextOrder === 1 ? 0 : 48,
      subject: "",
      body_html: "",
      body_text: "",
      is_active: true,
    });
  };

  const saveStep = () => {
    if (!editing?.subject || !editing.sequence_id || editing.step_order == null) return;
    upsertStep.mutate(
      {
        id: editing.id,
        sequence_id: editing.sequence_id,
        step_order: editing.step_order,
        step_type: editing.step_type ?? "custom",
        delay_hours: editing.delay_hours ?? 24,
        subject: editing.subject,
        body_html: editing.body_html ?? null,
        body_text: editing.body_text ?? null,
        is_active: editing.is_active ?? true,
      },
      { onSuccess: () => setEditing(null) }
    );
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">{sequence.name}</CardTitle>
          <CardDescription>{steps.length} step{steps.length === 1 ? "" : "s"} · {sequence.trigger_type}</CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Active</span>
            <Switch
              checked={sequence.is_active}
              onCheckedChange={(v) => updateSeq.mutate({ id: sequence.id, is_active: v })}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.length === 0 && (
          <p className="text-sm text-muted-foreground">No steps yet. Add a welcome email to start.</p>
        )}
        {steps.map((s) => (
          <div key={s.id} className="flex items-center justify-between border rounded-lg p-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">#{s.step_order}</Badge>
                <Badge variant="outline" className="text-xs capitalize">{s.step_type}</Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {s.delay_hours === 0 ? "immediately" : `+${s.delay_hours}h`}
                </span>
              </div>
              <div className="text-sm font-medium truncate mt-1">{s.subject}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => deleteStep.mutate({ id: s.id, sequence_id: sequence.id })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Add step
        </Button>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit step" : "New step"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Order</Label>
                  <Input type="number" value={editing.step_order ?? 1}
                    onChange={(e) => setEditing({ ...editing, step_order: parseInt(e.target.value) || 1 })} />
                </div>
                <div>
                  <Label>Type</Label>
                  <Select value={editing.step_type ?? "custom"} onValueChange={(v) => setEditing({ ...editing, step_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STEP_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Delay (hours)</Label>
                  <Input type="number" value={editing.delay_hours ?? 24}
                    onChange={(e) => setEditing({ ...editing, delay_hours: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <div>
                <Label>Subject</Label>
                <Input value={editing.subject ?? ""} placeholder="Hey {{name}}, thanks for signing up"
                  onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
              </div>
              <div>
                <Label>Body (HTML)</Label>
                <Textarea rows={8} value={editing.body_html ?? ""}
                  placeholder="<p>Hi {{name}},</p><p>Here's what to try first...</p>"
                  onChange={(e) => setEditing({ ...editing, body_html: e.target.value })} />
                <p className="text-xs text-muted-foreground mt-1">Variables: <code>{"{{name}}"}</code>, <code>{"{{email}}"}</code>, <code>{"{{unsubscribe_url}}"}</code>. Unsubscribe link is appended automatically.</p>
              </div>
              <div>
                <Label>Plain text (fallback)</Label>
                <Textarea rows={4} value={editing.body_text ?? ""}
                  onChange={(e) => setEditing({ ...editing, body_text: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveStep} disabled={upsertStep.isPending}>Save step</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function Nurture() {
  const { data: sequences = [] } = useNurtureSequences();
  const { data: subs = [] } = useSubscribers();
  const { data: counts } = useSubscriberCounts();
  const createSeq = useCreateSequence();
  const deleteSeq = useDeleteSequence();
  const unsub = useUnsubscribeSubscriber();

  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);

  return (
    <DashboardLayout title="Nurture">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-primary" /> Lead Nurture
          </h1>
          <p className="text-sm text-muted-foreground">
            Turn captured leads into customers with short, consent-aware email sequences.
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">Sender setup:</span> To activate delivery, configure a verified sending domain in Cloud → Emails and deploy the transactional sender. Until then, due sends are queued (not lost) and everything else — enrollment, consent, unsubscribe — works.
          </div>
        </div>

        <Tabs defaultValue="sequences">
          <TabsList>
            <TabsTrigger value="sequences">Sequences</TabsTrigger>
            <TabsTrigger value="subscribers" className="gap-1.5">
              Subscribers
              {counts && <Badge variant="secondary">{counts.subscribed ?? 0}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sequences" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={showNew} onOpenChange={setShowNew}>
                <DialogTrigger asChild>
                  <Button className="gap-1"><Plus className="h-4 w-4" /> New sequence</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New nurture sequence</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>Name</Label>
                      <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Welcome flow" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Auto-enrolls new leads captured by any app when active. Add steps after creation.
                    </p>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
                    <Button
                      disabled={!newName.trim() || createSeq.isPending}
                      onClick={() => createSeq.mutate(
                        { name: newName.trim(), trigger_type: "lead_captured", is_active: false },
                        { onSuccess: () => { setShowNew(false); setNewName(""); } }
                      )}
                    >Create</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {sequences.length === 0 && (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  No sequences yet. Create your first Welcome flow to start converting captured leads.
                </CardContent>
              </Card>
            )}

            {sequences.map((s) => (
              <div key={s.id}>
                <div className="flex justify-end -mb-2 relative z-10">
                  <Button variant="ghost" size="sm" className="text-destructive"
                    onClick={() => { if (confirm(`Delete "${s.name}"?`)) deleteSeq.mutate(s.id); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <SequenceEditor sequence={s} />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="subscribers" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {(["subscribed", "pending", "unsubscribed", "bounced", "complained"] as const).map((k) => (
                <Card key={k}>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground capitalize">{k}</div>
                    <div className="text-2xl font-semibold">{counts?.[k] ?? 0}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> Recent subscribers
                </CardTitle>
                <CardDescription className="flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" /> Consent stored per subscriber. One-click unsubscribe included in every email.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {subs.length === 0 && <p className="text-sm text-muted-foreground">No subscribers yet. They'll appear here as leads come in.</p>}
                {subs.slice(0, 100).map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.name ?? "—"} · {s.consent_source ?? "unknown"} · {new Date(s.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={s.status === "subscribed" ? "default" : "secondary"} className="capitalize text-xs">{s.status}</Badge>
                      {s.status === "subscribed" && (
                        <Button variant="ghost" size="sm" onClick={() => unsub.mutate(s.id)}>Unsubscribe</Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
