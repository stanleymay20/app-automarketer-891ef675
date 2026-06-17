// Autopilot tick — cron/service-role only.
// Walks every user with `autopilot_settings.enabled = true`, picks prospects
// in `autopilot_state='queued'`, and either:
//   - calls send-outreach (approved:true) when every gate passes, or
//   - routes the prospect to review_required with a reason.
// Every decision is written to automation_audit_log (rule_version=autopilot-v1).
import {
  adminClient,
  corsHeaders,
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireCron,
  safeJson,
} from "../_shared/guard.ts";

const RULE_VERSION = "autopilot-v1";
const HARD_DAILY_CAP = 50;
const MAX_USERS_PER_TICK = 50;
const MAX_PROSPECTS_PER_USER = 25;
const SEND_OUTREACH_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-outreach`;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Segment = "hot" | "warm" | "nurture" | "disqualify";

interface AutopilotSettings {
  user_id: string;
  enabled: boolean;
  min_opportunity_score: number;
  min_confidence: number;
  daily_send_cap: number;
  max_auto_value: number;
  allowed_segments: Segment[] | null;
  approval_required_segments: Segment[] | null;
  sent_today: number;
  sent_today_date: string | null;
}

interface Prospect {
  id: string;
  user_id: string;
  name: string | null;
  company_name: string | null;
  contact_email: string | null;
  segment: Segment | null;
  opportunity_score: number | null;
  opportunity_confidence: number | null;
  expected_value: number | null;
  expected_value_confidence: number | null;
  value_currency: string | null;
  pipeline_stage: string | null;
  stage: string | null;
  autopilot_state: string | null;
  review_status: string | null;
  review_draft_subject: string | null;
  review_draft_body: string | null;
  segment_reason: string | null;
  icp_fit_reasoning: string | null;
  buying_signal_reasoning: string | null;
}

const TERMINAL_STAGES = new Set([
  "won", "lost", "closed_won", "closed_lost",
  "proposal", "meeting", "negotiation",
  "responded", "unsubscribed", "opted_out",
]);

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultSubject(p: Prospect): string {
  const co = p.company_name || p.name || "your team";
  return `Quick idea for ${co}`.slice(0, 120);
}
function defaultBody(p: Prospect): string {
  const who = (p.name || p.company_name || "there").split(" ")[0];
  const why = p.segment_reason || p.icp_fit_reasoning || p.buying_signal_reasoning ||
    "your recent activity suggested there might be a good fit.";
  return [
    `Hi ${who},`, "",
    why, "",
    "Would a 15-minute call next week be useful to see whether we can help?",
    "", "Thanks,",
  ].join("\n");
}

async function audit(
  userId: string,
  prospectId: string,
  actionType: string,
  details: Record<string, unknown>,
) {
  try {
    await adminClient().from("automation_audit_log").insert({
      user_id: userId,
      action_type: actionType,
      entity_type: "prospect",
      entity_id: prospectId,
      details: { rule_version: RULE_VERSION, ...details },
    });
  } catch (e) {
    console.warn("[autopilot-tick] audit insert failed", e);
  }
}

interface Routing {
  decision: "send" | "review" | "block" | "skip";
  reason: string;
  rule: string;
}

function route(p: Prospect, s: AutopilotSettings): Routing {
  const seg = p.segment ?? "nurture";
  const oppScore = Number(p.opportunity_score ?? 0);
  const oppConf = Number(p.opportunity_confidence ?? 0);
  const evConf = Number(p.expected_value_confidence ?? 0);
  const ev = Number(p.expected_value ?? 0);

  if (seg === "disqualify") return { decision: "block", reason: "Segment is disqualify.", rule: "segment_disqualify" };
  if (!p.contact_email) return { decision: "review", reason: "No contact email on file.", rule: "missing_email" };
  if (oppScore < s.min_opportunity_score)
    return { decision: "skip", reason: `Score ${oppScore} below threshold ${s.min_opportunity_score}.`, rule: "below_min_score" };
  if (oppConf < s.min_confidence || evConf < s.min_confidence)
    return { decision: "review", reason: `Confidence too low (opp ${oppConf}%, ev ${evConf}%).`, rule: "low_confidence" };
  if (ev > s.max_auto_value)
    return { decision: "review", reason: `Expected value ${ev} exceeds auto-send ceiling ${s.max_auto_value}.`, rule: "value_over_cap" };

  const approvalReq = new Set(s.approval_required_segments ?? []);
  if (approvalReq.has(seg as Segment))
    return { decision: "review", reason: `Segment '${seg}' requires manual approval.`, rule: "segment_requires_approval" };

  const allowed = new Set(s.allowed_segments ?? []);
  if (!allowed.has(seg as Segment))
    return { decision: "review", reason: `Segment '${seg}' is not in the auto-send allow list.`, rule: "segment_not_allowed" };

  return { decision: "send", reason: "All gates passed.", rule: "auto_send_allowed" };
}

async function callSendOutreach(
  prospectId: string,
  subject: string,
  body: string,
  toAddress: string,
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(SEND_OUTREACH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-autopilot-tick": "1",
    },
    body: JSON.stringify({
      prospect_id: prospectId,
      subject,
      body,
      to_address: toAddress,
      approved: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data?.error, status: res.status, data };
}

async function processUser(s: AutopilotSettings) {
  const admin = adminClient();
  const summary = { evaluated: 0, sent: 0, review_required: 0, blocked: 0, skipped: 0, failed: 0 };

  // Daily counter rollover
  let sentToday = s.sent_today ?? 0;
  if (s.sent_today_date !== todayISO()) {
    await admin.from("autopilot_settings")
      .update({ sent_today: 0, sent_today_date: todayISO() })
      .eq("user_id", s.user_id);
    sentToday = 0;
  }

  const dailyCap = Math.min(HARD_DAILY_CAP, Math.max(0, s.daily_send_cap ?? 0));
  if (sentToday >= dailyCap) return summary;

  const { data: prospects, error } = await admin.from("prospects")
    .select(
      "id,user_id,name,company_name,contact_email,segment,opportunity_score,opportunity_confidence,expected_value,expected_value_confidence,value_currency,pipeline_stage,stage,autopilot_state,review_status,review_draft_subject,review_draft_body,segment_reason,icp_fit_reasoning,buying_signal_reasoning",
    )
    .eq("user_id", s.user_id)
    .eq("autopilot_state", "queued")
    .or("review_status.is.null,review_status.eq.approved")
    .order("opportunity_score", { ascending: false, nullsFirst: false })
    .limit(MAX_PROSPECTS_PER_USER);
  if (error) {
    console.error("[autopilot-tick] fetch prospects failed", error);
    return summary;
  }

  const seen = new Set<string>();
  for (const p of (prospects ?? []) as Prospect[]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    summary.evaluated++;

    // Stage safety net
    const stageKey = (p.pipeline_stage || p.stage || "").toLowerCase();
    if (TERMINAL_STAGES.has(stageKey)) {
      summary.skipped++;
      await audit(s.user_id, p.id, "autopilot_skipped", { rule: "terminal_stage", stage: stageKey });
      continue;
    }

    const decision = route(p, s);
    const baseDetails = {
      segment: p.segment,
      opportunity_score: p.opportunity_score,
      opportunity_confidence: p.opportunity_confidence,
      expected_value: p.expected_value,
      expected_value_confidence: p.expected_value_confidence,
      rule: decision.rule,
      reason: decision.reason,
    };

    if (decision.decision === "block") {
      await admin.from("prospects").update({
        autopilot_state: "blocked",
        review_status: "rejected",
        review_reason: decision.reason.slice(0, 500),
      }).eq("id", p.id);
      summary.blocked++;
      await audit(s.user_id, p.id, "autopilot_blocked", baseDetails);
      continue;
    }

    if (decision.decision === "skip") {
      summary.skipped++;
      await audit(s.user_id, p.id, "autopilot_skipped", baseDetails);
      continue;
    }

    if (decision.decision === "review") {
      await admin.from("prospects").update({
        autopilot_state: "review_required",
        review_status: "pending",
        review_reason: decision.reason.slice(0, 500),
      }).eq("id", p.id);
      summary.review_required++;
      await audit(s.user_id, p.id, "autopilot_routed_to_review", baseDetails);
      continue;
    }

    // SEND path -- enforce cap one more time
    if (sentToday >= dailyCap) {
      summary.skipped++;
      await audit(s.user_id, p.id, "autopilot_skipped", { ...baseDetails, rule: "daily_cap_reached" });
      continue;
    }

    const subject = (p.review_draft_subject?.trim()) || defaultSubject(p);
    const body = (p.review_draft_body?.trim()) || defaultBody(p);

    // Idempotency lock: claim the prospect first by flipping autopilot_state.
    // Only one tick can win this update.
    const { data: claimed, error: claimErr } = await admin
      .from("prospects")
      .update({ autopilot_state: "sending" })
      .eq("id", p.id)
      .eq("autopilot_state", "queued")
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) {
      summary.skipped++;
      continue;
    }

    try {
      const res = await callSendOutreach(p.id, subject, body, p.contact_email!);
      if (!res.ok) {
        await admin.from("prospects").update({
          autopilot_state: "queued", // release the claim for the next tick
          review_reason: `Auto-send failed: ${(res.data?.error || res.status).toString().slice(0, 200)}`,
        }).eq("id", p.id);
        summary.failed++;
        await audit(s.user_id, p.id, "autopilot_send_failed", {
          ...baseDetails,
          subject,
          body_snippet: body.slice(0, 200),
          error: res.data?.error ?? `HTTP ${res.status}`,
        });
        continue;
      }

      await admin.from("prospects").update({
        autopilot_state: "auto_sent",
        review_status: "approved",
      }).eq("id", p.id);
      sentToday++;
      await admin.from("autopilot_settings")
        .update({ sent_today: sentToday, sent_today_date: todayISO() })
        .eq("user_id", s.user_id);
      summary.sent++;
      await audit(s.user_id, p.id, "autopilot_sent", {
        ...baseDetails,
        subject,
        body_snippet: body.slice(0, 200),
        message_id: res.data?.message_id ?? null,
      });

      if (sentToday >= dailyCap) break;
    } catch (e) {
      await admin.from("prospects").update({ autopilot_state: "queued" }).eq("id", p.id);
      summary.failed++;
      await audit(s.user_id, p.id, "autopilot_send_failed", {
        ...baseDetails,
        subject,
        error: (e as Error).message,
      });
    }
  }

  return summary;
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  const cronErr = requireCron(req);
  if (cronErr) return cronErr;

  await safeJson(req); // tolerate empty bodies

  try {
    const admin = adminClient();
    const { data: users, error } = await admin
      .from("autopilot_settings")
      .select("user_id,enabled,min_opportunity_score,min_confidence,daily_send_cap,max_auto_value,allowed_segments,approval_required_segments,sent_today,sent_today_date")
      .eq("enabled", true)
      .limit(MAX_USERS_PER_TICK);
    if (error) throw error;

    const totals = { users_processed: 0, sent: 0, review_required: 0, blocked: 0, skipped: 0, failed: 0 };
    const perUser: Array<Record<string, unknown>> = [];

    for (const s of (users ?? []) as AutopilotSettings[]) {
      try {
        const r = await processUser(s);
        totals.users_processed++;
        totals.sent += r.sent;
        totals.review_required += r.review_required;
        totals.blocked += r.blocked;
        totals.skipped += r.skipped;
        totals.failed += r.failed;
        perUser.push({ user_id: s.user_id, ...r });
      } catch (e) {
        console.error("[autopilot-tick] user failed", s.user_id, e);
        perUser.push({ user_id: s.user_id, error: (e as Error).message });
      }
    }

    return jsonResponse({
      ok: true,
      rule_version: RULE_VERSION,
      ...totals,
      per_user: perUser,
    });
  } catch (e) {
    console.error("[autopilot-tick] fatal", e);
    return errorResponse((e as Error).message, 500);
  }
});
