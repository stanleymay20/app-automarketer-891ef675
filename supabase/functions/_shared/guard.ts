// Shared security & utility helpers for edge functions.
// Use these in every new function to keep auth, CORS, rate-limit and
// validation consistent.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signature, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

export function errorResponse(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: message, ...extra }, status);
}

export function handlePreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return null;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export interface AuthedUser {
  id: string;
  email: string | null;
  client: SupabaseClient;
}

/**
 * Verify the request carries a valid user JWT. Returns the user (and a
 * user-scoped client honoring RLS) or a 401 Response if missing/invalid.
 */
export async function requireUser(req: Request): Promise<AuthedUser | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return errorResponse("Unauthorized: missing bearer token", 401);
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    return errorResponse("Unauthorized: invalid session", 401);
  }
  return { id: data.user.id, email: data.user.email ?? null, client: userClient };
}

/**
 * Verify a service-to-service / cron caller. Accepts either:
 *  - X-Cron-Secret header matching CRON_SECRET env, OR
 *  - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 * Returns null when authorized, otherwise a 401 Response.
 */
export function requireCron(req: Request): Response | null {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (cronSecret && headerSecret && timingSafeEqual(cronSecret, headerSecret)) return null;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    if (timingSafeEqual(token, SUPABASE_SERVICE_ROLE_KEY)) return null;
  }
  return errorResponse("Unauthorized: cron/service caller required", 401);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Per-user, per-function fixed-window rate limit using the
 * `ai_rate_limits` table. Cheap, ad-hoc (not edge-enforced).
 *
 *  - windowSeconds: size of the bucket (default 60)
 *  - maxCalls:      max calls per user per bucket
 *
 * Returns null when allowed, or a 429 Response when exceeded.
 */
export async function checkRateLimit(
  userId: string,
  functionName: string,
  maxCalls = 20,
  windowSeconds = 60,
): Promise<Response | null> {
  try {
    const admin = adminClient();
    const bucket = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();

    const { data: existing } = await admin
      .from("ai_rate_limits")
      .select("id, call_count")
      .eq("user_id", userId)
      .eq("function_name", functionName)
      .eq("window_start", bucket)
      .maybeSingle();

    if (existing) {
      if (existing.call_count >= maxCalls) {
        return errorResponse(
          `Rate limit exceeded for ${functionName} (${maxCalls}/${windowSeconds}s). Slow down and retry shortly.`,
          429,
        );
      }
      await admin
        .from("ai_rate_limits")
        .update({ call_count: existing.call_count + 1 })
        .eq("id", existing.id);
    } else {
      await admin.from("ai_rate_limits").insert({
        user_id: userId,
        function_name: functionName,
        window_start: bucket,
        call_count: 1,
      });
    }
    return null;
  } catch (e) {
    console.error("[rate-limit] check failed; allowing request", e);
    return null; // fail open — never block the user because of a counter bug
  }
}

/** Safely parse JSON body, returning {} on failure. */
export async function safeJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
