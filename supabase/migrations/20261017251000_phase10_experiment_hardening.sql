-- ScrollMarketer Phase 10 hardening.
-- Protect review/execution columns at INSERT, allow deadline-driven protective
-- state changes without the plan validator rejecting a now-past deadline, and
-- avoid auto-stopping a legitimate zero-cost experiment at cost_to_date = 0.

CREATE OR REPLACE FUNCTION public.protect_strategic_experiment_insert_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.plan_review_status := 'draft';
  NEW.plan_review_fingerprint := NULL;
  NEW.source_decision_fingerprint := NULL;
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  NEW.review_reason := NULL;
  NEW.execution_status := 'not_started';
  NEW.started_at := NULL;
  NEW.ended_at := NULL;
  NEW.stop_reason := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_strategic_experiment_insert_state_guard ON public.strategic_experiments;
CREATE TRIGGER aa_strategic_experiment_insert_state_guard
  BEFORE INSERT ON public.strategic_experiments
  FOR EACH ROW EXECUTE FUNCTION public.protect_strategic_experiment_insert_state();
REVOKE EXECUTE ON FUNCTION public.protect_strategic_experiment_insert_state() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prepare_strategic_experiment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  d public.strategic_decisions%ROWTYPE;
  q public.strategic_questions%ROWTYPE;
  material_changed boolean := false;
  source_rank integer;
  experiment_rank integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    material_changed := ROW(
      NEW.decision_id, NEW.question_id, NEW.title, NEW.hypothesis,
      NEW.information_objective, NEW.intervention, NEW.comparison_basis,
      NEW.primary_metric, NEW.metric_unit, NEW.success_operator,
      NEW.success_threshold, NEW.kill_operator, NEW.kill_threshold,
      NEW.minimum_sample_size, NEW.cost_ceiling, NEW.currency,
      NEW.commitment_class, NEW.planned_start, NEW.deadline,
      NEW.success_conditions, NEW.kill_conditions, NEW.evidence_requirements
    ) IS DISTINCT FROM ROW(
      OLD.decision_id, OLD.question_id, OLD.title, OLD.hypothesis,
      OLD.information_objective, OLD.intervention, OLD.comparison_basis,
      OLD.primary_metric, OLD.metric_unit, OLD.success_operator,
      OLD.success_threshold, OLD.kill_operator, OLD.kill_threshold,
      OLD.minimum_sample_size, OLD.cost_ceiling, OLD.currency,
      OLD.commitment_class, OLD.planned_start, OLD.deadline,
      OLD.success_conditions, OLD.kill_conditions, OLD.evidence_requirements
    );
  END IF;

  SELECT * INTO d
  FROM public.strategic_decisions
  WHERE id = NEW.decision_id AND user_id = NEW.user_id;
  IF NOT FOUND OR d.app_id IS NULL THEN
    RAISE EXCEPTION 'Experiment source decision must belong to the same user and app';
  END IF;
  IF TG_OP = 'INSERT' AND d.status <> 'approved' THEN
    RAISE EXCEPTION 'A strategic experiment may be created only from an approved strategic decision';
  END IF;

  NEW.app_id := d.app_id;
  NEW.goal_id := COALESCE(NEW.goal_id, d.goal_id);
  NEW.market_option_id := COALESCE(NEW.market_option_id, d.market_option_id);

  IF NEW.question_id IS NOT NULL THEN
    SELECT * INTO q FROM public.strategic_questions
    WHERE id = NEW.question_id AND user_id = NEW.user_id AND app_id = d.app_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Experiment question must belong to the same user and app';
    END IF;
    IF (TG_OP = 'INSERT' OR material_changed) AND q.status <> 'open' THEN
      RAISE EXCEPTION 'Experiment question must still be open at plan time';
    END IF;
    IF q.decision_id IS NOT NULL AND q.decision_id <> NEW.decision_id THEN
      RAISE EXCEPTION 'Decision-linked experiment question must belong to the source decision';
    END IF;
    NEW.information_value_score_snapshot := q.information_value_score;
  ELSE
    NEW.information_value_score_snapshot := NULL;
  END IF;

  NEW.decision_commitment_amount_snapshot := d.commitment_amount;
  NEW.decision_currency_snapshot := d.currency;

  IF d.commitment_amount IS NOT NULL THEN
    IF NEW.currency <> d.currency THEN
      RAISE EXCEPTION 'Experiment currency must match the approved decision currency when commitment is known';
    END IF;
    IF NEW.cost_ceiling > d.commitment_amount THEN
      RAISE EXCEPTION 'Experiment cost ceiling cannot exceed the approved decision commitment';
    END IF;
    IF NEW.cost_ceiling > 0 THEN
      NEW.commitment_leverage_ratio := round(d.commitment_amount / NEW.cost_ceiling, 4);
    ELSE
      NEW.commitment_leverage_ratio := NULL;
    END IF;
  ELSE
    NEW.commitment_leverage_ratio := NULL;
  END IF;

  source_rank := CASE d.reversibility WHEN 'reversible' THEN 1 WHEN 'partly_reversible' THEN 2 ELSE 3 END;
  experiment_rank := CASE NEW.commitment_class WHEN 'reversible' THEN 1 ELSE 2 END;
  IF experiment_rank > source_rank THEN
    RAISE EXCEPTION 'Experiment cannot be less reversible than its approved source decision';
  END IF;

  IF (TG_OP = 'INSERT' OR material_changed) AND NEW.deadline <= now() THEN
    RAISE EXCEPTION 'Experiment deadline must be in the future when the plan is created or edited';
  END IF;
  IF cardinality(NEW.success_conditions) = 0 OR cardinality(NEW.kill_conditions) = 0 THEN
    RAISE EXCEPTION 'Experiment requires explicit success and kill conditions';
  END IF;

  IF TG_OP = 'UPDATE' AND material_changed THEN
    IF OLD.execution_status <> 'not_started' THEN
      RAISE EXCEPTION 'An experiment plan cannot be materially edited after it has started';
    END IF;
    NEW.plan_review_status := 'draft';
    NEW.plan_review_fingerprint := NULL;
    NEW.source_decision_fingerprint := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_reason := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prepare_strategic_experiment() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_strategic_experiment_protective_stop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.strategic_experiments%ROWTYPE;
  stop_text text;
