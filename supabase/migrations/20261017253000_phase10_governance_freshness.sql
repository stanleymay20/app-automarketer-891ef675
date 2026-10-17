-- ScrollMarketer Phase 10 governance/freshness hardening.
-- 1) Monetary experiments require an explicit approved source-decision budget.
-- 2) Revocation preserves the identity/time of the original plan reviewer.
-- 3) Running/paused experiment ledger state stops when the source decision
--    materially changes, is no longer approved, or a strategic stop rule becomes breached.

ALTER TABLE public.strategic_experiments
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_reason text;

CREATE OR REPLACE FUNCTION public.guard_strategic_experiment_cost_authority()
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experiment source decision must belong to the same user';
  END IF;

  IF NEW.cost_ceiling > 0 AND d.commitment_amount IS NULL THEN
    RAISE EXCEPTION 'A non-zero experiment cost ceiling requires an explicit approved source-decision commitment amount';
  END IF;
  IF d.commitment_amount IS NOT NULL THEN
    IF NEW.currency <> d.currency THEN
      RAISE EXCEPTION 'Experiment currency must match the approved source-decision currency';
    END IF;
    IF NEW.cost_ceiling > d.commitment_amount THEN
      RAISE EXCEPTION 'Experiment cost ceiling cannot exceed the approved source-decision commitment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ac_strategic_experiment_cost_authority_guard ON public.strategic_experiments;
CREATE TRIGGER ac_strategic_experiment_cost_authority_guard
  BEFORE INSERT OR UPDATE OF decision_id, cost_ceiling, currency
  ON public.strategic_experiments
  FOR EACH ROW EXECUTE FUNCTION public.guard_strategic_experiment_cost_authority();
REVOKE EXECUTE ON FUNCTION public.guard_strategic_experiment_cost_authority() FROM PUBLIC, anon, authenticated;

-- review_strategic_experiment previously reused reviewed_* fields for revocation.
-- Preserve the original approval/rejection history and store revocation separately.
CREATE OR REPLACE FUNCTION public.preserve_strategic_experiment_review_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.plan_review_status = 'approved' AND NEW.plan_review_status = 'revoked' THEN
    NEW.revoked_by := COALESCE((select auth.uid()), NEW.reviewed_by);
    NEW.revoked_at := now();
    NEW.revocation_reason := NEW.review_reason;
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.review_reason := OLD.review_reason;
  ELSIF NEW.plan_review_status IN ('draft','pending') THEN
    NEW.revoked_by := NULL;
    NEW.revoked_at := NULL;
    NEW.revocation_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_strategic_experiment_review_history ON public.strategic_experiments;
CREATE TRIGGER zz_strategic_experiment_review_history
  BEFORE UPDATE OF plan_review_status, reviewed_by, reviewed_at, review_reason
  ON public.strategic_experiments
  FOR EACH ROW EXECUTE FUNCTION public.preserve_strategic_experiment_review_history();
REVOKE EXECUTE ON FUNCTION public.preserve_strategic_experiment_review_history() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stop_stale_strategic_experiments_for_decision(p_decision_id uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected public.strategic_experiments%ROWTYPE;
  stopped_count integer := 0;
BEGIN
  FOR affected IN
    UPDATE public.strategic_experiments e
    SET execution_status = 'stopped',
        ended_at = now(),
        stop_reason = p_reason,
        updated_at = now()
    WHERE e.decision_id = p_decision_id
      AND e.execution_status IN ('running','paused')
    RETURNING *
  LOOP
    stopped_count := stopped_count + 1;
    INSERT INTO public.strategic_action_log (
      user_id, app_id, decision_id, event_type, previous_state, next_state, details
    ) VALUES (
      affected.user_id, affected.app_id, affected.decision_id,
      'experiment_source_guard_stop',
      jsonb_build_object('experiment_id', affected.id, 'execution_status', 'running_or_paused'),
      jsonb_build_object('experiment_id', affected.id, 'execution_status', 'stopped'),
      jsonb_build_object('reason', p_reason)
    );
  END LOOP;
  RETURN stopped_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stop_stale_strategic_experiments_for_decision(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_stale_strategic_experiments_for_decision(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_running_experiments_after_decision_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_fingerprint text;
  breaches text[];
BEGIN
  current_fingerprint := public.strategic_decision_material_fingerprint(NEW.id);
  breaches := public.current_strategic_stop_breaches(NEW.id);

  IF NEW.status <> 'approved' THEN
    PERFORM public.stop_stale_strategic_experiments_for_decision(
      NEW.id, 'Source strategic decision is no longer approved.'
    );
  ELSIF EXISTS (
    SELECT 1 FROM public.strategic_experiments e
    WHERE e.decision_id = NEW.id
      AND e.execution_status IN ('running','paused')
      AND e.source_decision_fingerprint IS DISTINCT FROM current_fingerprint
  ) THEN
    PERFORM public.stop_stale_strategic_experiments_for_decision(
      NEW.id, 'Source strategic decision materially changed; experiment review is stale.'
    );
  ELSIF cardinality(breaches) > 0 THEN
    PERFORM public.stop_stale_strategic_experiments_for_decision(
      NEW.id, 'Source strategic decision breached an active strategic stop rule.'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_decisions_guard_running_experiments ON public.strategic_decisions;
CREATE TRIGGER strategic_decisions_guard_running_experiments
  AFTER UPDATE OF status, decision_type, title, recommendation, rationale, goal_id,
    market_option_id, confidence, commitment_amount, currency, reversibility,
    authority_level, execution_mode
  ON public.strategic_decisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_running_experiments_after_decision_change();
REVOKE EXECUTE ON FUNCTION public.guard_running_experiments_after_decision_change() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_running_experiments_after_stop_rule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  breaches text[];
BEGIN
  breaches := public.current_strategic_stop_breaches(NEW.decision_id);
  IF cardinality(breaches) > 0 THEN
    PERFORM public.stop_stale_strategic_experiments_for_decision(
      NEW.decision_id, 'Source strategic decision breached an active strategic stop rule.'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_stop_rules_guard_running_experiments ON public.strategic_stop_rules;
CREATE TRIGGER strategic_stop_rules_guard_running_experiments
  AFTER INSERT OR UPDATE OF status, rule_type, threshold_numeric, threshold_at, action
  ON public.strategic_stop_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_running_experiments_after_stop_rule_change();
REVOKE EXECUTE ON FUNCTION public.guard_running_experiments_after_stop_rule_change() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.strategic_experiments.revoked_by IS
  'Reviewer who revoked an approved experiment plan. Original reviewed_by remains the original approver.';
COMMENT ON FUNCTION public.guard_strategic_experiment_cost_authority() IS
  'Fail-closed monetary boundary: positive experiment cost requires an explicit approved source-decision commitment and cannot exceed it.';
