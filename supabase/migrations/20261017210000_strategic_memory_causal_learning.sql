-- ScrollMarketer Phase 6: Strategic Memory & Causal Learning
-- Extend the existing durable learning_events log rather than creating a parallel
-- memory system. Tactical learning_insights remains an ephemeral operational cache.
-- Causal claims remain explicitly qualified: correlation/support does not prove causation.

ALTER TABLE public.learning_events
  ADD COLUMN IF NOT EXISTS app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES public.growth_goals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES public.strategic_decisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS market_option_id uuid REFERENCES public.strategic_market_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scenario_id uuid REFERENCES public.strategic_scenarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS learning_kind text NOT NULL DEFAULT 'operational',
  ADD COLUMN IF NOT EXISTS action_summary text,
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS outcome_summary text,
  ADD COLUMN IF NOT EXISTS outcome_direction text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS mechanism_hypothesis text,
  ADD COLUMN IF NOT EXISTS causal_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS confidence integer,
  ADD COLUMN IF NOT EXISTS transferability_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS transferability_scope text,
  ADD COLUMN IF NOT EXISTS transferability_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS supersedes_learning_event_id uuid REFERENCES public.learning_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.learning_events
  DROP CONSTRAINT IF EXISTS learning_events_source_type_check,
  ADD CONSTRAINT learning_events_source_type_check
    CHECK (source_type = ANY (ARRAY[
      'meeting','proposal','outcome','autopilot','qualification','expected_value','manual',
      'strategic_decision','campaign','experiment','market','scenario','transfer_test'
    ])),
  DROP CONSTRAINT IF EXISTS learning_events_learning_kind_check,
  ADD CONSTRAINT learning_events_learning_kind_check
    CHECK (learning_kind = ANY (ARRAY[
      'operational','strategic_postmortem','mechanism_hypothesis','correction','transfer_result'
    ])),
  DROP CONSTRAINT IF EXISTS learning_events_outcome_direction_check,
  ADD CONSTRAINT learning_events_outcome_direction_check
    CHECK (outcome_direction = ANY (ARRAY['positive','negative','mixed','neutral','unknown'])),
  DROP CONSTRAINT IF EXISTS learning_events_causal_status_check,
  ADD CONSTRAINT learning_events_causal_status_check
    CHECK (causal_status = ANY (ARRAY['unknown','correlation','plausible','supported','challenged','falsified'])),
  DROP CONSTRAINT IF EXISTS learning_events_confidence_check,
  ADD CONSTRAINT learning_events_confidence_check
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  DROP CONSTRAINT IF EXISTS learning_events_transferability_status_check,
  ADD CONSTRAINT learning_events_transferability_status_check
    CHECK (transferability_status = ANY (ARRAY['unknown','local_only','candidate','tested','not_transferable'])),
  DROP CONSTRAINT IF EXISTS learning_events_status_check,
  ADD CONSTRAINT learning_events_status_check
    CHECK (status = ANY (ARRAY['active','superseded','invalidated']));

