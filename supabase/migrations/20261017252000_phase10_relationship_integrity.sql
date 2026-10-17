-- ScrollMarketer Phase 10 relationship integrity.
-- An experiment is a child of one approved strategic decision. Its app, goal
-- and market-option links therefore come from that source decision and cannot
-- be supplied independently by a client at insert time.

CREATE OR REPLACE FUNCTION public.bind_strategic_experiment_source_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  d public.strategic_decisions%ROWTYPE;
BEGIN
  SELECT * INTO d
  FROM public.strategic_decisions
  WHERE id = NEW.decision_id AND user_id = NEW.user_id;

  IF NOT FOUND OR d.app_id IS NULL THEN
    RAISE EXCEPTION 'Experiment source decision must belong to the same user and app';
  END IF;

  NEW.app_id := d.app_id;
  NEW.goal_id := d.goal_id;
  NEW.market_option_id := d.market_option_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ab_strategic_experiment_source_links_guard ON public.strategic_experiments;
CREATE TRIGGER ab_strategic_experiment_source_links_guard
  BEFORE INSERT OR UPDATE OF user_id, decision_id, app_id, goal_id, market_option_id
  ON public.strategic_experiments
  FOR EACH ROW EXECUTE FUNCTION public.bind_strategic_experiment_source_links();

REVOKE EXECUTE ON FUNCTION public.bind_strategic_experiment_source_links() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.bind_strategic_experiment_source_links() IS
  'Canonicalizes experiment app/objective/market links to the owned source strategic decision so clients cannot forge cross-user/cross-app relationship UUIDs.';
