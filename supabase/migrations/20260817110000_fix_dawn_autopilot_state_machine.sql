-- Normalize Dawn Marketing Autopilot routing into the canonical outreach state machine.
--
-- Root causes fixed:
-- 1) Dawn writes `auto_send`, while autopilot-tick consumes only `queued` rows.
--    Normalize `auto_send` -> `queued` so the existing sender can apply its full
--    rate-limit, confidence, value, allow-list, approval and audit gates.
-- 2) Dawn previously used `dawn_require_review_for_high_value` as a global
--    auto-send blocker. When that preference is enabled, a LOW-value, hot,
--    high-confidence prospect could be incorrectly sent to review. Correct only
--    that narrow transition; truly high-value prospects remain review-required.
--
-- Keeping this rule at the database state-machine boundary makes the behavior
-- safe even if more than one automation worker writes prospect routing states.

CREATE OR REPLACE FUNCTION public.normalize_dawn_prospect_routing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  review_high_value boolean := true;
  high_value_threshold numeric := 5000;
  prospect_value numeric := COALESCE(NEW.expected_value, 0);
BEGIN
  -- Canonical send-ready state. autopilot-tick owns the actual send decision.
  IF NEW.autopilot_state = 'auto_send' THEN
    NEW.autopilot_state := 'queued';
    RETURN NEW;
  END IF;

  -- Narrow correction for Dawn's previous high-value-review boolean bug.
  -- We only touch a fresh queued -> review_required transition for a prospect
  -- that Dawn itself considers otherwise eligible for automatic routing.
  IF OLD.autopilot_state = 'queued'
     AND NEW.autopilot_state = 'review_required'
     AND NEW.segment = 'hot'
     AND COALESCE(NEW.opportunity_score, 0) >= 75
     AND COALESCE(NEW.opportunity_confidence, 0) >= 60
  THEN
    SELECT
      COALESCE(us.dawn_require_review_for_high_value, true),
      COALESCE(us.dawn_high_value_threshold, 5000)
    INTO review_high_value, high_value_threshold
    FROM public.user_settings us
    WHERE us.user_id = NEW.user_id
    LIMIT 1;

    -- If the setting is ON but this is NOT actually high value, leave the final
    -- decision to autopilot-tick instead of forcing manual review here.
    -- autopilot-tick can still route it to review for low EV confidence,
    -- segment policy, max_auto_value, missing email, or any other guardrail.
    IF review_high_value = true AND prospect_value < high_value_threshold THEN
      NEW.autopilot_state := 'queued';
      NEW.review_status := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_dawn_prospect_routing_trg ON public.prospects;
CREATE TRIGGER normalize_dawn_prospect_routing_trg
  BEFORE UPDATE OF autopilot_state, review_status ON public.prospects
  FOR EACH ROW
  WHEN (OLD.autopilot_state IS DISTINCT FROM NEW.autopilot_state)
  EXECUTE FUNCTION public.normalize_dawn_prospect_routing();
