// Runs on cron. Processes due nurture enrollments:
//   1. Load enrollments where status='active' AND next_send_at <= now()
//   2. For each, load current+next step, render body, attempt send
//   3. Advance enrollment: next step's next_send_at, or mark completed
//
// Sending: tries to invoke `send-transactional-email` (Lovable Emails). If that
// function isn't scaffolded yet, marks send status='queued' so nothing is lost.
// Unsubscribe link is appended automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function renderBody(html: string | null, text: string | null, vars: Record<string, string>) {
  const substitute = (s: string) =>
    s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
  return {
    html: html ? substitute(html) : null,
    text: text ? substitute(text) : null,
  };
}

function appendUnsubscribe(html: string | null, text: string | null, unsubUrl: string) {
  const footerHtml = `<hr style="border:none;border-top:1px solid #eee;margin:24px 0"/><p style="font-size:12px;color:#888;text-align:center">Don't want these? <a href="${unsubUrl}" style="color:#888">Unsubscribe</a></p>`;
  const footerText = `\n\n---\nUnsubscribe: ${unsubUrl}`;
  return {
    html: html ? html + footerHtml : `<div>${footerHtml}</div>`,
    text: text ? text + footerText : footerText,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cron / service-role only
  const auth = req.headers.get("authorization") ?? "";
  const cronHdr = req.headers.get("x-cron-secret") ?? "";
  if (!auth.includes(SERVICE_KEY) && cronHdr !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = new Date().toISOString();

  const { data: due, error } = await admin
    .from("nurture_enrollments")
    .select("id, user_id, sequence_id, subscriber_id, current_step_order, next_send_at")
    .eq("status", "active")
    .lte("next_send_at", now)
    .order("next_send_at", { ascending: true })
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];

  for (const e of due ?? []) {
    try {
      // Load sub
      const { data: sub } = await admin
        .from("email_subscribers")
        .select("id, email, name, status, unsubscribe_token")
        .eq("id", e.subscriber_id)
        .single();

      if (!sub || sub.status !== "subscribed") {
        await admin.from("nurture_enrollments").update({
          status: sub?.status === "unsubscribed" ? "unsubscribed" : "paused",
          updated_at: new Date().toISOString(),
        }).eq("id", e.id);
        results.push({ id: e.id, skipped: "subscriber_not_active" });
        continue;
      }

      // Next step to send = the one AFTER current_step_order (0 means none sent yet, send step_order=1)
      const nextOrder = e.current_step_order + 1;
      const { data: step } = await admin
        .from("nurture_steps")
        .select("*")
        .eq("sequence_id", e.sequence_id)
        .eq("step_order", nextOrder)
        .eq("is_active", true)
        .maybeSingle();

      if (!step) {
        await admin.from("nurture_enrollments").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", e.id);
        results.push({ id: e.id, completed: true });
        continue;
      }

      // Sequence sender
      const { data: seq } = await admin
        .from("nurture_sequences")
        .select("from_name, from_email, reply_to")
        .eq("id", e.sequence_id)
        .single();

      const unsubUrl = `${APP_URL || "https://app-automarketer.lovable.app"}/unsubscribe?token=${sub.unsubscribe_token}`;
      const vars = {
        name: sub.name || "there",
        email: sub.email,
        unsubscribe_url: unsubUrl,
      };
      const rendered = renderBody(step.body_html, step.body_text, vars);
      const withFooter = appendUnsubscribe(rendered.html, rendered.text, unsubUrl);

      let sendStatus: "sent" | "queued" | "failed" = "queued";
      let providerId: string | null = null;
      let errorMsg: string | null = null;

      // Try transactional sender
      try {
        const r = await admin.functions.invoke("send-transactional-email", {
          body: {
            to: sub.email,
            subject: step.subject.replace(/\{\{\s*(\w+)\s*\}\}/g, (_: string, k: string) => (vars as any)[k] ?? ""),
            html: withFooter.html,
            text: withFooter.text,
            from_name: seq?.from_name ?? undefined,
            from_email: seq?.from_email ?? undefined,
            reply_to: seq?.reply_to ?? undefined,
            headers: { "List-Unsubscribe": `<${unsubUrl}>` },
          },
        });
        if (r.error) throw r.error;
        sendStatus = "sent";
        providerId = (r.data as any)?.id ?? (r.data as any)?.message_id ?? null;
      } catch (invokeErr: any) {
        // Function not deployed yet — keep as queued, not failed
        errorMsg = String(invokeErr?.message ?? invokeErr);
        if (/not found|Failed to send|404/i.test(errorMsg)) {
          sendStatus = "queued";
        } else {
          sendStatus = "failed";
        }
      }

      await admin.from("nurture_sends").insert({
        user_id: e.user_id,
        enrollment_id: e.id,
        sequence_id: e.sequence_id,
        step_id: step.id,
        subscriber_id: sub.id,
        status: sendStatus,
        provider_message_id: providerId,
        subject: step.subject,
        error: errorMsg,
        sent_at: sendStatus === "sent" ? new Date().toISOString() : null,
      });

      // Compute next step delay
      const { data: nextStep } = await admin
        .from("nurture_steps")
        .select("delay_hours")
        .eq("sequence_id", e.sequence_id)
        .eq("step_order", nextOrder + 1)
        .eq("is_active", true)
        .maybeSingle();

      const update: any = {
        current_step_order: nextOrder,
        updated_at: new Date().toISOString(),
      };
      if (nextStep) {
        update.next_send_at = new Date(Date.now() + (nextStep.delay_hours ?? 0) * 3600_000).toISOString();
      } else {
        update.status = "completed";
        update.completed_at = new Date().toISOString();
      }
      await admin.from("nurture_enrollments").update(update).eq("id", e.id);

      results.push({ id: e.id, step_order: nextOrder, send_status: sendStatus });
    } catch (err: any) {
      await admin.from("nurture_enrollments").update({
        status: "failed",
        updated_at: new Date().toISOString(),
        metadata: { error: String(err?.message ?? err) },
      }).eq("id", e.id);
      results.push({ id: e.id, error: String(err?.message ?? err) });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
