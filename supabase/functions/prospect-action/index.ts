import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

type Action =
  | "save" | "watch" | "dismiss" | "view"
  | "mark_contacted" | "mark_responded" | "mark_converted"
  | "mark_qualified" | "mark_meeting" | "mark_proposal" | "mark_won" | "mark_lost"
  | "update_contact" | "set_stage"
  | "generate_outreach" | "generate_campaign";

async function aiText(system: string, user: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}

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

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = (await req.json()) as {
      prospect_id: string;
      action: Action;
      channel?: string;
      stage?: string;
      contact?: Record<string, unknown>;
    };
    const { prospect_id, action, channel, stage, contact } = body;
    if (!prospect_id || !action) {
      return new Response(JSON.stringify({ error: "prospect_id and action required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: prospect, error: pErr } = await admin.from("prospects").select("*").eq("id", prospect_id).eq("user_id", user.id).maybeSingle();
    if (pErr || !prospect) return new Response(JSON.stringify({ error: "Prospect not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const logAction = async (extra: Record<string, any> = {}) => {
      await admin.from("prospect_actions").insert({ user_id: user.id, prospect_id, action_type: action, channel: channel ?? null, ...extra });
    };

    const nowIso = new Date().toISOString();
    const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const ALLOWED_STAGES = ["new","saved","qualified","contacted","responded","meeting","proposal","won","lost"] as const;
    const ALLOWED_CONTACT_FIELDS = [
      "contact_email","contact_name","contact_linkedin","contact_role",
      "company_size","industry","notes","next_action_at",
    ];

    let result: any = { ok: true };

    if (["save", "watch", "dismiss"].includes(action)) {
      const status = action === "save" ? "saved" : action === "watch" ? "watching" : "dismissed";
      const nextStage = action === "dismiss" ? "lost" : "saved";
      await admin.from("prospects").update({
        status,
        stage: nextStage,
        saved_at: status === "saved" || status === "watching" ? nowIso : prospect.saved_at,
      }).eq("id", prospect_id);
      await logAction();
    } else if (action === "view") {
      await logAction();
    } else if (action === "mark_contacted") {
      await admin.from("prospects").update({
        status: "contacted",
        stage: "contacted",
        contacted_at: nowIso,
        last_contacted_at: nowIso,
        next_action_at: daysFromNow(3),
      }).eq("id", prospect_id);
      await logAction();
    } else if (action === "mark_responded") {
      await admin.from("prospects").update({
        status: "responded", stage: "responded", responded_at: nowIso, next_action_at: daysFromNow(1),
      }).eq("id", prospect_id);
      await logAction();
    } else if (action === "mark_qualified") {
      await admin.from("prospects").update({ stage: "qualified" }).eq("id", prospect_id);
      await logAction();
    } else if (action === "mark_meeting") {
      await admin.from("prospects").update({ stage: "meeting", next_action_at: daysFromNow(7) }).eq("id", prospect_id);
      await logAction();
    } else if (action === "mark_proposal") {
      await admin.from("prospects").update({ stage: "proposal", next_action_at: daysFromNow(5) }).eq("id", prospect_id);
      await logAction();
    } else if (action === "mark_won" || action === "mark_converted") {
      await admin.from("prospects").update({
        status: "converted", stage: "won", converted_at: nowIso, next_action_at: null,
      }).eq("id", prospect_id);
      await logAction();
    } else if (action === "mark_lost") {
      await admin.from("prospects").update({ stage: "lost", next_action_at: null }).eq("id", prospect_id);
      await logAction();
    } else if (action === "set_stage") {
      if (!stage || !ALLOWED_STAGES.includes(stage as any)) {
        return new Response(JSON.stringify({ error: "invalid stage" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await admin.from("prospects").update({ stage }).eq("id", prospect_id);
      await logAction({ body: stage });
    } else if (action === "update_contact") {
      const patch: Record<string, unknown> = {};
      for (const k of ALLOWED_CONTACT_FIELDS) {
        if (contact && k in contact) patch[k] = (contact as any)[k];
      }
      if (Object.keys(patch).length === 0) {
        return new Response(JSON.stringify({ error: "no valid fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await admin.from("prospects").update(patch).eq("id", prospect_id);
      await logAction();
    } else if (action === "generate_outreach") {
      // pull product + persona context
      const [appRes, personaRes] = await Promise.all([
        prospect.app_id ? admin.from("apps").select("name, description, target_audience, website_url").eq("id", prospect.app_id).maybeSingle() : Promise.resolve({ data: null } as any),
        prospect.matched_persona_id ? admin.from("personas").select("*").eq("id", prospect.matched_persona_id).maybeSingle() : Promise.resolve({ data: null } as any),
      ]);
      const ch = channel ?? (prospect.category === "grant" ? "grant_application" : prospect.category === "partner" ? "partnership_pitch" : "linkedin_message");

      const styleGuide: Record<string, string> = {
        linkedin_message: "Short LinkedIn DM. Under 90 words. Natural, human, no buzzwords. One specific reason it's relevant to them. One soft CTA.",
        email: "Cold email. Subject line + body. Under 130 words. Personal opener tied to a real signal, value in 2 sentences, soft CTA.",
        partnership_pitch: "Partnership outreach. Why mutual fit, what we offer, what we'd ask. Under 180 words. Professional.",
        grant_application: "Short grant pitch (300-400 words): problem, solution, traction, ask, fit to this program.",
      };

      const text = await aiText(
        "You write outreach for an AI growth platform. Natural, human, simple. Never use AI buzzwords like 'revolutionize'. Always concrete.",
        `Write a ${ch} for this prospect.

PRODUCT: ${JSON.stringify(appRes.data ?? {})}
PROSPECT: ${prospect.name} — ${prospect.description ?? ""} (${prospect.category}) ${prospect.url ?? ""}
MATCH REASON: ${prospect.match_reason ?? "n/a"}
SIGNALS: ${JSON.stringify(prospect.signals ?? [])}
PERSONA: ${JSON.stringify(personaRes.data ?? {})}

Style: ${styleGuide[ch] ?? styleGuide.linkedin_message}

Return plain text only. If email, start with "Subject: ..." on the first line.`
      );

      let subject: string | null = null;
      let bodyText = text.trim();
      if (ch === "email") {
        const m = bodyText.match(/^Subject:\s*(.+)$/im);
        if (m) {
          subject = m[1].trim();
          bodyText = bodyText.replace(m[0], "").trim();
        }
      }
      const { data: act } = await admin
        .from("prospect_actions")
        .insert({ user_id: user.id, prospect_id, action_type: ch, channel: ch, subject, body: bodyText })
        .select()
        .single();
      result = { action: act };
    } else if (action === "generate_campaign") {
      const { data: campaign, error: cErr } = await admin
        .from("campaigns")
        .insert({
          user_id: user.id,
          app_id: prospect.app_id,
          campaign_name: `Targeting: ${prospect.name}`,
          strategy_summary: `Campaign targeting ${prospect.category} prospect "${prospect.name}". ${prospect.match_reason ?? ""}`,
          themes: prospect.signals ?? [],
          platform_mix: ["linkedin", "x"],
          posting_frequency: 3,
        })
        .select()
        .single();
      if (cErr) throw cErr;
      await admin.from("prospect_actions").insert({ user_id: user.id, prospect_id, action_type: "campaign", campaign_id: campaign.id });
      result = { campaign };
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("prospect-action", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
