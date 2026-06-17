// Daily model-recalibration tick. Cron/service-role only.
// Reads recent outcomes + proposal acceptance + meeting conversion + actual-vs-expected
// gaps, and writes advisory `model_recommendations`. NEVER mutates qualification,
// expected_value, or autopilot settings. Recommendations require human approval.
import {
  adminClient,
  errorResponse,
  handlePreflight,
  jsonResponse,
  requireCron,
  safeJson,
} from "../_shared/guard.ts";

const RULE_VERSION = "recalibrate-v1";
const LOOKBACK_DAYS = 30;

interface UserStats {
  user_id: string;
  outcomes: Array<{ outcome_type: string; actual_value: number | null; expected_value: number | null; delta: number | null }>;
  proposals: Array<{ status: string; proposal_value: number | null; confidence: number | null }>;
  meetings: Array<{ status: string }>;
  meeting_outcomes: Array<{ outcome_type: string }>;
  prospects_total: number;
}

function pct(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.round((num / den) * 1000) / 10; // one decimal
}

async function loadStats(admin: any, userIds: string[], sinceIso: string): Promise<Map<string, UserStats>> {
  const out = new Map<string, UserStats>();
  for (const id of userIds) {
    out.set(id, { user_id: id, outcomes: [], proposals: [], meetings: [], meeting_outcomes: [], prospects_total: 0 });
  }
  const [oRes, pRes, mRes, mxRes, prRes] = await Promise.all([
    admin.from("outcomes").select("user_id,outcome_type,actual_value,expected_value,delta").gte("created_at", sinceIso).in("user_id", userIds),
    admin.from("proposals").select("user_id,status,proposal_value,confidence").gte("updated_at", sinceIso).in("user_id", userIds),
    admin.from("meetings").select("user_id,status").gte("scheduled_at", sinceIso).in("user_id", userIds),
    admin.from("meeting_outcomes").select("user_id,outcome_type").gte("created_at", sinceIso).in("user_id", userIds),
    admin.from("prospects").select("user_id").gte("created_at", sinceIso).in("user_id", userIds),
  ]);
  for (const r of (oRes.data ?? [])) out.get(r.user_id)?.outcomes.push(r);
  for (const r of (pRes.data ?? [])) out.get(r.user_id)?.proposals.push(r);
  for (const r of (mRes.data ?? [])) out.get(r.user_id)?.meetings.push(r);
  for (const r of (mxRes.data ?? [])) out.get(r.user_id)?.meeting_outcomes.push(r);
  for (const r of (prRes.data ?? [])) {
    const u = out.get(r.user_id);
    if (u) u.prospects_total++;
  }
  return out;
}

