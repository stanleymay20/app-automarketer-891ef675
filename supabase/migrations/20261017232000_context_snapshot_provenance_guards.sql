-- ScrollMarketer Phase 8 provenance guards.
-- Once a generated recommendation/decision is linked to a context snapshot,
-- authenticated updates must not rewrite which historical context produced it.

CREATE OR REPLACE FUNCTION public.validate_strategic_decision_context_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  snapshot_user uuid;
  snapshot_app uuid;
  snapshot_purpose text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.context_snapshot_id IS DISTINCT FROM OLD.context_snapshot_id THEN
    RAISE EXCEPTION 'Strategic decision context provenance is immutable';
  END IF;

  IF NEW.context_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id, app_id, purpose
    INTO snapshot_user, snapshot_app, snapshot_purpose
  FROM public.strategic_context_snapshots
  WHERE id = NEW.context_snapshot_id;

  IF NOT FOUND OR snapshot_user <> NEW.user_id THEN
    RAISE EXCEPTION 'Strategic decision context snapshot must belong to the same user';
  END IF;
  IF NEW.app_id IS DISTINCT FROM snapshot_app THEN
    RAISE EXCEPTION 'Strategic decision context snapshot must belong to the same app';
  END IF;
  IF snapshot_purpose <> 'strategy_recommendation' THEN
    RAISE EXCEPTION 'Strategic decision generation requires a strategy_recommendation context snapshot';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_growth_recommendation_context_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  snapshot_user uuid;
  snapshot_app uuid;
  snapshot_purpose text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.context_snapshot_id IS DISTINCT FROM OLD.context_snapshot_id THEN
    RAISE EXCEPTION 'Growth recommendation context provenance is immutable';
  END IF;

  IF NEW.context_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id, app_id, purpose
    INTO snapshot_user, snapshot_app, snapshot_purpose
  FROM public.strategic_context_snapshots
  WHERE id = NEW.context_snapshot_id;

  IF NOT FOUND OR snapshot_user <> NEW.user_id THEN
    RAISE EXCEPTION 'Growth recommendation context snapshot must belong to the same user';
  END IF;
  IF NEW.app_id IS DISTINCT FROM snapshot_app THEN
    RAISE EXCEPTION 'Growth recommendation context snapshot must belong to the same app';
  END IF;
  IF snapshot_purpose <> 'strategy_recommendation' THEN
    RAISE EXCEPTION 'Growth recommendation context snapshot has an incompatible purpose';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS growth_recommendations_validate_context_snapshot ON public.growth_recommendations;
CREATE TRIGGER growth_recommendations_validate_context_snapshot
  BEFORE INSERT OR UPDATE OF user_id, app_id, context_snapshot_id
  ON public.growth_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.validate_growth_recommendation_context_snapshot();

COMMENT ON FUNCTION public.validate_strategic_decision_context_snapshot() IS
  'Validates same-user/same-app recommendation context and freezes the context snapshot link after strategic-decision creation.';
COMMENT ON FUNCTION public.validate_growth_recommendation_context_snapshot() IS
  'Validates same-user/same-app recommendation context and freezes the context snapshot link after growth-recommendation creation.';
