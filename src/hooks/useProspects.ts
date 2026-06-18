import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type ProspectCategory = "customer" | "grant" | "partner" | "investor" | "community";

export const PROSPECT_STAGES = [
  "new", "saved", "qualified", "contacted", "responded",
  "meeting", "proposal", "won", "lost",
] as const;
export type ProspectStage = typeof PROSPECT_STAGES[number];

export interface Prospect {
  id: string;
  user_id: string;
  app_id: string | null;
  category: ProspectCategory;
  name: string;
  description: string | null;
  url: string | null;
  location: string | null;
  deadline: string | null;
  fit_score: number;
  opportunity_score: number;
  urgency_score: number;
  reachability_score: number;
  prospect_score: number;
  match_reason: string | null;
  signals: any;
  status: string;
  stage: ProspectStage;
  saved_at: string | null;
  contacted_at: string | null;
  responded_at: string | null;
  converted_at: string | null;
  last_contacted_at: string | null;
  next_action_at: string | null;
  revenue_attributed: number;
  source: string;
  source_confidence: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  contact_role: string | null;
  company_size: string | null;
  industry: string | null;
  notes: string | null;
  owner_id: string | null;
  source_type: string | null;
  evidence_summary: string | null;
  discovery_run_id: string | null;
  created_at: string;
}

export function useProspects(appId?: string) {
  return useQuery({
    queryKey: ["prospects", appId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("prospects").select("*").order("prospect_score", { ascending: false }).limit(500);
      if (appId) q = q.eq("app_id", appId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Prospect[];
    },
  });
}

export function useDiscoverProspects() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ appId, categories }: { appId?: string; categories?: ProspectCategory[] }) => {
      const { data, error } = await supabase.functions.invoke("discover-prospects", {
        body: { app_id: appId, categories },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      const m = d?.metrics;
      const desc = m ? `dedup ${m.dropped_duplicate} · low-conf ${m.low_confidence} · avg conf ${m.average_confidence}` : undefined;
      toast({ title: `${d?.created ?? 0} prospects discovered`, description: desc });
    },
    onError: (e: any) => toast({ title: "Discovery failed", description: e.message, variant: "destructive" }),
  });
}

export type ProspectAction =
  | "save" | "watch" | "dismiss" | "view"
  | "mark_contacted" | "mark_responded" | "mark_converted"
  | "mark_qualified" | "mark_meeting" | "mark_proposal" | "mark_won" | "mark_lost"
  | "update_contact" | "set_stage"
  | "generate_outreach" | "generate_campaign";

export interface ProspectActionPayload {
  prospect_id: string;
  action: ProspectAction;
  channel?: string;
  stage?: ProspectStage;
  contact?: Partial<{
    contact_email: string;
    contact_name: string;
    contact_linkedin: string;
    contact_role: string;
    company_size: string;
    industry: string;
    notes: string;
    next_action_at: string | null;
  }>;
}

export function useProspectAction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: ProspectActionPayload) => {
      const { data, error } = await supabase.functions.invoke("prospect-action", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { data, action: payload.action };
    },
    onSuccess: ({ action }) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospect-actions"] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      const labels: Partial<Record<ProspectAction, string>> = {
        save: "Saved",
        watch: "Added to watchlist",
        dismiss: "Dismissed",
        mark_contacted: "Marked as contacted",
        mark_responded: "Marked as responded",
        mark_converted: "Marked as won",
        mark_qualified: "Marked qualified",
        mark_meeting: "Meeting booked",
        mark_proposal: "Proposal sent",
        mark_won: "Marked as won",
        mark_lost: "Marked as lost",
        set_stage: "Stage updated",
        update_contact: "Contact details saved",
        generate_outreach: "Outreach drafted",
        generate_campaign: "Campaign created",
      };
      if (labels[action]) toast({ title: labels[action]! });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });
}

