import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useMarketingReadiness, useChannelSpend, useAddChannelSpend, useDeleteChannelSpend,
  useMmmRuns, useComputeMmm,
} from "@/hooks/useMarketingIntelligence";
import { Activity, AlertTriangle, CheckCircle2, Gauge, Loader2, Plus, RefreshCw, Trash2, TrendingUp, Info } from "lucide-react";

const CHANNELS = ["linkedin", "x", "email", "google_ads", "meta_ads", "seo", "content", "referral", "other"];

function pctColor(v: number) {
  if (v >= 85) return "text-green-600";
  if (v >= 70) return "text-primary";
  if (v >= 50) return "text-amber-600";
  return "text-destructive";
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${pctColor(value)}`}>{value.toFixed(0)}%</span>
      </div>
      <Progress value={value} className="h-1.5" />
    </div>
  );
}

function AddSpendDialog({ appId }: { appId?: string }) {
  const add = useAddChannelSpend();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    channel: "linkedin",
    spend_amount: "",
    currency: "USD",
    campaign_name: "",
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1.5" />Add spend</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record marketing spend</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><Label className="text-xs">Channel</Label>
              <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Amount</Label>
              <Input type="number" step="0.01" value={form.spend_amount} onChange={(e) => setForm({ ...form, spend_amount: e.target.value })} /></div>
            <div><Label className="text-xs">Currency</Label>
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
          </div>
          <div><Label className="text-xs">Campaign name (optional)</Label>
            <Input value={form.campaign_name} onChange={(e) => setForm({ ...form, campaign_name: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button
            disabled={!form.spend_amount || add.isPending}
            onClick={() => {
              add.mutate({
                date: form.date,
                channel: form.channel,
                spend_amount: Number(form.spend_amount),
                currency: form.currency,
                campaign_name: form.campaign_name || null,
                app_id: appId ?? null,
              }, { onSuccess: () => setOpen(false) });
            }}
          >
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MarketingIntelligenceSection({ appId }: { appId?: string }) {
  const { data: r, isLoading, refetch } = useMarketingReadiness(appId);
  const { data: spend = [] } = useChannelSpend(appId);
  const { data: mmm = [] } = useMmmRuns(appId);
  const compute = useComputeMmm();
  const del = useDeleteChannelSpend();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Gauge className="h-5 w-5 text-primary" />Marketing Intelligence</h2>
          <p className="text-sm text-muted-foreground">Data readiness, attribution health, and MMM status.</p>
        </div>
        <div className="flex gap-2">
          <AddSpendDialog appId={appId} />
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh</Button>
        </div>
      </div>

      <Tabs defaultValue="readiness">
        <TabsList>
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
          <TabsTrigger value="attribution">Attribution (MMM v0)</TabsTrigger>
          <TabsTrigger value="spend">Spend log</TabsTrigger>
        </TabsList>

        <TabsContent value="readiness" className="mt-4">
          {isLoading || !r ? (
            <Card><CardContent className="p-12 text-center text-muted-foreground">Loading readiness…</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Data readiness (last {r.window_days} days)</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <MetricRow label="Spend Coverage" value={r.metrics.spend_coverage} />
                  <MetricRow label="Conversion Coverage" value={r.metrics.conversion_coverage} />
                  <MetricRow label="Campaign Mapping" value={r.metrics.campaign_mapping} />
                  <MetricRow label="Attribution Coverage" value={r.metrics.attribution_coverage} />
                  <MetricRow label="Data Freshness" value={r.metrics.data_freshness} />
                  <MetricRow label="Connector Reliability" value={r.metrics.connector_reliability} />
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-primary/5 to-secondary/5">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Health Score</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className={`text-5xl font-bold ${pctColor(r.score)}`}>{r.score}<span className="text-xl text-muted-foreground">/100</span></div>
                  <Badge variant={r.label === "Excellent" ? "default" : r.label === "Critical" ? "destructive" : "secondary"}>{r.label}</Badge>
                  <div className="pt-3 border-t space-y-1 text-xs">
                    <div className="flex items-center gap-1.5 font-medium">
                      {r.mmm_ready ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                      MMM Status
                    </div>
                    <p className="text-muted-foreground">{r.mmm_ready ? "Ready to compute" : `Preparing model — est. ${r.estimated_days_to_ready} more days`}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-3">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Model Readiness Gate</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {Object.entries(r.gates).map(([k, g]) => (
                      <div key={k} className="flex items-start gap-2 border rounded p-2">
                        {g.ok ? <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />}
                        <div className="text-xs">
                          <div className="font-medium capitalize">{k.replace(/_/g, " ")}</div>
                          <div className="text-muted-foreground">{g.actual} / target {g.target}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!r.mmm_ready && (
                    <p className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Marketing Mix Model is not yet statistically reliable. Recommendations remain heuristic until sufficient evidence has been collected.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-3">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Attribution audit</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div><div className="text-xs text-muted-foreground">Orphaned conversions</div><div className="text-2xl font-bold">{r.audit.orphaned_conversions}</div></div>
                  <div><div className="text-xs text-muted-foreground">Spend rows w/o campaign</div><div className="text-2xl font-bold">{r.audit.spend_without_campaign}</div></div>
                  <div><div className="text-xs text-muted-foreground">Content w/o cost</div><div className="text-2xl font-bold">{r.audit.content_without_cost}</div></div>
                  <div><div className="text-xs text-muted-foreground">Days since last spend</div><div className="text-2xl font-bold">{r.audit.stale_spend_days}</div></div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="attribution" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Info className="h-3.5 w-3.5" />Bootstrap Estimate — Not a Bayesian Posterior. Model version: bootstrap-v0.</p>
            <Button size="sm" onClick={() => compute.mutate({ appId })} disabled={compute.isPending}>
              {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <TrendingUp className="h-3.5 w-3.5 mr-1.5" />}
              Compute now
            </Button>
          </div>

          {mmm.length === 0 ? (
            <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
              No MMM runs yet. Once readiness gates pass, click Compute now — or the Sunday cron will populate this.
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {mmm.map((m: any) => (
                <Card key={m.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="capitalize">{m.channel}</span>
                      <Badge variant="outline" className="text-[10px]">{m.model_version}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {m.roi_mean == null ? (
                      <p className="text-xs text-muted-foreground">Insufficient data — need more spend and conversion events.</p>
                    ) : (
                      <>
                        <div>
                          <div className="text-xs text-muted-foreground">Expected ROI</div>
                          <div className="text-2xl font-bold">{Number(m.roi_mean).toFixed(2)}x</div>
                          <div className="text-[11px] text-muted-foreground">CI [{Number(m.roi_p10).toFixed(2)}x – {Number(m.roi_p90).toFixed(2)}x]</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t">
                          <div><span className="text-muted-foreground">P(ROI &gt; 1)</span><div className="font-semibold">{(Number(m.probability_roi_gt_1) * 100).toFixed(0)}%</div></div>
                          <div><span className="text-muted-foreground">Marginal ROI</span><div className="font-semibold">{Number(m.marginal_roi ?? 0).toFixed(2)}x</div></div>
                          <div><span className="text-muted-foreground">Saturation</span><div className="font-semibold">${Math.round(Number(m.saturation_point ?? 0)).toLocaleString()}</div></div>
                          <div><span className="text-muted-foreground">Optimal spend</span><div className="font-semibold">${Math.round(Number(m.optimal_spend ?? 0)).toLocaleString()}</div></div>
                          <div><span className="text-muted-foreground">Fit quality</span><div className="font-semibold">{(Number(m.fit_quality ?? 0) * 100).toFixed(0)}%</div></div>
                          <div><span className="text-muted-foreground">Sample size</span><div className="font-semibold">{m.sample_size}</div></div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="spend" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {spend.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">No spend recorded yet. Add your first entry to begin building MMM history.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr><th className="text-left p-3">Date</th><th className="text-left p-3">Channel</th><th className="text-left p-3">Campaign</th><th className="text-right p-3">Amount</th><th className="text-right p-3">Normalized</th><th className="p-3">Source</th><th /></tr>
                  </thead>
                  <tbody>
                    {spend.map((s: any) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="p-3">{s.date}</td>
                        <td className="p-3 capitalize">{s.channel}</td>
                        <td className="p-3 text-muted-foreground">{s.campaign_name ?? "—"}</td>
                        <td className="p-3 text-right">{Number(s.spend_amount).toFixed(2)} {s.currency}</td>
                        <td className="p-3 text-right font-medium">${Number(s.normalized_spend).toFixed(2)}</td>
                        <td className="p-3"><Badge variant="outline" className="text-[10px]">{s.source}</Badge></td>
                        <td className="p-3 text-right"><Button size="icon" variant="ghost" onClick={() => del.mutate(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
