
-- =================================================================
-- meetings (source-agnostic)
-- =================================================================
CREATE TABLE IF NOT EXISTS public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  proposal_id uuid, -- forward declaration; FK added after proposals exists
  title text NOT NULL,
  meeting_type text NOT NULL DEFAULT 'discovery'
    CHECK (meeting_type = ANY (ARRAY['discovery','demo','follow_up','closing','check_in','other'])),
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  meeting_url text,
  location text,
  agenda text,
  notes text,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status = ANY (ARRAY['scheduled','completed','cancelled','no_show'])),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source = ANY (ARRAY['manual','calendly','google_calendar','outlook','other'])),
  external_id text,
  external_url text,
  external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS meetings_source_external_uidx
  ON public.meetings (user_id, source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS meetings_user_scheduled_idx
  ON public.meetings (user_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS meetings_prospect_idx
  ON public.meetings (prospect_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own meetings" ON public.meetings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER meetings_set_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =================================================================
-- meeting_outcomes
-- =================================================================
CREATE TABLE IF NOT EXISTS public.meeting_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  outcome_type text NOT NULL
    CHECK (outcome_type = ANY (ARRAY['proposal_requested','follow_up','nurture','disqualified','won','lost'])),
  summary text,
  objections text[] NOT NULL DEFAULT ARRAY[]::text[],
  opportunities text[] NOT NULL DEFAULT ARRAY[]::text[],
  next_action text,
  confidence integer CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_outcomes_meeting_idx
  ON public.meeting_outcomes (meeting_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meeting_outcomes_user_idx
  ON public.meeting_outcomes (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_outcomes TO authenticated;
GRANT ALL ON public.meeting_outcomes TO service_role;

ALTER TABLE public.meeting_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own meeting outcomes" ON public.meeting_outcomes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =================================================================
-- proposals
-- =================================================================
CREATE TABLE IF NOT EXISTS public.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  proposal_title text NOT NULL,
  proposal_value numeric(12,2),
  currency text NOT NULL DEFAULT 'EUR',
  proposal_text text,
  scope text,
  deliverables jsonb NOT NULL DEFAULT '[]'::jsonb,
  timeline text,
  pricing_model text,
  pricing_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  roi_estimate text,
  next_steps text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','sent','viewed','accepted','rejected','expired'])),
  rejection_reason text,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  expires_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasoning text,
  confidence integer CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100)),
  ai_model text,
  ai_prompt_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposals_user_status_idx ON public.proposals (user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS proposals_prospect_idx ON public.proposals (prospect_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposals TO authenticated;
GRANT ALL ON public.proposals TO service_role;

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own proposals" ON public.proposals
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER proposals_set_updated_at
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Now we can wire the meetings.proposal_id FK
ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE SET NULL;

-- =================================================================
-- outcomes
-- =================================================================
CREATE TABLE IF NOT EXISTS public.outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  outcome_type text NOT NULL
    CHECK (outcome_type = ANY (ARRAY['won','lost','churned','expanded','upsold'])),
  actual_value numeric(12,2),
  expected_value numeric(12,2),
  delta numeric(12,2) GENERATED ALWAYS AS (COALESCE(actual_value,0) - COALESCE(expected_value,0)) STORED,
  confidence_before integer CHECK (confidence_before IS NULL OR (confidence_before BETWEEN 0 AND 100)),
  confidence_after integer CHECK (confidence_after IS NULL OR (confidence_after BETWEEN 0 AND 100)),
  currency text DEFAULT 'EUR',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outcomes_user_created_idx ON public.outcomes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outcomes_prospect_idx ON public.outcomes (prospect_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outcomes TO authenticated;
GRANT ALL ON public.outcomes TO service_role;

ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own outcomes" ON public.outcomes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =================================================================
-- learning_events
-- =================================================================
CREATE TABLE IF NOT EXISTS public.learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL
    CHECK (source_type = ANY (ARRAY['meeting','proposal','outcome','autopilot','qualification','expected_value','manual'])),
  source_id uuid,
  lesson text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_adjustment numeric(4,2) CHECK (confidence_adjustment IS NULL OR (confidence_adjustment BETWEEN -1 AND 1)),
  future_impact text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_events_user_idx ON public.learning_events (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_events TO authenticated;
GRANT ALL ON public.learning_events TO service_role;

ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own learning events" ON public.learning_events
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =================================================================
-- model_recommendations (advisory only)
-- =================================================================
CREATE TABLE IF NOT EXISTS public.model_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_area text NOT NULL
    CHECK (model_area = ANY (ARRAY['qualification','expected_value','autopilot','segment','outreach'])),
  recommendation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence integer CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100)),
  applied boolean NOT NULL DEFAULT false,
  applied_at timestamptz,
  applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rule_version text NOT NULL DEFAULT 'recalibrate-v1',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_recs_user_idx ON public.model_recommendations (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_recommendations TO authenticated;
GRANT ALL ON public.model_recommendations TO service_role;

ALTER TABLE public.model_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own model recommendations" ON public.model_recommendations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =================================================================
-- AUTOMATION TRIGGERS
-- =================================================================

-- Meeting outcome -> pipeline + learning event
CREATE OR REPLACE FUNCTION public.on_meeting_outcome_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  prosp_id uuid;
BEGIN
  SELECT prospect_id INTO prosp_id FROM public.meetings WHERE id = NEW.meeting_id;

  IF NEW.outcome_type = 'proposal_requested' AND prosp_id IS NOT NULL THEN
    UPDATE public.prospects
      SET pipeline_stage = 'proposal',
          stage = CASE WHEN stage IN ('new','saved','qualified','contacted','responded','meeting')
                       THEN 'proposal' ELSE stage END,
          updated_at = now()
      WHERE id = prosp_id AND user_id = NEW.user_id;
  END IF;

  IF NEW.outcome_type IN ('won','lost') THEN
    INSERT INTO public.learning_events (user_id, source_type, source_id, lesson, evidence)
    VALUES (
      NEW.user_id, 'meeting', NEW.meeting_id,
      COALESCE(NEW.summary, 'Meeting ' || NEW.outcome_type),
      jsonb_build_object(
        'outcome_type', NEW.outcome_type,
        'objections', NEW.objections,
        'opportunities', NEW.opportunities,
        'next_action', NEW.next_action,
        'prospect_id', prosp_id
      )
    );
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.on_meeting_outcome_inserted() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER meeting_outcome_after_insert
  AFTER INSERT ON public.meeting_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.on_meeting_outcome_inserted();

-- Proposal status change -> stage + outcome + learning event
CREATE OR REPLACE FUNCTION public.on_proposal_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  prev_expected numeric(12,2);
  prev_conf integer;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'accepted' THEN
    IF NEW.accepted_at IS NULL THEN NEW.accepted_at := now(); END IF;

    IF NEW.prospect_id IS NOT NULL THEN
      SELECT expected_value, opportunity_confidence
        INTO prev_expected, prev_conf
        FROM public.prospects WHERE id = NEW.prospect_id;

      UPDATE public.prospects
        SET stage = 'won',
            pipeline_stage = 'won',
            actual_value = COALESCE(NEW.proposal_value, actual_value),
            outcome = 'won',
            won_at = COALESCE(won_at, now()),
            updated_at = now()
        WHERE id = NEW.prospect_id AND user_id = NEW.user_id;
    END IF;

    INSERT INTO public.outcomes (user_id, prospect_id, proposal_id, meeting_id, outcome_type,
                                  actual_value, expected_value, confidence_before, currency)
    VALUES (NEW.user_id, NEW.prospect_id, NEW.id, NEW.meeting_id, 'won',
            NEW.proposal_value, prev_expected, prev_conf, NEW.currency);

    INSERT INTO public.learning_events (user_id, source_type, source_id, lesson, evidence,
                                         confidence_adjustment, future_impact)
    VALUES (
      NEW.user_id, 'proposal', NEW.id,
      'Proposal accepted: ' || NEW.proposal_title,
      jsonb_build_object(
        'value', NEW.proposal_value, 'currency', NEW.currency,
        'expected_value', prev_expected,
        'prospect_id', NEW.prospect_id),
      0.05,
      'Reinforce qualification + value signals that led to this win.'
    );
  END IF;

  IF NEW.status = 'rejected' THEN
    IF NEW.rejected_at IS NULL THEN NEW.rejected_at := now(); END IF;

    IF NEW.prospect_id IS NOT NULL THEN
      SELECT expected_value, opportunity_confidence
        INTO prev_expected, prev_conf
        FROM public.prospects WHERE id = NEW.prospect_id;

      UPDATE public.prospects
        SET stage = 'lost',
            pipeline_stage = 'lost',
            outcome = 'lost',
            lost_at = COALESCE(lost_at, now()),
            lost_reason = COALESCE(NEW.rejection_reason, lost_reason),
            updated_at = now()
        WHERE id = NEW.prospect_id AND user_id = NEW.user_id;
    END IF;

    INSERT INTO public.outcomes (user_id, prospect_id, proposal_id, meeting_id, outcome_type,
                                  actual_value, expected_value, confidence_before, notes, currency)
    VALUES (NEW.user_id, NEW.prospect_id, NEW.id, NEW.meeting_id, 'lost',
            0, prev_expected, prev_conf, NEW.rejection_reason, NEW.currency);

    INSERT INTO public.learning_events (user_id, source_type, source_id, lesson, evidence,
                                         confidence_adjustment, future_impact)
    VALUES (
      NEW.user_id, 'proposal', NEW.id,
      'Proposal rejected: ' || NEW.proposal_title,
      jsonb_build_object(
        'rejection_reason', NEW.rejection_reason,
        'expected_value', prev_expected,
        'prospect_id', NEW.prospect_id),
      -0.05,
      'Investigate qualification signals that overestimated fit.'
    );
  END IF;

  IF NEW.status = 'sent' AND NEW.sent_at IS NULL THEN
    NEW.sent_at := now();
  END IF;
  IF NEW.status = 'viewed' AND NEW.viewed_at IS NULL THEN
    NEW.viewed_at := now();
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.on_proposal_status_changed() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER proposals_status_change
  BEFORE UPDATE OF status ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.on_proposal_status_changed();

-- Some prospect columns referenced above may not exist yet — add them if missing.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS actual_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS won_at timestamptz,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz,
  ADD COLUMN IF NOT EXISTS lost_reason text;
