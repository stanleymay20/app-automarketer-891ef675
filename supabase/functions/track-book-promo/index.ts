import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(value: string): Promise<string | null> {
  if (!value) return null;
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const token = url.pathname.split("/").filter(Boolean).pop();

    if (!token || token === "track-book-promo") {
      return new Response("Missing tracking token", { status: 400, headers: corsHeaders });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: assignment, error } = await db
      .from("book_promotion_assignments")
      .select("id,destination_url,status")
      .eq("tracking_token", token)
      .maybeSingle();

    if (error) throw error;
    if (!assignment) {
      return new Response("Unknown promotion link", { status: 404, headers: corsHeaders });
    }

    const destination = new URL(assignment.destination_url);
    if (!["http:", "https:"].includes(destination.protocol)) {
      return new Response("Invalid destination", { status: 400, headers: corsHeaders });
    }

    const referrer = req.headers.get("referer")?.slice(0, 1000) || null;
    const userAgentHash = await sha256(req.headers.get("user-agent") || "");

    // Tracking must never prevent the reader from reaching the book.
    await db.from("book_promotion_clicks").insert({
      assignment_id: assignment.id,
      referrer,
      user_agent: userAgentHash,
    });

    return Response.redirect(destination.toString(), 302);
  } catch (error) {
    console.error("[track-book-promo]", error);
    return new Response("Tracking unavailable", { status: 500, headers: corsHeaders });
  }
});
