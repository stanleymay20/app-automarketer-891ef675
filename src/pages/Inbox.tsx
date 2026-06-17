import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Inbox as InboxIcon, Loader2, Plus, Mail, Linkedin, MessageSquare, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { useReplies, useRecordReply, type ReplyChannel } from "@/hooks/useReplies";
import { useProspects } from "@/hooks/useProspects";

const CHANNEL_ICON: Record<string, any> = {
  email: Mail, linkedin: Linkedin, x: MessageSquare, manual: MessageSquare, other: MessageSquare,
};

export default function Inbox() {
  const { data: replies = [], isLoading } = useReplies();
  const { data: prospects = [] } = useProspects();
  const record = useRecordReply();

  const [open, setOpen] = useState(false);
  const [prospectId, setProspectId] = useState<string>("");
  const [channel, setChannel] = useState<ReplyChannel>("email");
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Default prospect selection when dialog opens
  useEffect(() => {
    if (open && !prospectId && prospects.length) setProspectId(prospects[0].id);
  }, [open, prospectId, prospects]);

  const prospectById = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of prospects) m.set(p.id, p);
    return m;
  }, [prospects]);

  const submit = () => {
    if (!prospectId || !body.trim()) return;
    record.mutate(
      {
        prospect_id: prospectId,
        channel,
        from_address: fromAddress.trim() || undefined,
        subject: subject.trim() || undefined,
        body: body.trim(),
      },
      {
        onSuccess: () => {
          setOpen(false);
          setFromAddress(""); setSubject(""); setBody("");
        },
      },
    );
  };

  return (
    <DashboardLayout title="Inbox">
      <div className="space-y-6">
        <Card className="shadow-card border-primary/20 bg-gradient-to-br from-primary/5 to-secondary/5">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-xl font-bold">Reply Inbox</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every reply from a prospect, in one place. Recording a reply moves the prospect
                to <strong>Responded</strong> and logs it to the activity feed.
              </p>
            </div>
            <Button
              onClick={() => setOpen(true)}
              disabled={!prospects.length}
              className="bg-gradient-to-r from-primary to-secondary text-primary-foreground"
            >
              <Plus className="mr-2 h-4 w-4" /> Record reply
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card><CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading replies…
          </CardContent></Card>
        ) : replies.length === 0 ? (
          <Card className="shadow-card">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <InboxIcon className="h-10 w-10 text-muted-foreground/60" />
              <h3 className="font-display text-lg font-semibold">No replies yet</h3>
              <p className="max-w-md text-sm text-muted-foreground">
                When a prospect replies to your outreach, record it here. The prospect's stage
                will auto-advance to Responded. Gmail and Outlook polling can be added later
                without changing this page.
              </p>
              {prospects.length > 0 && (
                <Button variant="outline" onClick={() => setOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Record your first reply
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {replies.map((r) => {
              const Icon = CHANNEL_ICON[r.channel] || MessageSquare;
              const p = r.prospect || prospectById.get(r.prospect_id);
              return (
                <Card key={r.id} className="shadow-card">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-primary" />
                        <CardTitle className="truncate text-base">
                          {r.subject || r.from_name || r.from_address || "(no subject)"}
                        </CardTitle>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="text-[10px] capitalize">{r.channel}</Badge>
                        <Badge variant="secondary" className="text-[10px] capitalize">{r.source}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(r.received_at), "MMM d, h:mm a")}
                        </span>
                      </div>
                    </div>
                    {p && (
                      <Link
                        to={`/prospects?focus=${p.id}`}
                        className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                      >
                        From <strong className="text-foreground">{p.contact_name || p.name}</strong>
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0">
                    {r.from_address && (
                      <p className="mb-1 text-xs text-muted-foreground">{r.from_address}</p>
                    )}
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {r.body || <span className="italic text-muted-foreground">(empty body)</span>}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Record reply dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a reply</DialogTitle>
            <DialogDescription>
              Paste what the prospect said. This will move them to Responded and update Today.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Prospect</Label>
              <Select value={prospectId} onValueChange={setProspectId}>
                <SelectTrigger><SelectValue placeholder="Select prospect" /></SelectTrigger>
                <SelectContent>
                  {prospects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{p.contact_name ? ` — ${p.contact_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Channel</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as ReplyChannel)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="x">X / Twitter</SelectItem>
                    <SelectItem value="manual">Manual note</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">From (optional)</Label>
                <Input
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  placeholder="name@company.com"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Subject (optional)</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Re: your message" />
            </div>
            <div>
              <Label className="text-xs">Reply body</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder="Paste the prospect's reply here…"
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={record.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!prospectId || !body.trim() || record.isPending}
              className="bg-gradient-to-r from-primary to-secondary text-primary-foreground"
            >
              {record.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" /> Record reply</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
