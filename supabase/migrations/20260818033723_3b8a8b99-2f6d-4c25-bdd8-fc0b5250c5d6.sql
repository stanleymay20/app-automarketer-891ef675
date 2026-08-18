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
  IF NEW.autopilot_state = 'auto_send' THEN
    NEW.autopilot_state := 'queued';
    RETURN NEW;
  END IF;

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