CREATE INDEX IF NOT EXISTS learning_events_user_app_strategic_idx
  ON public.learning_events (user_id, app_id, learning_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_events_decision_idx
  ON public.learning_events (decision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_events_mechanism_idx
  ON public.learning_events (user_id, causal_status, transferability_status, created_at DESC)
  WHERE mechanism_hypothesis IS NOT NULL;

DROP TRIGGER IF EXISTS learning_events_set_updated_at ON public.learning_events;
CREATE TRIGGER learning_events_set_updated_at
  BEFORE UPDATE ON public.learning_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Structured provenance links keep evidence separate from interpretation.
CREATE TABLE IF NOT EXISTS public.strategic_learning_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  learning_event_id uuid NOT NULL REFERENCES public.learning_events(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL REFERENCES public.strategic_evidence_items(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'supports'
    CHECK (relationship = ANY (ARRAY['supports','challenges','context'])),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learning_event_id, evidence_item_id, relationship)
);

CREATE INDEX IF NOT EXISTS strategic_learning_evidence_learning_idx
  ON public.strategic_learning_evidence_links (learning_event_id, created_at ASC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_learning_evidence_links TO authenticated;
GRANT ALL ON public.strategic_learning_evidence_links TO service_role;
ALTER TABLE public.strategic_learning_evidence_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic learning evidence links" ON public.strategic_learning_evidence_links;
CREATE POLICY "Users manage own strategic learning evidence links"
  ON public.strategic_learning_evidence_links
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- Transfer tests test whether a mechanism learned in one context survives another.
-- Completion does not automatically promote causal_status or transferability_status.
CREATE TABLE IF NOT EXISTS public.strategic_learning_transfer_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_learning_event_id uuid NOT NULL REFERENCES public.learning_events(id) ON DELETE CASCADE,
  target_app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  target_decision_id uuid REFERENCES public.strategic_decisions(id) ON DELETE SET NULL,
  evidence_item_id uuid REFERENCES public.strategic_evidence_items(id) ON DELETE SET NULL,
  target_market text,
  target_segment text,
  test_title text NOT NULL,
  hypothesis text NOT NULL,
  method text,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status = ANY (ARRAY['planned','running','completed','cancelled'])),
  result text NOT NULL DEFAULT 'unknown'
    CHECK (result = ANY (ARRAY['unknown','supported','mixed','challenged','falsified'])),
  confidence_before integer CHECK (confidence_before IS NULL OR confidence_before BETWEEN 0 AND 100),
  confidence_after integer CHECK (confidence_after IS NULL OR confidence_after BETWEEN 0 AND 100),
  outcome_summary text,
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_learning_transfer_source_idx
  ON public.strategic_learning_transfer_tests (source_learning_event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_learning_transfer_user_target_idx
  ON public.strategic_learning_transfer_tests (user_id, target_app_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_learning_transfer_tests TO authenticated;
GRANT ALL ON public.strategic_learning_transfer_tests TO service_role;
ALTER TABLE public.strategic_learning_transfer_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic learning transfer tests" ON public.strategic_learning_transfer_tests;
CREATE POLICY "Users manage own strategic learning transfer tests"
  ON public.strategic_learning_transfer_tests
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- Cross-entity ownership + semantic safeguards for durable strategic learning.
CREATE OR REPLACE FUNCTION public.validate_strategic_learning_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.app_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.apps WHERE id = NEW.app_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Learning event app must belong to the same user';
  END IF;
  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.growth_goals WHERE id = NEW.goal_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Learning event goal must belong to the same user';
  END IF;
  IF NEW.decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.strategic_decisions WHERE id = NEW.decision_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Learning event decision must belong to the same user';
  END IF;
  IF NEW.market_option_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.strategic_market_options WHERE id = NEW.market_option_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Learning event market option must belong to the same user';
  END IF;
  IF NEW.scenario_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.strategic_scenarios WHERE id = NEW.scenario_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Learning event scenario must belong to the same user';
  END IF;
  IF NEW.supersedes_learning_event_id IS NOT NULL THEN
    IF NEW.supersedes_learning_event_id = NEW.id THEN
      RAISE EXCEPTION 'Learning event cannot supersede itself';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.learning_events
      WHERE id = NEW.supersedes_learning_event_id AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Superseded learning event must belong to the same user';
    END IF;
  END IF;
  IF NEW.learning_kind = 'mechanism_hypothesis'
     AND (NEW.mechanism_hypothesis IS NULL OR btrim(NEW.mechanism_hypothesis) = '') THEN
    RAISE EXCEPTION 'Mechanism-hypothesis learning requires an explicit hypothesis';
  END IF;
  IF NEW.causal_status <> 'unknown'
     AND (NEW.mechanism_hypothesis IS NULL OR btrim(NEW.mechanism_hypothesis) = '') THEN
    RAISE EXCEPTION 'Non-unknown causal status requires an explicit mechanism hypothesis';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS learning_events_validate_strategic_memory ON public.learning_events;
CREATE TRIGGER learning_events_validate_strategic_memory
  BEFORE INSERT OR UPDATE ON public.learning_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_learning_event();

CREATE OR REPLACE FUNCTION public.validate_strategic_learning_evidence_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.learning_events
    WHERE id = NEW.learning_event_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Learning event evidence link must use an owned learning event';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.strategic_evidence_items
    WHERE id = NEW.evidence_item_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Learning event evidence link must use owned evidence';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_learning_evidence_validate_ownership ON public.strategic_learning_evidence_links;
CREATE TRIGGER strategic_learning_evidence_validate_ownership
  BEFORE INSERT OR UPDATE ON public.strategic_learning_evidence_links
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_learning_evidence_link();

CREATE OR REPLACE FUNCTION public.prepare_strategic_learning_transfer_test()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  source_mechanism text;
BEGIN
  SELECT mechanism_hypothesis INTO source_mechanism
  FROM public.learning_events
  WHERE id = NEW.source_learning_event_id AND user_id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer test source learning event must belong to the same user';
  END IF;
  IF source_mechanism IS NULL OR btrim(source_mechanism) = '' THEN
    RAISE EXCEPTION 'Transfer tests require a source learning event with an explicit mechanism hypothesis';
  END IF;
  IF NEW.target_app_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.apps WHERE id = NEW.target_app_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Transfer-test target app must belong to the same user';
  END IF;
  IF NEW.target_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.strategic_decisions WHERE id = NEW.target_decision_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Transfer-test target decision must belong to the same user';
  END IF;
  IF NEW.evidence_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.strategic_evidence_items WHERE id = NEW.evidence_item_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Transfer-test evidence must belong to the same user';
  END IF;

  IF NEW.status = 'running' AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;
  IF NEW.status = 'completed' THEN
    IF NEW.result = 'unknown' THEN
      RAISE EXCEPTION 'Completed transfer test requires an explicit result';
    END IF;
    NEW.started_at := COALESCE(NEW.started_at, now());
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSIF NEW.status <> 'completed' THEN
    NEW.completed_at := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_learning_transfer_prepare ON public.strategic_learning_transfer_tests;
CREATE TRIGGER strategic_learning_transfer_prepare
  BEFORE INSERT OR UPDATE ON public.strategic_learning_transfer_tests
  FOR EACH ROW EXECUTE FUNCTION public.prepare_strategic_learning_transfer_test();

DROP TRIGGER IF EXISTS strategic_learning_transfer_set_updated_at ON public.strategic_learning_transfer_tests;
CREATE TRIGGER strategic_learning_transfer_set_updated_at
  BEFORE UPDATE ON public.strategic_learning_transfer_tests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.learning_events IS
  'Durable learning log. Phase 6 extends it with strategic context, outcome, mechanism hypotheses, causal qualification and transferability without replacing existing operational learning.';
COMMENT ON COLUMN public.learning_events.causal_status IS
  'Explicit epistemic status of the mechanism hypothesis. supported means evidence supports the hypothesis; it does not prove causation.';
COMMENT ON COLUMN public.learning_events.source_snapshot IS
  'What was known/recorded at learning time. Preserve provenance; do not silently rewrite historical context.';
COMMENT ON TABLE public.strategic_learning_evidence_links IS
  'Structured provenance links between durable learning events and strategic evidence, classified as supporting, challenging or contextual.';
COMMENT ON TABLE public.strategic_learning_transfer_tests IS
  'Explicit tests of whether a mechanism learned in one context transfers to another. Results never auto-promote causal claims.';
