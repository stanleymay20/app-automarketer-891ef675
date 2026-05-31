import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type JobName = "audience" | "distribution" | "prospects" | "signals";

const FUNCTIONS: Record<JobName, string> = {
  audience: "generate-audience-intelligence",
  distribution: "discover-distribution",
  prospects: "discover-prospects",
  signals: "collect-signals",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { app_id } = (await req.json()) as { app_id: string };
    if (!app_id) {
      return new Response(JSON.stringify({ error: "app_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: app } = await admin.from("apps").select("id, user_id").eq("id", app_id).eq("user_id", user.id).maybeSingle();
    if (!app) return new Response(JSON.stringify({ error: "App not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const runJob = async (job: JobName): Promise<[JobName, "success" | "failed", string?]> => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${FUNCTIONS[job]}`, {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ app_id }),
        });
        const text = await res.text();
        if (!res.ok) return [job, "failed", `${res.status}: ${text.slice(0, 200)}`];
        return [job, "success"];
      } catch (e: any) {
        return [job, "failed", String(e?.message ?? e)];
      }
    };

    const results = await Promise.all((Object.keys(FUNCTIONS) as JobName[]).map(runJob));
    const summary: Record<string, { status: string; error?: string }> = {};
    let ok = 0;
    for (const [job, status, err] of results) {
      summary[job] = { status, ...(err ? { error: err } : {}) };
      if (status === "success") ok++;
    }

    await admin.from("automation_audit_log").insert({
      user_id: user.id,
      action_type: "app_bootstrapped",
      entity_type: "app",
      entity_id: app_id,
      details: { results: summary, ok, total: results.length },
    });

    return new Response(JSON.stringify({ ok, total: results.length, results: summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("bootstrap-app", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
