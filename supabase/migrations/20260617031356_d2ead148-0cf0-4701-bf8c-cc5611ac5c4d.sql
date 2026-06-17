
-- ============================================================
-- WAVE 4: Autonomous Prospecting + Expected Value
-- ============================================================

-- ----------------------------------------------------------
-- 1. Extend public.prospects (additive, all nullable)
-- ----------------------------------------------------------
ALTER TABLE public.prospects
  -- Enrichment (industry, company_size, location, contact_email already exist)
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS employee_count integer,
  ADD COLUMN IF NOT EXISTS revenue_band text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS technology_stack jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recent_news jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hiring_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS funding_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS decision_makers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS email_confidence integer,
  ADD COLUMN IF NOT EXISTS enrichment_confidence integer,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_source text,

  -- Qualification reasoning (scores themselves already exist)
  ADD COLUMN IF NOT EXISTS icp_fit_reasoning text,
  ADD COLUMN IF NOT EXISTS icp_fit_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS icp_fit_confidence integer,
  ADD COLUMN IF NOT EXISTS buying_signal_score integer,
  ADD COLUMN IF NOT EXISTS buying_signal_reasoning text,
  ADD COLUMN IF NOT EXISTS buying_signal_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS buying_signal_confidence integer,
  ADD COLUMN IF NOT EXISTS urgency_reasoning text,
  ADD COLUMN IF NOT EXISTS urgency_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS urgency_confidence integer,
  ADD COLUMN IF NOT EXISTS reachability_reasoning text,
  ADD COLUMN IF NOT EXISTS reachability_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reachability_confidence integer,
  ADD COLUMN IF NOT EXISTS opportunity_confidence integer,
  ADD COLUMN IF NOT EXISTS qualified_at timestamptz,

  -- Segmentation
  ADD COLUMN IF NOT EXISTS segment text,
  ADD COLUMN IF NOT EXISTS segment_reason text,

  -- Expected value (stored, not generated — to allow AI adjustment)
  ADD COLUMN IF NOT EXISTS deal_probability numeric,
  ADD COLUMN IF NOT EXISTS estimated_value numeric,
  ADD COLUMN IF NOT EXISTS expected_value numeric,
  ADD COLUMN IF NOT EXISTS expected_value_confidence integer,
  ADD COLUMN IF NOT EXISTS value_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS value_reasoning text,
  ADD COLUMN IF NOT EXISTS valued_at timestamptz,

  -- Autopilot routing
  ADD COLUMN IF NOT EXISTS autopilot_state text,
  ADD COLUMN IF NOT EXISTS autopilot_routed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_status text,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS review_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_decided_by uuid,

  -- Learning hooks (Wave 5 will write these; no UI yet)
  ADD COLUMN IF NOT EXISTS actual_value numeric,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS won_at timestamptz,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz;