function deriveRecs(s: UserStats): Array<{ model_area: string; recommendation: string; evidence: Record<string, unknown>; confidence: number }> {
  const recs: Array<{ model_area: string; recommendation: string; evidence: Record<string, unknown>; confidence: number }> = [];

  // Proposal acceptance rate
  const decided = s.proposals.filter(p => p.status === "accepted" || p.status === "rejected");
  const accepted = s.proposals.filter(p => p.status === "accepted");
  if (decided.length >= 5) {
    const rate = pct(accepted.length, decided.length);
    if (rate < 20) {
      recs.push({
        model_area: "qualification",
        recommendation: `Proposal acceptance is ${rate}% over the last ${LOOKBACK_DAYS}d (n=${decided.length}). Consider tightening the qualification thresholds (raise min_opportunity_score by 5–10) before proposals are drafted.`,
        evidence: { window_days: LOOKBACK_DAYS, accepted: accepted.length, decided: decided.length, rate_pct: rate },
        confidence: 70,
      });
    } else if (rate > 65) {
      recs.push({
        model_area: "qualification",
        recommendation: `Proposal acceptance is ${rate}% (n=${decided.length}). The qualifier is likely too strict — consider lowering min_opportunity_score by 5 to widen the funnel.`,
        evidence: { rate_pct: rate, decided: decided.length },
        confidence: 60,
      });
    }
  }

  // Expected vs actual value
  const wins = s.outcomes.filter(o => o.outcome_type === "won" && o.expected_value != null && o.actual_value != null);
  if (wins.length >= 3) {
    const sumExp = wins.reduce((a, w) => a + (Number(w.expected_value) || 0), 0);
    const sumAct = wins.reduce((a, w) => a + (Number(w.actual_value) || 0), 0);
    if (sumExp > 0) {
      const ratio = sumAct / sumExp;
      if (ratio < 0.7) {
        recs.push({
          model_area: "expected_value",
          recommendation: `Actual revenue is ${Math.round(ratio * 100)}% of expected on the last ${wins.length} wins. Expected-value estimates are running high — consider a 0.8× damping factor.`,
          evidence: { wins: wins.length, sum_expected: sumExp, sum_actual: sumAct, ratio },
          confidence: 75,
        });
      } else if (ratio > 1.3) {
        recs.push({
          model_area: "expected_value",
          recommendation: `Actual revenue is ${Math.round(ratio * 100)}% of expected on the last ${wins.length} wins. Expected-value estimates are conservative — consider 1.2× upward correction.`,
          evidence: { wins: wins.length, ratio },
          confidence: 65,
        });
      }
    }
  }

  // Meeting conversion
  const totalMeetings = s.meetings.length;
  const completedMeetings = s.meetings.filter(m => m.status === "completed").length;
  const meetingsToProposal = s.meeting_outcomes.filter(o => o.outcome_type === "proposal_requested").length;
  if (totalMeetings >= 3) {
    const completeRate = pct(completedMeetings, totalMeetings);
    if (completeRate < 50) {
      recs.push({
        model_area: "outreach",
        recommendation: `Only ${completeRate}% of scheduled meetings (${completedMeetings}/${totalMeetings}) completed. Look at no-show patterns and add confirmation messages.`,
        evidence: { completed: completedMeetings, scheduled: totalMeetings },
        confidence: 60,
      });
    }
    if (completedMeetings > 0) {
      const conv = pct(meetingsToProposal, completedMeetings);
      if (conv < 20) {
        recs.push({
          model_area: "qualification",
          recommendation: `${conv}% of completed meetings led to proposal requests (${meetingsToProposal}/${completedMeetings}). Qualification may be advancing weak fits.`,
          evidence: { proposals_requested: meetingsToProposal, completed_meetings: completedMeetings },
          confidence: 55,
        });
      }
    }
  }

  // Autopilot signal: many lost proposals after autopilot send -> raise min_confidence
  const losses = s.outcomes.filter(o => o.outcome_type === "lost").length;
  if (decided.length >= 5 && losses / decided.length > 0.7) {
    recs.push({
      model_area: "autopilot",
      recommendation: `${losses}/${decided.length} decided proposals were lost. Consider raising autopilot min_confidence by 5–10 points and adding more segments to approval_required_segments until the loss rate drops below 60%.`,
      evidence: { losses, decided: decided.length },
      confidence: 65,
    });
  }

  return recs;
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  const cronErr = requireCron(req);
  if (cronErr) return cronErr;
  await safeJson(req);

  const admin = adminClient();
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  try {
    // Users to consider: anyone with recent outcomes / proposals / meetings / autopilot enabled.
    const ids = new Set<string>();
    const [{ data: ap }, { data: pr }, { data: oc }, { data: mt }] = await Promise.all([
      admin.from("autopilot_settings").select("user_id").eq("enabled", true),
      admin.from("proposals").select("user_id").gte("updated_at", sinceIso),
      admin.from("outcomes").select("user_id").gte("created_at", sinceIso),
      admin.from("meetings").select("user_id").gte("scheduled_at", sinceIso),
    ]);
    for (const r of [...(ap ?? []), ...(pr ?? []), ...(oc ?? []), ...(mt ?? [])]) ids.add(r.user_id);
    const userIds = [...ids];

    if (userIds.length === 0) {
      return jsonResponse({ ok: true, rule_version: RULE_VERSION, users: 0, recommendations: 0 });
    }

    const stats = await loadStats(admin, userIds, sinceIso);
    let totalRecs = 0;
    for (const s of stats.values()) {
      const recs = deriveRecs(s);
      for (const rec of recs) {
        await admin.from("model_recommendations").insert({
          user_id: s.user_id,
          model_area: rec.model_area,
          recommendation: rec.recommendation,
          evidence: rec.evidence,
          confidence: rec.confidence,
          applied: false,
          rule_version: RULE_VERSION,
        });
        totalRecs++;
      }
    }

    return jsonResponse({ ok: true, rule_version: RULE_VERSION, users: userIds.length, recommendations: totalRecs });
  } catch (e) {
    console.error("[recalibrate-models] fatal", e);
    return errorResponse((e as Error).message, 500);
  }
});
