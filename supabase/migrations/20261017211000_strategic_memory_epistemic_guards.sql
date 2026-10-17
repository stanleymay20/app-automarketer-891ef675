-- ScrollMarketer Phase 6 hardening: epistemic integrity and durable-history guards.
-- Stronger causal/transferability labels require explicit backing evidence/tests.
-- This still does not claim proof of causation; it prevents unsupported promotion.

CREATE OR REPLACE FUNCTION public.validate_strategic_learning_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  canonical_app uuid := NEW.app_id;
  linked_app uuid;
  superseded_app uuid;
  has_supporting_observation boolean := false;
  has_challenging_observation boolean := false;
  has_challenging_experiment boolean := false;
  has_completed_transfer boolean := false;
  has_supported_transfer boolean := false;
  has_challenging_transfer boolean := false;
  has_falsifying_transfer boolean := false;
BEGIN
  IF canonical_app IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.apps WHERE id = canonical_app AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Learning event app must belong to the same user';
  END IF;

  IF NEW.goal_id IS NOT NULL THEN
    SELECT app_id INTO linked_app FROM public.growth_goals
    WHERE id = NEW.goal_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Learning event goal must belong to the same user'; END IF;
    IF canonical_app IS NULL THEN canonical_app := linked_app;
    ELSIF linked_app IS NOT NULL AND canonical_app <> linked_app THEN
      RAISE EXCEPTION 'Learning event goal must belong to the same app';
    END IF;
  END IF;

  IF NEW.decision_id IS NOT NULL THEN
    SELECT app_id INTO linked_app FROM public.strategic_decisions
    WHERE id = NEW.decision_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Learning event decision must belong to the same user'; END IF;
    IF canonical_app IS NULL THEN canonical_app := linked_app;
    ELSIF linked_app IS NOT NULL AND canonical_app <> linked_app THEN
      RAISE EXCEPTION 'Learning event decision must belong to the same app';
    END IF;
  END IF;

  IF NEW.market_option_id IS NOT NULL THEN
    SELECT app_id INTO linked_app FROM public.strategic_market_options
    WHERE id = NEW.market_option_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Learning event market option must belong to the same user'; END IF;
    IF canonical_app IS NULL THEN canonical_app := linked_app;
    ELSIF linked_app IS NOT NULL AND canonical_app <> linked_app THEN
      RAISE EXCEPTION 'Learning event market option must belong to the same app';
    END IF;
  END IF;

  IF NEW.scenario_id IS NOT NULL THEN
    SELECT app_id INTO linked_app FROM public.strategic_scenarios
    WHERE id = NEW.scenario_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Learning event scenario must belong to the same user'; END IF;
    IF canonical_app IS NULL THEN canonical_app := linked_app;
    ELSIF linked_app IS NOT NULL AND canonical_app <> linked_app THEN
      RAISE EXCEPTION 'Learning event scenario must belong to the same app';
    END IF;
  END IF;

  IF NEW.supersedes_learning_event_id IS NOT NULL THEN
    IF NEW.supersedes_learning_event_id = NEW.id THEN
      RAISE EXCEPTION 'Learning event cannot supersede itself';
    END IF;
    SELECT app_id INTO superseded_app FROM public.learning_events
    WHERE id = NEW.supersedes_learning_event_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Superseded learning event must belong to the same user'; END IF;
    IF canonical_app IS NOT NULL AND superseded_app IS NOT NULL AND canonical_app <> superseded_app THEN
      RAISE EXCEPTION 'Correction cannot supersede learning from another app';
    END IF;
  END IF;

  NEW.app_id := canonical_app;

  IF NEW.learning_kind = 'mechanism_hypothesis'
     AND (NEW.mechanism_hypothesis IS NULL OR btrim(NEW.mechanism_hypothesis) = '') THEN
    RAISE EXCEPTION 'Mechanism-hypothesis learning requires an explicit hypothesis';
  END IF;

  IF NEW.causal_status <> 'unknown'
     AND (NEW.mechanism_hypothesis IS NULL OR btrim(NEW.mechanism_hypothesis) = '') THEN
    RAISE EXCEPTION 'Non-unknown causal status requires an explicit mechanism hypothesis';
  END IF;

  -- Strong causal labels are post-creation review states because evidence links
  -- and transfer tests are attached after the learning event exists.
  IF NEW.causal_status IN ('supported','challenged','falsified') THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Strong causal status requires existing linked evidence or a completed transfer test';
    END IF;

    SELECT
      EXISTS (
        SELECT 1
        FROM public.strategic_learning_evidence_links l
        JOIN public.strategic_evidence_items e ON e.id = l.evidence_item_id
        WHERE l.learning_event_id = NEW.id
          AND l.user_id = NEW.user_id
          AND l.relationship = 'supports'
          AND e.item_type = 'observation'
          AND e.status = 'validated'
      ),
      EXISTS (
        SELECT 1
        FROM public.strategic_learning_evidence_links l
        JOIN public.strategic_evidence_items e ON e.id = l.evidence_item_id
        WHERE l.learning_event_id = NEW.id
          AND l.user_id = NEW.user_id
          AND l.relationship = 'challenges'
          AND e.item_type = 'observation'
          AND e.status = 'validated'
      ),
      EXISTS (
        SELECT 1
        FROM public.strategic_learning_evidence_links l
        JOIN public.strategic_evidence_items e ON e.id = l.evidence_item_id
        WHERE l.learning_event_id = NEW.id
          AND l.user_id = NEW.user_id
          AND l.relationship = 'challenges'
          AND e.item_type = 'observation'
          AND e.source_type = 'experiment'
          AND e.status = 'validated'
      )
    INTO has_supporting_observation, has_challenging_observation, has_challenging_experiment;

    SELECT
      EXISTS (
        SELECT 1 FROM public.strategic_learning_transfer_tests t
        WHERE t.source_learning_event_id = NEW.id AND t.user_id = NEW.user_id AND t.status = 'completed'
      ),
      EXISTS (
        SELECT 1 FROM public.strategic_learning_transfer_tests t
        WHERE t.source_learning_event_id = NEW.id AND t.user_id = NEW.user_id
          AND t.status = 'completed' AND t.result = 'supported'
      ),
      EXISTS (
        SELECT 1 FROM public.strategic_learning_transfer_tests t
        WHERE t.source_learning_event_id = NEW.id AND t.user_id = NEW.user_id
          AND t.status = 'completed' AND t.result IN ('mixed','challenged','falsified')
      ),
      EXISTS (
        SELECT 1 FROM public.strategic_learning_transfer_tests t
        WHERE t.source_learning_event_id = NEW.id AND t.user_id = NEW.user_id
          AND t.status = 'completed' AND t.result = 'falsified'
      )
    INTO has_completed_transfer, has_supported_transfer, has_challenging_transfer, has_falsifying_transfer;

    IF NEW.causal_status = 'supported' AND NOT (has_supporting_observation OR has_supported_transfer) THEN
      RAISE EXCEPTION 'Supported causal status requires validated supporting observation evidence or a completed supporting transfer test';
    END IF;
    IF NEW.causal_status = 'challenged' AND NOT (has_challenging_observation OR has_challenging_transfer) THEN
      RAISE EXCEPTION 'Challenged causal status requires validated challenging observation evidence or a completed challenging transfer test';
    END IF;
    IF NEW.causal_status = 'falsified' AND NOT (has_challenging_experiment OR has_falsifying_transfer) THEN
      RAISE EXCEPTION 'Falsified causal status requires validated challenging experiment evidence or a completed falsifying transfer test';
    END IF;
  END IF;

  IF NEW.transferability_status = 'tested' OR NEW.transferability_status = 'not_transferable' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Tested transferability states require a completed transfer test';
    END IF;
    IF NOT has_completed_transfer THEN
      SELECT EXISTS (
        SELECT 1 FROM public.strategic_learning_transfer_tests t
        WHERE t.source_learning_event_id = NEW.id AND t.user_id = NEW.user_id AND t.status = 'completed'
      ) INTO has_completed_transfer;
    END IF;
    IF NOT has_completed_transfer THEN
      RAISE EXCEPTION 'Transferability state requires a completed transfer test';
    END IF;
    IF NEW.transferability_status = 'not_transferable' AND NOT EXISTS (
      SELECT 1 FROM public.strategic_learning_transfer_tests t
      WHERE t.source_learning_event_id = NEW.id AND t.user_id = NEW.user_id
        AND t.status = 'completed' AND t.result IN ('challenged','falsified')
    ) THEN
      RAISE EXCEPTION 'Not-transferable status requires a completed challenged or falsified transfer test';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Preserve strategic history for ordinary authenticated clients. Service-role
