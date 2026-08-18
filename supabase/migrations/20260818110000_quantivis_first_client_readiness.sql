-- Quantivis first-client readiness hardening.
-- Additive/idempotent schema changes plus a guarded production seed for the
-- existing Quantivis account. External outreach remains disabled.

-- 1) Enrich ICP records so qualification has structured commercial context.
ALTER TABLE public.icps
  ADD COLUMN IF NOT EXISTS geography text,
  ADD COLUMN IF NOT EXISTS pain_points text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS buying_triggers text[] NOT NULL DEFAULT '{}';

-- 2) Separate theoretical account fit from practical sales readiness.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS account_fit_score integer,
  ADD COLUMN IF NOT EXISTS contactability_score integer,
  ADD COLUMN IF NOT EXISTS buying_intent_score integer,
  ADD COLUMN IF NOT EXISTS sales_readiness_score integer,
  ADD COLUMN IF NOT EXISTS sales_readiness_confidence integer,
  ADD COLUMN IF NOT EXISTS sales_readiness_reasoning text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_account_fit_score_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_account_fit_score_check
      CHECK (account_fit_score IS NULL OR account_fit_score BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_contactability_score_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_contactability_score_check
      CHECK (contactability_score IS NULL OR contactability_score BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_buying_intent_score_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_buying_intent_score_check
      CHECK (buying_intent_score IS NULL OR buying_intent_score BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_sales_readiness_score_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_sales_readiness_score_check
      CHECK (sales_readiness_score IS NULL OR sales_readiness_score BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_sales_readiness_confidence_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_sales_readiness_confidence_check
      CHECK (sales_readiness_confidence IS NULL OR sales_readiness_confidence BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS prospects_user_sales_readiness_idx
  ON public.prospects (user_id, sales_readiness_score DESC NULLS LAST);

-- 3) Approval-first controls. These are additive and default safe for new rows.
ALTER TABLE public.autopilot_settings
  ADD COLUMN IF NOT EXISTS min_reachability integer NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS require_named_decision_maker boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS first_touch_requires_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS discovery_daily_cap integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS outreach_draft_daily_cap integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS autonomous_send_cap integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autopilot_min_reachability_check') THEN
    ALTER TABLE public.autopilot_settings ADD CONSTRAINT autopilot_min_reachability_check
      CHECK (min_reachability BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autopilot_discovery_daily_cap_check') THEN
    ALTER TABLE public.autopilot_settings ADD CONSTRAINT autopilot_discovery_daily_cap_check
      CHECK (discovery_daily_cap BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autopilot_outreach_draft_daily_cap_check') THEN
    ALTER TABLE public.autopilot_settings ADD CONSTRAINT autopilot_outreach_draft_daily_cap_check
      CHECK (outreach_draft_daily_cap BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autopilot_autonomous_send_cap_check') THEN
    ALTER TABLE public.autopilot_settings ADD CONSTRAINT autopilot_autonomous_send_cap_check
      CHECK (autonomous_send_cap BETWEEN 0 AND 50);
  END IF;
END $$;

-- 4) Guarded Quantivis commercial configuration for the audited production account.
DO $$
DECLARE
  v_user uuid := '10525040-67fa-4851-b1dd-7223cf4470d2';
  v_app uuid := '4b4a5e79-538a-477e-b378-03a88cef62eb';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user)
     AND EXISTS (SELECT 1 FROM public.apps WHERE id = v_app AND user_id = v_user)
  THEN
    UPDATE public.apps
      SET description = 'AI-native execution intelligence platform that turns strategic decisions into measurable execution with evidence, accountability, early risk detection and intervention.',
          target_audience = '50-500 employee companies coordinating execution across multiple teams; primary buyers are COO / Head of Operations, with Chief of Staff, VP Strategy, Transformation Lead and PMO Lead as secondary buyers.',
          updated_at = now()
      WHERE id = v_app AND user_id = v_user;

    INSERT INTO public.icps (user_id, app_id, segment, company_size, industry, geography, signals, pain_points, buying_triggers, notes, sort_order)
    SELECT v_user, v_app, x.segment, '50-500 employees', x.industry, 'UK/EU + North America',
           ARRAY['multi-team execution','quarterly plans','operational complexity'],
           ARRAY['leadership lacks reliable visibility into whether strategic decisions are being executed','execution gaps surface too late','accountability and evidence are fragmented'],
           ARRAY['recent funding','scaling complexity','missed targets','transformation programme','new COO or operations leader','PMO/operations hiring'],
           'Offer: Quantivis Execution Intelligence Pilot; 30-45 days; one business unit/team and selected strategic decisions; objective is measurable visibility into execution gaps, risk and outcomes.',
           x.sort_order
      FROM (VALUES
        ('B2B SaaS','B2B SaaS',1),
        ('Professional Services','Consulting / Professional Services',2),
        ('PE-backed Operators','PE-backed operating companies',3),
        ('Mid-market Manufacturing','Manufacturing',4)
      ) AS x(segment, industry, sort_order)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.icps i
        WHERE i.app_id = v_app AND i.user_id = v_user AND lower(i.segment) = lower(x.segment)
      );

    INSERT INTO public.personas (user_id, app_id, title, company_size, responsibilities, pains, goals, triggers, channels, content_style, sort_order)
    SELECT v_user, v_app, x.title, '50-500 employees', x.responsibilities, x.pains, x.goals, x.triggers,
           ARRAY['email','linkedin'], 'Concise, evidence-led, operational and outcome-focused', x.sort_order
      FROM (VALUES
        ('COO / Head of Operations', ARRAY['cross-functional execution','operating cadence','delivery against strategic priorities'], ARRAY['poor visibility into execution','late discovery of delivery risk','fragmented accountability'], ARRAY['predict execution risk earlier','turn decisions into measurable outcomes','improve operating discipline'], ARRAY['new operating plan','missed targets','rapid scaling','new COO appointment'], 1),
        ('Chief of Staff', ARRAY['executive priorities','cross-team coordination','decision follow-through'], ARRAY['executive decisions disappear into meetings','follow-through is hard to verify'], ARRAY['give leadership one evidence-backed view of execution','reduce coordination overhead'], ARRAY['new strategic initiative','leadership transition','quarterly planning'], 2),
        ('VP Strategy / Transformation Lead', ARRAY['strategy execution','transformation portfolio','benefits realization'], ARRAY['strategy-to-execution gap','weak evidence of realized outcomes'], ARRAY['connect strategic decisions to execution evidence','surface intervention points early'], ARRAY['transformation programme','restructuring','new strategic plan'], 3),
        ('PMO Lead', ARRAY['portfolio governance','milestones','dependencies','risk escalation'], ARRAY['manual reporting','late risk escalation','status without decision context'], ARRAY['improve decision traceability','detect execution gaps before milestones slip'], ARRAY['PMO hiring','programme launch','multi-project complexity'], 4)
      ) AS x(title, responsibilities, pains, goals, triggers, sort_order)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.personas p
        WHERE p.app_id = v_app AND p.user_id = v_user AND lower(p.title) = lower(x.title)
      );

    INSERT INTO public.autopilot_settings (
      user_id, enabled, min_opportunity_score, min_confidence, daily_send_cap,
      max_auto_value, allowed_segments, approval_required_segments,
      min_reachability, require_named_decision_maker, first_touch_requires_review,
      discovery_daily_cap, outreach_draft_daily_cap, autonomous_send_cap
    ) VALUES (
      v_user, false, 80, 60, 0, 5000,
      ARRAY['hot']::text[], ARRAY['hot','warm','nurture']::text[],
      70, true, true, 5, 3, 0
    )
    ON CONFLICT (user_id) DO UPDATE SET
      enabled = false,
      min_opportunity_score = 80,
      min_confidence = 60,
      daily_send_cap = 0,
      max_auto_value = 5000,
      allowed_segments = ARRAY['hot']::text[],
      approval_required_segments = ARRAY['hot','warm','nurture']::text[],
      min_reachability = 70,
      require_named_decision_maker = true,
      first_touch_requires_review = true,
      discovery_daily_cap = 5,
      outreach_draft_daily_cap = 3,
      autonomous_send_cap = 0,
      updated_at = now();

    UPDATE public.user_settings
      SET dawn_autopilot_enabled = false,
          approval_mode = true,
          updated_at = now()
      WHERE user_id = v_user;
  END IF;
END $$;
