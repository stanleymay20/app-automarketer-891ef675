import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BookOpen, Copy, ExternalLink, Link2, Loader2, Megaphone, Plus, ReceiptText,
  Users, MousePointerClick, BadgeDollarSign, BarChart3, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useApps } from "@/hooks/useApps";
import { useDiscoverDistribution, useDistribution } from "@/hooks/useDistribution";
import {
  useAddBookPromoter,
  useAddPromotionPlacement,
  useBookGrowth,
  useCreatePromotionAssignment,
  useSaveBookProfile,
  type PromotionAssignment,
} from "@/hooks/useBookMarketing";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

function splitCsv(value: string) {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

function trackedUrl(token: string) {
  if (!supabaseUrl) return "";
  return `${supabaseUrl}/functions/v1/track-book-promo/${token}`;
}

export default function BookMarketing() {
  const { data: apps, isLoading: appsLoading } = useApps();
  const bookApps = useMemo(() => (apps ?? []).filter((a) => a.offering_type === "Book"), [apps]);
  const [appId, setAppId] = useState<string>("");
  const { data, isLoading } = useBookGrowth(appId || undefined);
  const saveProfile = useSaveBookProfile();
  const addPromoter = useAddBookPromoter();
  const addAssignment = useCreatePromotionAssignment();
  const addPlacement = useAddPromotionPlacement();
  const discoverDistribution = useDiscoverDistribution();
  const { data: distribution } = useDistribution(appId || undefined);

  const [profileForm, setProfileForm] = useState({
    title: "",
    subtitle: "",
    author_name: "",
    isbn_paperback: "",
    isbn_hardcover: "",
    isbn_epub: "",
    asin: "",
    primary_conversion_url: "",
    genres: "",
    themes: "",
    markets: "",
    launch_stage: "prelaunch",
    launch_date: "",
    review_goal: "",
    sales_goal: "",
  });

  const [promoterForm, setPromoterForm] = useState({
    name: "",
    profile_url: "",
    email: "",
    organization: "",
    fee: "",
    fee_currency: "EUR",
    notes: "",
  });

  const [assignmentForm, setAssignmentForm] = useState({
    promoter_id: "",
    platform: "facebook",
    community_name: "",
    destination_url: "",
    audience_size_claimed: "",
    budget: "",
    budget_currency: "EUR",
  });

  const [placementTarget, setPlacementTarget] = useState<PromotionAssignment | null>(null);
  const [placementForm, setPlacementForm] = useState({
    post_url: "",
    evidence_url: "",
    audience_size_claimed: "",
    impressions_reported: "",
    engagements_reported: "",
    conversions_reported: "",
    revenue_reported: "",
    posted_at: "",
    notes: "",
  });

  useEffect(() => {
    if (!appId && bookApps.length) setAppId(bookApps[0].id);
  }, [appId, bookApps]);

  useEffect(() => {
    if (!data?.profile) {
      const app = bookApps.find((a) => a.id === appId);
      setProfileForm((prev) => ({
        ...prev,
        title: app?.name ?? "",
        primary_conversion_url: app?.website_url ?? "",
      }));
      return;
    }
    const p = data.profile;
    setProfileForm({
      title: p.title ?? "",
      subtitle: p.subtitle ?? "",
      author_name: p.author_name ?? "",
      isbn_paperback: p.isbn_paperback ?? "",
      isbn_hardcover: p.isbn_hardcover ?? "",
      isbn_epub: p.isbn_epub ?? "",
      asin: p.asin ?? "",
      primary_conversion_url: p.primary_conversion_url ?? "",
      genres: (p.genres ?? []).join(", "),
      themes: (p.themes ?? []).join(", "),
      markets: (p.markets ?? []).join(", "),
      launch_stage: p.launch_stage ?? "prelaunch",
      launch_date: p.launch_date ?? "",
      review_goal: p.review_goal?.toString() ?? "",
      sales_goal: p.sales_goal?.toString() ?? "",
    });
  }, [data?.profile, appId, bookApps]);

  const clickCountByAssignment = useMemo(() => {
    const map = new Map<string, number>();
    for (const click of data?.clicks ?? []) map.set(click.assignment_id, (map.get(click.assignment_id) ?? 0) + 1);
    return map;
  }, [data?.clicks]);

  const totals = useMemo(() => {
    const assignments = data?.assignments ?? [];
    const placements = data?.placements ?? [];
    return {
      assignments: assignments.length,
      clicks: data?.clicks.length ?? 0,
      claimedAudience: assignments.reduce((sum, a) => sum + Number(a.audience_size_claimed ?? 0), 0),
      impressionsReported: placements.reduce((sum, p) => sum + Number(p.impressions_reported ?? 0), 0),
      engagementsReported: placements.reduce((sum, p) => sum + Number(p.engagements_reported ?? 0), 0),
      conversionsReported: placements.reduce((sum, p) => sum + Number(p.conversions_reported ?? 0), 0),
      revenueReported: placements.reduce((sum, p) => sum + Number(p.revenue_reported ?? 0), 0),
    };
  }, [data]);

  const promoterName = (id: string | null) => data?.promoters.find((p) => p.id === id)?.name ?? "Direct / internal";

  const onSaveProfile = () => {
    if (!appId || !profileForm.title.trim()) return;
    saveProfile.mutate({
      app_id: appId,
      title: profileForm.title.trim(),
      subtitle: profileForm.subtitle.trim() || null,
      author_name: profileForm.author_name.trim() || null,
      isbn_paperback: profileForm.isbn_paperback.trim() || null,
      isbn_hardcover: profileForm.isbn_hardcover.trim() || null,
      isbn_epub: profileForm.isbn_epub.trim() || null,
      asin: profileForm.asin.trim() || null,
      primary_conversion_url: profileForm.primary_conversion_url.trim() || null,
      genres: splitCsv(profileForm.genres),
      themes: splitCsv(profileForm.themes),
      markets: splitCsv(profileForm.markets),
      launch_stage: profileForm.launch_stage as any,
      launch_date: profileForm.launch_date || null,
      review_goal: profileForm.review_goal ? Number(profileForm.review_goal) : null,
      sales_goal: profileForm.sales_goal ? Number(profileForm.sales_goal) : null,
    });
  };

  if (appsLoading) {
    return <DashboardLayout title="Book Marketing"><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin" /></div></DashboardLayout>;
  }

  if (!bookApps.length) {
    return (
      <DashboardLayout title="Book Marketing">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>No book offering yet</CardTitle>
            <CardDescription>Create an offering with type “Book” first. ScrollMarketer will then attach the book-specific growth layer without changing your other products or SaaS campaigns.</CardDescription>
          </CardHeader>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Book Marketing">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><BookOpen className="h-6 w-6" /> Book Growth OS</h1>
            <p className="text-sm text-muted-foreground">Reader acquisition, human promoters, community placements and measurable attribution — in one control surface.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="default" className="gap-2" disabled={!appId || !data?.profile}>
              <Link to={appId ? `/orchestrator?app=${appId}` : "/orchestrator"}>
                <BookOpen className="h-4 w-4" /> Build launch campaign
              </Link>
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled={!appId || !data?.profile || discoverDistribution.isPending}
              onClick={() => discoverDistribution.mutate({ appId })}
            >
              {discoverDistribution.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
              Discover reader channels
            </Button>
            <Select value={appId} onValueChange={setAppId}>
              <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select a book" /></SelectTrigger>
              <SelectContent>
                {bookApps.map((app) => <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          {[
            { label: "Assignments", value: totals.assignments, icon: Megaphone },
            { label: "Tracked clicks", value: totals.clicks, icon: MousePointerClick },
            { label: "Claimed audience", value: totals.claimedAudience.toLocaleString(), icon: Users },
            { label: "Reported impressions", value: totals.impressionsReported.toLocaleString(), icon: BarChart3 },
            { label: "Reported conversions", value: totals.conversionsReported, icon: ShieldCheck },
            { label: "Reported revenue", value: `€${totals.revenueReported.toFixed(2)}`, icon: BadgeDollarSign },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <Icon className="mb-2 h-4 w-4 text-primary" />
                <div className="text-xl font-bold">{value}</div>
                <div className="text-[11px] text-muted-foreground">{label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Book identity & conversion target</CardTitle>
            <CardDescription>Keep retailer identity separate from campaign claims. “Claimed audience” is never treated as actual reach.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["title", "Title"], ["subtitle", "Subtitle"], ["author_name", "Author"],
              ["isbn_paperback", "Paperback ISBN"], ["isbn_hardcover", "Hardcover ISBN"],
              ["isbn_epub", "EPUB ISBN"], ["asin", "Amazon ASIN"], ["primary_conversion_url", "Primary retailer / landing URL"],
              ["genres", "Genres (comma-separated)"], ["themes", "Themes / topics"], ["markets", "Priority markets"],
              ["launch_date", "Launch date"],
            ].map(([key, label]) => (
              <div key={key} className={key === "primary_conversion_url" ? "xl:col-span-2" : ""}>
                <Label>{label}</Label>
                <Input
                  type={key === "launch_date" ? "date" : "text"}
                  value={(profileForm as any)[key]}
                  onChange={(e) => setProfileForm((p) => ({ ...p, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <Label>Launch stage</Label>
              <Select value={profileForm.launch_stage} onValueChange={(v) => setProfileForm((p) => ({ ...p, launch_stage: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prelaunch">Prelaunch</SelectItem>
                  <SelectItem value="launch">Launch</SelectItem>
                  <SelectItem value="evergreen">Evergreen</SelectItem>
                  <SelectItem value="relaunch">Relaunch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Review goal</Label><Input type="number" min="0" value={profileForm.review_goal} onChange={(e) => setProfileForm((p) => ({ ...p, review_goal: e.target.value }))} /></div>
            <div><Label>Sales goal</Label><Input type="number" min="0" value={profileForm.sales_goal} onChange={(e) => setProfileForm((p) => ({ ...p, sales_goal: e.target.value }))} /></div>
            <div className="flex items-end"><Button onClick={onSaveProfile} disabled={saveProfile.isPending} className="w-full">{saveProfile.isPending ? "Saving…" : "Save book profile"}</Button></div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.7fr]">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle>External promoters</CardTitle>
                  <CardDescription>People or agencies executing placements outside ScrollMarketer's direct APIs.</CardDescription>
                </div>
                <Dialog>
                  <DialogTrigger asChild><Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add promoter</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <div><Label>Name</Label><Input value={promoterForm.name} onChange={(e) => setPromoterForm((p) => ({ ...p, name: e.target.value }))} /></div>
                      <div><Label>Profile URL</Label><Input value={promoterForm.profile_url} onChange={(e) => setPromoterForm((p) => ({ ...p, profile_url: e.target.value }))} /></div>
                      <div><Label>Organization</Label><Input value={promoterForm.organization} onChange={(e) => setPromoterForm((p) => ({ ...p, organization: e.target.value }))} /></div>
                      <div><Label>Email</Label><Input value={promoterForm.email} onChange={(e) => setPromoterForm((p) => ({ ...p, email: e.target.value }))} /></div>
                      <div className="grid grid-cols-2 gap-3"><div><Label>Fee</Label><Input type="number" value={promoterForm.fee} onChange={(e) => setPromoterForm((p) => ({ ...p, fee: e.target.value }))} /></div><div><Label>Currency</Label><Input value={promoterForm.fee_currency} onChange={(e) => setPromoterForm((p) => ({ ...p, fee_currency: e.target.value }))} /></div></div>
                      <div><Label>Notes</Label><Textarea value={promoterForm.notes} onChange={(e) => setPromoterForm((p) => ({ ...p, notes: e.target.value }))} /></div>
                      <Button disabled={!promoterForm.name.trim() || addPromoter.isPending} onClick={() => addPromoter.mutate({
                        app_id: appId, name: promoterForm.name.trim(), profile_url: promoterForm.profile_url || null,
                        email: promoterForm.email || null, organization: promoterForm.organization || null,
                        fee: promoterForm.fee ? Number(promoterForm.fee) : null, fee_currency: promoterForm.fee_currency,
                        notes: promoterForm.notes || null, status: "candidate",
                      })}>Add promoter</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.promoters ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No external promoters yet.</p> :
                  data?.promoters.map((p) => (
                    <div key={p.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2"><div className="font-medium">{p.name}</div><Badge variant="outline">{p.status}</Badge></div>
                      {p.organization && <div className="text-xs text-muted-foreground">{p.organization}</div>}
                      <div className="mt-2 flex items-center gap-3 text-xs">
                        {p.profile_url && <a className="inline-flex items-center gap-1 text-primary hover:underline" href={p.profile_url} target="_blank" rel="noreferrer">Profile <ExternalLink className="h-3 w-3" /></a>}
                        {p.fee != null && <span>{p.fee_currency} {Number(p.fee).toFixed(2)}</span>}
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle>Promotion assignments</CardTitle>
                  <CardDescription>Each assignment gets its own redirect URL so actual clicks can be measured independently of claimed group size.</CardDescription>
                </div>
                <Dialog>
                  <DialogTrigger asChild><Button size="sm" className="gap-1" disabled={!data?.profile}><Plus className="h-4 w-4" /> Assignment</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Create promotion assignment</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <div><Label>Promoter</Label><Select value={assignmentForm.promoter_id || "internal"} onValueChange={(v) => setAssignmentForm((p) => ({ ...p, promoter_id: v === "internal" ? "" : v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="internal">Direct / internal</SelectItem>{data?.promoters.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
                      <div className="grid grid-cols-2 gap-3"><div><Label>Platform</Label><Input value={assignmentForm.platform} onChange={(e) => setAssignmentForm((p) => ({ ...p, platform: e.target.value }))} /></div><div><Label>Community / placement</Label><Input value={assignmentForm.community_name} onChange={(e) => setAssignmentForm((p) => ({ ...p, community_name: e.target.value }))} /></div></div>
                      <div><Label>Destination URL</Label><Input value={assignmentForm.destination_url || profileForm.primary_conversion_url} onChange={(e) => setAssignmentForm((p) => ({ ...p, destination_url: e.target.value }))} placeholder="Amazon, retailer, landing page…" /></div>
                      <div className="grid grid-cols-2 gap-3"><div><Label>Claimed audience size</Label><Input type="number" min="0" value={assignmentForm.audience_size_claimed} onChange={(e) => setAssignmentForm((p) => ({ ...p, audience_size_claimed: e.target.value }))} /></div><div><Label>Budget</Label><Input type="number" min="0" value={assignmentForm.budget} onChange={(e) => setAssignmentForm((p) => ({ ...p, budget: e.target.value }))} /></div></div>
                      <Button disabled={!data?.profile || !assignmentForm.platform.trim() || !(assignmentForm.destination_url || profileForm.primary_conversion_url) || addAssignment.isPending} onClick={() => addAssignment.mutate({
                        app_id: appId, book_profile_id: data!.profile!.id, promoter_id: assignmentForm.promoter_id || null,
                        platform: assignmentForm.platform.trim(), community_name: assignmentForm.community_name || null,
                        destination_url: assignmentForm.destination_url || profileForm.primary_conversion_url,
                        audience_size_claimed: assignmentForm.audience_size_claimed ? Number(assignmentForm.audience_size_claimed) : null,
                        budget: assignmentForm.budget ? Number(assignmentForm.budget) : null, budget_currency: assignmentForm.budget_currency,
                      })}>Create assignment</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.assignments ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No measurable assignments yet.</p> :
                  data?.assignments.map((a) => {
                    const url = trackedUrl(a.tracking_token);
                    const clicks = clickCountByAssignment.get(a.id) ?? 0;
                    const placements = data?.placements.filter((p) => p.assignment_id === a.id) ?? [];
                    return (
                      <div key={a.id} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{a.platform}{a.community_name ? ` · ${a.community_name}` : ""}</div>
                            <div className="text-xs text-muted-foreground">{promoterName(a.promoter_id)} · {a.status}</div>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => { if (!url) return; navigator.clipboard.writeText(url); toast.success("Tracked URL copied"); }} className="gap-1"><Copy className="h-3.5 w-3.5" /> Link</Button>
                            <Button size="sm" variant="outline" onClick={() => setPlacementTarget(a)} className="gap-1"><ReceiptText className="h-3.5 w-3.5" /> Evidence</Button>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                          <div className="rounded bg-muted/40 p-2"><div className="font-bold">{clicks}</div><div className="text-muted-foreground">actual clicks</div></div>
                          <div className="rounded bg-muted/40 p-2"><div className="font-bold">{Number(a.audience_size_claimed ?? 0).toLocaleString()}</div><div className="text-muted-foreground">claimed members</div></div>
                          <div className="rounded bg-muted/40 p-2"><div className="font-bold">{placements.reduce((s,p) => s + Number(p.impressions_reported ?? 0), 0).toLocaleString()}</div><div className="text-muted-foreground">reported impressions</div></div>
                          <div className="rounded bg-muted/40 p-2"><div className="font-bold">{placements.length}</div><div className="text-muted-foreground">evidence rows</div></div>
                        </div>
                        {url && <div className="mt-2 flex items-center gap-1 truncate text-[11px] text-muted-foreground"><Link2 className="h-3 w-3 shrink-0" /><span className="truncate">{url}</span></div>}
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          </div>
        )}

        {(distribution?.targets?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Top reader-acquisition opportunities</CardTitle>
              <CardDescription>Evidence-ranked targets from the shared Distribution Intelligence engine. Large communities do not automatically rank highly.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {distribution!.targets.slice(0, 6).map((t) => (
                <div key={t.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.target_type}{t.platform ? ` · ${t.platform}` : ""}</div>
                    </div>
                    <Badge>{t.distribution_score}</Badge>
                  </div>
                  {t.rationale && <p className="mt-2 text-xs text-muted-foreground">{t.rationale}</p>}
                  <div className="mt-3 flex gap-3 text-[11px]">
                    <span>Fit {t.audience_fit}</span>
                    <span>Conversion {t.conversion_potential}</span>
                    <span>Reach {t.reach_potential}</span>
                  </div>
                  {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">Inspect target <ExternalLink className="h-3 w-3" /></a>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>Measurement rule</CardTitle>
            <CardDescription>ScrollMarketer intentionally keeps four different quantities separate: claimed community membership, promoter-reported impressions, independently tracked clicks, and reported conversions/revenue. A “million-member audience” is not treated as a million people reached.</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Dialog open={!!placementTarget} onOpenChange={(o) => !o && setPlacementTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log placement evidence</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Post URL</Label><Input value={placementForm.post_url} onChange={(e) => setPlacementForm((p) => ({ ...p, post_url: e.target.value }))} /></div>
            <div><Label>Evidence URL / screenshot link</Label><Input value={placementForm.evidence_url} onChange={(e) => setPlacementForm((p) => ({ ...p, evidence_url: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Reported impressions</Label><Input type="number" min="0" value={placementForm.impressions_reported} onChange={(e) => setPlacementForm((p) => ({ ...p, impressions_reported: e.target.value }))} /></div><div><Label>Reported engagements</Label><Input type="number" min="0" value={placementForm.engagements_reported} onChange={(e) => setPlacementForm((p) => ({ ...p, engagements_reported: e.target.value }))} /></div></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Reported conversions</Label><Input type="number" min="0" value={placementForm.conversions_reported} onChange={(e) => setPlacementForm((p) => ({ ...p, conversions_reported: e.target.value }))} /></div><div><Label>Reported revenue</Label><Input type="number" min="0" value={placementForm.revenue_reported} onChange={(e) => setPlacementForm((p) => ({ ...p, revenue_reported: e.target.value }))} /></div></div>
            <div><Label>Posted at</Label><Input type="datetime-local" value={placementForm.posted_at} onChange={(e) => setPlacementForm((p) => ({ ...p, posted_at: e.target.value }))} /></div>
            <div><Label>Notes</Label><Textarea value={placementForm.notes} onChange={(e) => setPlacementForm((p) => ({ ...p, notes: e.target.value }))} /></div>
            <Button disabled={!placementTarget || addPlacement.isPending} onClick={() => placementTarget && addPlacement.mutate({
              app_id: appId, assignment_id: placementTarget.id, platform: placementTarget.platform,
              community_name: placementTarget.community_name, post_url: placementForm.post_url || null,
              evidence_url: placementForm.evidence_url || null,
              impressions_reported: placementForm.impressions_reported ? Number(placementForm.impressions_reported) : null,
              engagements_reported: placementForm.engagements_reported ? Number(placementForm.engagements_reported) : null,
              conversions_reported: placementForm.conversions_reported ? Number(placementForm.conversions_reported) : 0,
              revenue_reported: placementForm.revenue_reported ? Number(placementForm.revenue_reported) : 0,
              posted_at: placementForm.posted_at ? new Date(placementForm.posted_at).toISOString() : null,
              notes: placementForm.notes || null,
            }, { onSuccess: () => setPlacementTarget(null) })}>Save evidence</Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
