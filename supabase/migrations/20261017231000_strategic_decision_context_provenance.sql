-- ScrollMarketer Phase 8 provenance hardening.
-- Proposed strategic decisions generated from controlled context must retain the
-- exact immutable context snapshot that informed them.

ALTER TABLE public.strategic_decisions
  ADD COLUMN IF NOT EXISTS context_snapshot_id uuid
    REFERENCES public.strategic_context_snapshots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS strategic_decisions_context_snapshot_idx
  ON public.strategic_decisions (context_snapshot_id, created_at DESC)
  WHERE context_snapshot_id IS NOT NULL;

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

DROP TRIGGER IF EXISTS strategic_decisions_validate_context_snapshot ON public.strategic_decisions;
CREATE TRIGGER strategic_decisions_validate_context_snapshot
  BEFORE INSERT OR UPDATE OF user_id, app_id, context_snapshot_id
  ON public.strategic_decisions
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_decision_context_snapshot();

COMMENT ON COLUMN public.strategic_decisions.context_snapshot_id IS
  'Immutable Phase 8 strategy-recommendation context snapshot used to generate this proposed decision. NULL for manual/legacy decisions.';
