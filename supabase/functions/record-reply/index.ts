// Records an inbound reply for a prospect. Designed so future Gmail/Outlook pollers
// can call this same endpoint with source='gmail'|'outlook' and an external_id.
// The DB trigger handles stage advancement + activity feed entry.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ALLOWED_CHANNELS = new Set(["email", "linkedin", "x", "manual", "other"]);
const ALLOWED_SOURCES = new Set(["manual", "edge", "gmail", "outlook", "webhook"]);

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
    const prospect_id = body?.prospect_id;
    if (!prospect_id) throw new Error("prospect_id is required");
    if (!body?.body || typeof body.body !== "string") throw new Error("body is required");

    const channel = ALLOWED_CHANNELS.has(body?.channel) ? body.channel : "email";
    const source = ALLOWED_SOURCES.has(body?.source) ? body.source : "edge";

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify ownership before inserting (defence in depth alongside RLS).
    const { data: prospect, error: pErr } = await admin
      .from("prospects").select("id,user_id").eq("id", prospect_id).single();
    if (pErr || !prospect) throw new Error("Prospect not found");
    if (prospect.user_id !== userId) throw new Error("Not allowed");

    const insert = {
      user_id: userId,
      prospect_id,
      channel,
      direction: "inbound" as const,
      source,
      from_address: body?.from_address || null,
      from_name: body?.from_name || null,
      subject: body?.subject || null,
      body: String(body.body).slice(0, 20_000),
      received_at: body?.received_at || new Date().toISOString(),
      external_id: body?.external_id || null,
      metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
    };

    const { data, error } = await admin
      .from("prospect_replies").insert(insert).select().single();
    if (error) {
      // Dedupe via unique (source, external_id).
      if (String(error.message).includes("prospect_replies_source_external_uq")) {
        return new Response(JSON.stringify({ success: true, deduped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw error;
    }

    return new Response(JSON.stringify({ success: true, reply: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