BEGIN
  SELECT * INTO e FROM public.strategic_experiments WHERE id = NEW.experiment_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.kill_gate_met
     OR (e.cost_ceiling > 0 AND NEW.cost_to_date IS NOT NULL AND NEW.cost_to_date >= e.cost_ceiling)
     OR NEW.result_state = 'stop' THEN
    stop_text := CASE
      WHEN NEW.kill_gate_met THEN 'Structured kill threshold reached.'
      WHEN e.cost_ceiling > 0 AND NEW.cost_to_date IS NOT NULL AND NEW.cost_to_date >= e.cost_ceiling THEN 'Hard experiment cost ceiling reached.'
      ELSE 'Observation explicitly requested stop.'
    END;

    UPDATE public.strategic_experiments
    SET execution_status = 'stopped', ended_at = now(), stop_reason = stop_text, updated_at = now()
    WHERE id = e.id AND execution_status IN ('running','paused');

    IF FOUND THEN
      INSERT INTO public.strategic_action_log (
        user_id, app_id, decision_id, event_type, previous_state, next_state, details
      ) VALUES (
        e.user_id, e.app_id, e.decision_id, 'experiment_protective_stop',
        jsonb_build_object('experiment_id', e.id, 'execution_status', e.execution_status),
        jsonb_build_object('experiment_id', e.id, 'execution_status', 'stopped'),
        jsonb_build_object('reason', stop_text, 'observation_id', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_strategic_experiment_protective_stop() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.protect_strategic_experiment_insert_state() IS
  'Forces new experiments into draft/not_started state even if a client attempts to pre-populate protected review or execution fields.';