-- maintenance remains possible because auth.uid() is NULL in that context.
CREATE OR REPLACE FUNCTION public.protect_strategic_learning_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.learning_kind <> 'operational' AND (select auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'Strategic learning is durable; invalidate or supersede it instead of deleting it';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS learning_events_protect_strategic_history ON public.learning_events;
CREATE TRIGGER learning_events_protect_strategic_history
  BEFORE DELETE ON public.learning_events
  FOR EACH ROW EXECUTE FUNCTION public.protect_strategic_learning_history();

-- A correction with an explicit predecessor marks that predecessor superseded;
-- the old record remains queryable for audit/history.
CREATE OR REPLACE FUNCTION public.supersede_corrected_strategic_learning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.learning_kind = 'correction' AND NEW.supersedes_learning_event_id IS NOT NULL THEN
    UPDATE public.learning_events
       SET status = 'superseded', updated_at = now()
     WHERE id = NEW.supersedes_learning_event_id
       AND user_id = NEW.user_id
       AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS learning_events_supersede_correction ON public.learning_events;
CREATE TRIGGER learning_events_supersede_correction
  AFTER INSERT OR UPDATE OF supersedes_learning_event_id, learning_kind ON public.learning_events
  FOR EACH ROW EXECUTE FUNCTION public.supersede_corrected_strategic_learning();

-- Keep transfer targets internally consistent when a target decision is linked.
CREATE OR REPLACE FUNCTION public.validate_strategic_transfer_target_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  decision_app uuid;
BEGIN
  IF NEW.target_decision_id IS NOT NULL THEN
    SELECT app_id INTO decision_app
    FROM public.strategic_decisions
    WHERE id = NEW.target_decision_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transfer-test target decision must belong to the same user';
    END IF;
    IF NEW.target_app_id IS NULL THEN
      NEW.target_app_id := decision_app;
    ELSIF decision_app IS NOT NULL AND NEW.target_app_id <> decision_app THEN
      RAISE EXCEPTION 'Transfer-test target decision must belong to the target app';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_learning_transfer_target_consistency ON public.strategic_learning_transfer_tests;
CREATE TRIGGER strategic_learning_transfer_target_consistency
  BEFORE INSERT OR UPDATE OF user_id, target_app_id, target_decision_id
  ON public.strategic_learning_transfer_tests
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_transfer_target_consistency();

COMMENT ON FUNCTION public.validate_strategic_learning_event() IS
  'Enforces ownership/app consistency and prevents unsupported promotion of causal/transferability labels. Strong labels require validated observation evidence or completed transfer tests; they still do not prove causation.';
