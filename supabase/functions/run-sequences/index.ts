// Sequence runner. Idempotent. Picks scheduled steps whose scheduled_at <= now,
// flips them to 'sending' (lease), calls send-outreach for each, then marks 'sent'
// or 'failed'. Caller is the signed-in user; only their own steps run.
// Designed for both manual "Run now" button and a future pg_cron job.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function sendOne(authHeader: string, payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-outreach`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({} as any));
  return { ok: res.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Unauthorized");
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({} as any));
    const limit = Math.min(Math.max(parseInt(body?.limit ?? "20", 10) || 20, 1), 100);
    const dryRun = !!body?.dry_run;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Pick due steps for this user.
    const { data: due, error: dueErr } = await admin
      .from("prospect_sequences")
      .select("id, prospect_id, sequence_name, step_number, subject, body, scheduled_at, status, prospects!inner(contact_email,name,user_id)")
      .eq("user_id", userId)
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(limit);
    if (dueErr) throw dueErr;

    const items = (due || []).filter((s: any) => s.prospects?.user_id === userId);

    if (dryRun) {
      return new Response(JSON.stringify({ dry_run: true, due: items.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0, failed = 0, skipped = 0;
    for (const step of items) {
      // Lease the row: only proceed if status is still 'scheduled' (avoids dup sends).
      const { data: leased, error: leaseErr } = await admin
        .from("prospect_sequences")
        .update({ status: "sending" })
        .eq("id", step.id)
        .eq("status", "scheduled")
        .select("id")
        .maybeSingle();
      if (leaseErr || !leased) { skipped++; continue; }

      const toAddress = step.prospects?.contact_email;
      if (!toAddress) {
        await admin.from("prospect_sequences").update({
          status: "skipped", error_message: "no contact email",
        }).eq("id", step.id);
        skipped++; continue;
      }

      const subject = step.subject || `Following up — step ${step.step_number}`;
      const text = step.body || `Hi${step.prospects?.name ? " " + step.prospects.name : ""}, just following up on my previous note.`;

      const { ok, data } = await sendOne(authHeader, {
        prospect_id: step.prospect_id,
        subject, body: text,
        sequence_id: step.id, sequence_step_id: step.id,
      });

      if (ok) {
        await admin.from("prospect_sequences").update({
          status: "sent", sent_at: new Date().toISOString(),
          message_id: data?.message_id || null,
        }).eq("id", step.id);
        sent++;
      } else {
        await admin.from("prospect_sequences").update({
          status: "failed",
          error_message: (data?.error || "send failed").toString().slice(0, 500),
        }).eq("id", step.id);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, considered: items.length, sent, failed, skipped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