export function useProspectActions(prospectId?: string) {
  return useQuery({
    queryKey: ["prospect-actions", prospectId],
    enabled: !!prospectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospect_actions")
        .select("*")
        .eq("prospect_id", prospectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/* ---------------- CSV helpers ---------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/i;

export interface ProspectCsvRow {
  name?: string;
  url?: string;
  description?: string;
  contact_email?: string;
  contact_name?: string;
  contact_linkedin?: string;
  contact_role?: string;
  industry?: string;
  company_size?: string;
  notes?: string;
  stage?: string;
}

export function parseProspectCsv(text: string): ProspectCsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === ',') { out.push(cur); cur = ""; }
        else if (c === '"') inQ = true;
        else cur += c;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  const rows: ProspectCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const row: any = {};
    headers.forEach((h, idx) => {
      const v = (cells[idx] ?? "").trim();
      if (v) row[h] = v;
    });
    if (row.contact_email && !EMAIL_RE.test(row.contact_email)) delete row.contact_email;
    if (row.url && !URL_RE.test(row.url)) row.url = `https://${row.url}`;
    if (row.contact_linkedin && !URL_RE.test(row.contact_linkedin)) {
      row.contact_linkedin = `https://${row.contact_linkedin.replace(/^\/+/, "")}`;
    }
    if (row.name) rows.push(row);
  }
  return rows;
}

export function prospectsToCsv(rows: Prospect[]): string {
  const cols = [
    "name", "category", "stage", "prospect_score", "url", "description",
    "contact_name", "contact_email", "contact_linkedin", "contact_role",
    "industry", "company_size", "notes", "next_action_at", "last_contacted_at",
  ] as const;
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc((r as any)[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

export interface ImportSkip {
  row: number;
  name?: string;
  reason: string;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  skips: ImportSkip[];
}

export function useImportProspects() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation<ImportResult, Error, { appId?: string; rows: ProspectCsvRow[] }>({
    mutationFn: async ({ appId, rows }) => {
      console.info("[import-prospects] start", { appId, rawRows: rows.length });

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        console.error("[import-prospects] auth.getUser error", userErr);
        throw new Error(`Auth error: ${userErr.message}`);
      }
      const user = userData?.user;
      if (!user) throw new Error("Not signed in");
      console.info("[import-prospects] user", { id: user.id });

      const { data: existing, error: existingErr } = await supabase
        .from("prospects")
        .select("name, url, contact_email")
        .eq("user_id", user.id);
      if (existingErr) console.error("[import-prospects] existing query error", existingErr);
      console.info("[import-prospects] existing rows", { count: existing?.length ?? 0 });

      const seen = new Set<string>();
      (existing ?? []).forEach((e: any) => {
        if (e.url) seen.add(`u:${String(e.url).toLowerCase()}`);
        if (e.name && e.contact_email) {
          seen.add(`ne:${String(e.name).toLowerCase()}|${String(e.contact_email).toLowerCase()}`);
        }
      });

      const ALLOWED_STAGES = PROSPECT_STAGES as readonly string[];
      const ALLOWED_CATEGORIES: ProspectCategory[] = ["customer", "grant", "partner", "investor", "community"];

      const skips: ImportSkip[] = [];
      const toInsert: any[] = [];

      rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        if (!r.name || !r.name.trim()) {
          skips.push({ row: rowNum, name: r.name, reason: "missing name" });
          return;
        }
        if (r.url && seen.has(`u:${r.url.toLowerCase()}`)) {
          skips.push({ row: rowNum, name: r.name, reason: `duplicate url (${r.url})` });
          return;
        }
        if (r.name && r.contact_email && seen.has(`ne:${r.name.toLowerCase()}|${r.contact_email.toLowerCase()}`)) {
          skips.push({ row: rowNum, name: r.name, reason: "duplicate name + email" });
          return;
        }
        if (r.url) seen.add(`u:${r.url.toLowerCase()}`);
        if (r.name && r.contact_email) {
          seen.add(`ne:${r.name.toLowerCase()}|${r.contact_email.toLowerCase()}`);
        }

        const rawCat = (r as any).category as string | undefined;
        const category: ProspectCategory =
          rawCat && ALLOWED_CATEGORIES.includes(rawCat as ProspectCategory)
            ? (rawCat as ProspectCategory)
            : "customer";

        toInsert.push({
          user_id: user.id,
          app_id: appId ?? null,
          category,
          source: "csv_import",
          source_confidence: 60,
          stage: r.stage && ALLOWED_STAGES.includes(r.stage) ? r.stage : "saved",
          status: r.stage === "won" ? "converted" : r.stage === "lost" ? "dismissed" : "saved",
          name: r.name!,
          url: r.url ?? null,
          description: r.description ?? null,
          contact_email: r.contact_email ?? null,
          contact_name: r.contact_name ?? null,
          contact_linkedin: r.contact_linkedin ?? null,
          contact_role: r.contact_role ?? null,
          industry: r.industry ?? null,
          company_size: r.company_size ?? null,
          notes: r.notes ?? null,
          fit_score: 60,
          opportunity_score: 60,
          urgency_score: 50,
          reachability_score: r.contact_email ? 80 : 50,
          prospect_score: 60,
        });
      });

      console.info("[import-prospects] prepared", {
        toInsert: toInsert.length,
        skipped: skips.length,
        sampleRow: toInsert[0],
      });

      if (toInsert.length === 0) {
        return { inserted: 0, skipped: skips.length, skips };
      }

      const { data: insertedRows, error } = await supabase
        .from("prospects")
        .insert(toInsert)
        .select("id");

      if (error) {
        console.error("[import-prospects] insert error", error);
        throw new Error(
          `${error.message}${(error as any).details ? ` — ${(error as any).details}` : ""}${(error as any).hint ? ` (${(error as any).hint})` : ""}`
        );
      }

      const insertedCount = insertedRows?.length ?? 0;
      console.info("[import-prospects] inserted", { count: insertedCount });

      if (insertedCount < toInsert.length) {
        for (let i = insertedCount; i < toInsert.length; i++) {
          skips.push({
            row: i + 2,
            name: toInsert[i].name,
            reason: "silently rejected by database (likely RLS or constraint)",
          });
        }
      }

      return { inserted: insertedCount, skipped: skips.length, skips };
    },
    onSuccess: ({ inserted, skipped, skips }) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      const reasons = skips.slice(0, 5).map((s) => `Row ${s.row} (${s.name ?? "?"}): ${s.reason}`).join(" · ");
      const more = skips.length > 5 ? ` (+${skips.length - 5} more)` : "";
      toast({
        title: `Imported ${inserted}${skipped > 0 ? ` · Skipped ${skipped}` : ""}`,
        description: skipped > 0 ? `${reasons}${more}` : undefined,
        variant: inserted === 0 && skipped > 0 ? "destructive" : "default",
      });
      if (skips.length > 0) console.warn("[import-prospects] skip details", skips);
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });
}