-- Bound checks (only add if missing)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_segment_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_segment_check
      CHECK (segment IS NULL OR segment IN ('hot','warm','nurture','disqualify'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_autopilot_state_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_autopilot_state_check
      CHECK (autopilot_state IS NULL OR autopilot_state IN ('auto_sent','review_required','queued','blocked'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_review_status_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_review_status_check
      CHECK (review_status IS NULL OR review_status IN ('pending','approved','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_outcome_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_outcome_check
      CHECK (outcome IS NULL OR outcome IN ('won','lost','no_response','disqualified'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_deal_probability_check') THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_deal_probability_check
      CHECK (deal_probability IS NULL OR (deal_probability >= 0 AND deal_probability <= 1));
  END IF;
END $$;

-- Indexes for the new routing/segmentation queries
CREATE INDEX IF NOT EXISTS prospects_user_segment_idx
  ON public.prospects (user_id, segment);
CREATE INDEX IF NOT EXISTS prospects_user_autopilot_state_idx
  ON public.prospects (user_id, autopilot_state);
CREATE INDEX IF NOT EXISTS prospects_user_review_pending_idx
  ON public.prospects (user_id, review_queued_at DESC)
  WHERE review_status = 'pending';
CREATE INDEX IF NOT EXISTS prospects_user_expected_value_idx
  ON public.prospects (user_id, expected_value DESC NULLS LAST);

-- ----------------------------------------------------------
-- 2. autopilot_settings (one row per user)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.autopilot_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  min_opportunity_score integer NOT NULL DEFAULT 80,
  min_confidence integer NOT NULL DEFAULT 60,
  daily_send_cap integer NOT NULL DEFAULT 20,
  max_auto_value numeric NOT NULL DEFAULT 5000,
  allowed_segments text[] NOT NULL DEFAULT ARRAY['hot']::text[],
  approval_required_segments text[] NOT NULL DEFAULT ARRAY['warm']::text[],
  sent_today integer NOT NULL DEFAULT 0,
  sent_today_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.autopilot_settings TO authenticated;
GRANT ALL ON public.autopilot_settings TO service_role;

ALTER TABLE public.autopilot_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own autopilot settings" ON public.autopilot_settings;
CREATE POLICY "Users manage own autopilot settings"
  ON public.autopilot_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_autopilot_settings_updated_at ON public.autopilot_settings;
CREATE TRIGGER trg_autopilot_settings_updated_at
  BEFORE UPDATE ON public.autopilot_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------
-- 3. Trigger: compute expected_value when not explicitly set
--    Also derive segment from opportunity_score when missing.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospects_compute_derived()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Default expected_value to mathematical product if caller didn't set it
  IF NEW.expected_value IS NULL
     AND NEW.deal_probability IS NOT NULL
     AND NEW.estimated_value IS NOT NULL THEN
    NEW.expected_value := ROUND(NEW.deal_probability * NEW.estimated_value, 2);
  END IF;

  -- Auto-segment from opportunity_score when segment not provided
  IF NEW.segment IS NULL AND NEW.opportunity_score IS NOT NULL THEN
    NEW.segment := CASE
      WHEN NEW.opportunity_score >= 90 THEN 'hot'
      WHEN NEW.opportunity_score >= 75 THEN 'warm'
      WHEN NEW.opportunity_score >= 50 THEN 'nurture'
      ELSE 'disqualify'
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prospects_compute_derived ON public.prospects;
CREATE TRIGGER trg_prospects_compute_derived
  BEFORE INSERT OR UPDATE OF deal_probability, estimated_value, expected_value, opportunity_score, segment
  ON public.prospects
  FOR EACH ROW EXECUTE FUNCTION public.prospects_compute_derived();

-- ----------------------------------------------------------
-- 4. Reply trigger update: never downgrade advanced stages
--    Allowed -> responded: new, saved, qualified, contacted
--    Protected: meeting, proposal, won, lost, responded, converted
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.on_prospect_reply_inbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE paused_count int;
BEGIN
  IF NEW.direction = 'inbound' THEN
    UPDATE public.prospects
       SET stage = 'responded',
           pipeline_stage = COALESCE(pipeline_stage, 'responded'),
           responded_at = COALESCE(responded_at, NEW.received_at),
           last_contacted_at = GREATEST(COALESCE(last_contacted_at, NEW.received_at), NEW.received_at),
           updated_at = now()
     WHERE id = NEW.prospect_id
       AND user_id = NEW.user_id
       AND stage IN ('new','saved','qualified','contacted');

    INSERT INTO public.prospect_actions (user_id, prospect_id, action_type, channel, subject, body, metadata)
    VALUES (
      NEW.user_id, NEW.prospect_id, 'reply_received', NEW.channel,
      NEW.subject, NEW.body,
      jsonb_build_object('reply_id', NEW.id, 'source', NEW.source, 'from', NEW.from_address)
    );

    UPDATE public.prospect_sequences
       SET status = 'paused', updated_at = now()
     WHERE prospect_id = NEW.prospect_id
       AND user_id = NEW.user_id
       AND status = 'scheduled';
    GET DIAGNOSTICS paused_count = ROW_COUNT;

    IF paused_count > 0 THEN
      INSERT INTO public.prospect_actions (user_id, prospect_id, action_type, channel, metadata)
      VALUES (
        NEW.user_id, NEW.prospect_id, 'sequence_paused', NEW.channel,
        jsonb_build_object('paused_steps', paused_count, 'reason', 'inbound_reply', 'reply_id', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
