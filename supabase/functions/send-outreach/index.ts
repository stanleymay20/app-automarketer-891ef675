// Sends an outbound outreach email to a prospect via Resend (connector gateway).
// Stores a row in prospect_messages and writes a `message_sent` activity log.
// Auth required; ownership of the prospect is verified. Tokens stay server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_FROM_EMAIL = Deno.env.get("APP_FROM_EMAIL") || "ScrollMarketer <onboarding@resend.dev>";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function asHtml(body: string) {
  return body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`).join("\n");
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
    const userEmail = userData.user.email || null;

    const body = await req.json().catch(() => ({} as any));
    const prospect_id: string | undefined = body?.prospect_id;
    const subject: string = String(body?.subject || "").trim();
    const text: string = String(body?.body || "").trim();
    const to_override: string | undefined = body?.to_address;
    const sequence_id: string | undefined = body?.sequence_id;
    const sequence_step_id: string | undefined = body?.sequence_step_id;

    if (!prospect_id) throw new Error("prospect_id is required");
    if (!subject) throw new Error("subject is required");
    if (text.length < 5) throw new Error("body is too short");

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: prospect, error: pErr } = await admin
      .from("prospects").select("id,user_id,name,contact_email,stage,contacted_at")
      .eq("id", prospect_id).single();
    if (pErr || !prospect) throw new Error("Prospect not found");
    if (prospect.user_id !== userId) throw new Error("Not allowed");

    const toAddress = (to_override || prospect.contact_email || "").trim();
    if (!toAddress) throw new Error("Prospect has no contact email on file");

    // Pre-insert as queued (so we always have a record even if send fails).
    const { data: queued, error: qErr } = await admin.from("prospect_messages").insert({
      user_id: userId,
      prospect_id,
      channel: "email",
      subject,
      body: text,
      from_address: APP_FROM_EMAIL,
      to_address: toAddress,
      provider: "resend",
      status: "queued",
      sequence_id: sequence_id || null,
      sequence_step_id: sequence_step_id || null,
    }).select().single();
    if (qErr) throw qErr;

    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      await admin.from("prospect_messages").update({
        status: "failed",
        error_message: "Email provider (Resend) is not configured. Connect Resend or set RESEND_API_KEY.",
      }).eq("id", queued.id);
      return new Response(
        JSON.stringify({
          error: "Email provider not configured. Ask the workspace owner to connect Resend.",
          message_id: queued.id,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let providerId: string | null = null;
    let providerErr: string | null = null;
    try {
      const res = await fetch(`${GATEWAY_URL}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": RESEND_API_KEY,
        },
        body: JSON.stringify({
          from: APP_FROM_EMAIL,
          to: [toAddress],
          subject,
          html: asHtml(text),
          text,
          reply_to: userEmail || undefined,
          tags: [
            { name: "source", value: "scrollmarketer" },
            { name: "prospect_id", value: prospect_id },
          ],
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        providerErr = (data?.message || data?.error || `Resend HTTP ${res.status}`).toString().slice(0, 500);
      } else {
        providerId = data?.id || data?.data?.id || null;
      }
    } catch (e) {
      providerErr = (e as Error).message;
    }

    const now = new Date().toISOString();
    if (providerErr) {
      await admin.from("prospect_messages").update({
        status: "failed", error_message: providerErr,
      }).eq("id", queued.id);
      return new Response(
        JSON.stringify({ error: providerErr, message_id: queued.id }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await admin.from("prospect_messages").update({
      status: "sent", provider_message_id: providerId, sent_at: now,
    }).eq("id", queued.id);

    // Advance prospect to 'contacted' (don't downgrade later stages) + stamp timestamps.
    await admin.from("prospects").update({
      stage: prospect.stage && !["new","saved","qualified"].includes(prospect.stage)
        ? prospect.stage : "contacted",
      contacted_at: prospect.contacted_at || now,
      last_contacted_at: now,
      sent_at: now,
      updated_at: now,
    }).eq("id", prospect_id);

    // Activity feed
    await admin.from("prospect_actions").insert({
      user_id: userId, prospect_id, action_type: "message_sent",
      channel: "email", subject, body: text,
      metadata: { message_id: queued.id, provider_message_id: providerId, sequence_id, sequence_step_id },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message_id: queued.id,
        provider_message_id: providerId,
        status: "sent",
        sent_at: now,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
