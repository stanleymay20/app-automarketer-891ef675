// End-to-end funnel verification: fires a synthetic click → lead → conversion
// and verifies triggers + rollups by reading distribution_targets before/after.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const uid = user.id;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const steps: { step: string; ok: boolean; detail?: string }[] = [];

    // 1. Ensure we have an app + a synthetic distribution target + content row
    const { data: app } = await db.from("apps").select("id").eq("user_id", uid).limit(1).maybeSingle();
    if (!app) {
      return new Response(JSON.stringify({ ok: false, steps: [{ step: "find_app", ok: false, detail: "Create an app first." }] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: target, error: tErr } = await db.from("distribution_targets").insert({
      user_id: uid,
      app_id: app.id,
      target_type: "channel",
      name: "[funnel-test] synthetic target",
      source: "funnel_test",
      status: "active",
    }).select().single();
    steps.push({ step: "create_synthetic_target", ok: !tErr, detail: tErr?.message });
    if (tErr) throw tErr;

    const { data: contentRow, error: cErr } = await db.from("content").insert({
      user_id: uid,
      app_id: app.id,
      platform: "x",
      content_text: "[funnel-test] synthetic content row for end-to-end verification.",
      status: "published",
      published_at: new Date().toISOString(),
      distribution_target_id: target.id,
      distribution_source_type: "channel",
    }).select().single();
    steps.push({ step: "create_synthetic_content", ok: !cErr, detail: cErr?.message });
    if (cErr) throw cErr;

    // 2. Click
    const { error: clickErr } = await db.from("click_events").insert({
      user_id: uid, app_id: app.id, content_id: contentRow.id, distribution_target_id: target.id,
    });
    steps.push({ step: "insert_click", ok: !clickErr, detail: clickErr?.message });

    // 3. Lead
    const { data: lead, error: leadErr } = await db.from("leads").insert({
      user_id: uid, app_id: app.id, email: `funnel-test+${Date.now()}@scrollmarketer.test`,
      source_content_id: contentRow.id, distribution_target_id: target.id, status: "new",
    }).select().single();
    steps.push({ step: "insert_lead", ok: !leadErr, detail: leadErr?.message });

    // 4. Conversion
    const { error: convErr } = await db.from("conversions").insert({
      user_id: uid, app_id: app.id, lead_id: lead!.id, amount: 1, currency: "USD",
      source_content_id: contentRow.id, distribution_target_id: target.id, source: "funnel_test",
    });
    steps.push({ step: "insert_conversion", ok: !convErr, detail: convErr?.message });

    // 5. Verify rollups landed on distribution_targets
    const { data: after } = await db.from("distribution_targets").select("clicks_count, leads_count, conversions_count, revenue_attributed").eq("id", target.id).single();
    steps.push({
      step: "verify_rollup_triggers",
      ok: !!after && (after.clicks_count ?? 0) >= 1 && (after.leads_count ?? 0) >= 1 && (after.conversions_count ?? 0) >= 1 && Number(after.revenue_attributed ?? 0) >= 1,
      detail: JSON.stringify(after),
    });

    await db.from("automation_audit_log").insert({
      user_id: uid, action_type: "funnel_test", entity_type: "distribution_target", entity_id: target.id,
      details: { steps, after },
    });

    const allOk = steps.every((s) => s.ok);
    return new Response(JSON.stringify({ ok: allOk, target_id: target.id, content_id: contentRow.id, rollup: after, steps }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("funnel-test", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
