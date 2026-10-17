-- ScrollMarketer Phase 10: Experiment Portfolio & Real-options Planning
-- Experiments are bounded learning plans beneath an already-approved strategic
-- decision. They do not authorize ads, spend, publishing, outreach, pricing,
-- market entry, or any other external side effect.

CREATE TABLE IF NOT EXISTS public.strategic_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES public.strategic_decisions(id) ON DELETE RESTRICT,
  goal_id uuid REFERENCES public.growth_goals(id) ON DELETE SET NULL,
  market_option_id uuid REFERENCES public.strategic_market_options(id) ON DELETE SET NULL,
  question_id uuid REFERENCES public.strategic_questions(id) ON DELETE SET NULL,

  title text NOT NULL,
  hypothesis text NOT NULL,
  information_objective text NOT NULL,
  intervention text NOT NULL,
  comparison_basis text,
  primary_metric text NOT NULL,
  metric_unit text,
  success_operator text CHECK (success_operator IS NULL OR success_operator = ANY (ARRAY['gte','lte','gt','lt'])),
  success_threshold numeric,
  kill_operator text CHECK (kill_operator IS NULL OR kill_operator = ANY (ARRAY['gte','lte','gt','lt'])),
  kill_threshold numeric,
  minimum_sample_size integer CHECK (minimum_sample_size IS NULL OR minimum_sample_size > 0),

  cost_ceiling numeric(14,2) NOT NULL CHECK (cost_ceiling >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  commitment_class text NOT NULL DEFAULT 'reversible'
    CHECK (commitment_class = ANY (ARRAY['reversible','partly_reversible'])),
  planned_start timestamptz,
  deadline timestamptz NOT NULL,
  success_conditions text[] NOT NULL,
  kill_conditions text[] NOT NULL,
  evidence_requirements text[] NOT NULL DEFAULT ARRAY[]::text[],

  information_value_score_snapshot integer
    CHECK (information_value_score_snapshot IS NULL OR information_value_score_snapshot BETWEEN 0 AND 100),
  decision_commitment_amount_snapshot numeric(14,2),
  decision_currency_snapshot text,
  commitment_leverage_ratio numeric(14,4)
    CHECK (commitment_leverage_ratio IS NULL OR commitment_leverage_ratio >= 0),

  plan_review_status text NOT NULL DEFAULT 'draft'
    CHECK (plan_review_status = ANY (ARRAY['draft','pending','approved','rejected','revoked'])),
  plan_review_fingerprint text,
  source_decision_fingerprint text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_reason text,

  execution_status text NOT NULL DEFAULT 'not_started'
    CHECK (execution_status = ANY (ARRAY['not_started','running','paused','completed','stopped','cancelled'])),
  started_at timestamptz,
  ended_at timestamptz,
  stop_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (cardinality(success_conditions) > 0),
  CHECK (cardinality(kill_conditions) > 0),
  CHECK (planned_start IS NULL OR planned_start < deadline),
  CHECK ((success_operator IS NULL) = (success_threshold IS NULL)),
  CHECK ((kill_operator IS NULL) = (kill_threshold IS NULL))
);

CREATE INDEX IF NOT EXISTS strategic_experiments_user_app_idx
  ON public.strategic_experiments (user_id, app_id, execution_status, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_experiments_decision_idx
  ON public.strategic_experiments (decision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_experiments_question_idx
  ON public.strategic_experiments (question_id, created_at DESC)
  WHERE question_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.strategic_experiment_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  experiment_id uuid NOT NULL REFERENCES public.strategic_experiments(id) ON DELETE CASCADE,
  evidence_item_id uuid REFERENCES public.strategic_evidence_items(id) ON DELETE SET NULL,
  metric_name text NOT NULL,
  metric_value numeric,
  metric_unit text,
  sample_size integer CHECK (sample_size IS NULL OR sample_size >= 0),
  cost_to_date numeric(14,2) CHECK (cost_to_date IS NULL OR cost_to_date >= 0),
  result_state text NOT NULL DEFAULT 'continue'
    CHECK (result_state = ANY (ARRAY['continue','success','failure','inconclusive','stop'])),
  success_gate_met boolean NOT NULL DEFAULT false,
  kill_gate_met boolean NOT NULL DEFAULT false,
  notes text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_experiment_observations_experiment_idx
  ON public.strategic_experiment_observations (experiment_id, observed_at DESC, created_at DESC);

-- Authenticated users can create bounded plans and edit only material plan fields.
-- Review/execution state changes go through guarded RPCs below.
GRANT SELECT, INSERT ON public.strategic_experiments TO authenticated;
GRANT UPDATE (
  title, hypothesis, information_objective, intervention, comparison_basis,
  question_id, primary_metric, metric_unit, success_operator, success_threshold,
  kill_operator, kill_threshold, minimum_sample_size, cost_ceiling, currency,
  commitment_class, planned_start, deadline, success_conditions, kill_conditions,
  evidence_requirements
) ON public.strategic_experiments TO authenticated;
GRANT ALL ON public.strategic_experiments TO service_role;

GRANT SELECT, INSERT ON public.strategic_experiment_observations TO authenticated;
GRANT ALL ON public.strategic_experiment_observations TO service_role;

ALTER TABLE public.strategic_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategic_experiment_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own strategic experiments" ON public.strategic_experiments;
CREATE POLICY "Users select own strategic experiments" ON public.strategic_experiments
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users insert own strategic experiments" ON public.strategic_experiments;
CREATE POLICY "Users insert own strategic experiments" ON public.strategic_experiments
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users update own strategic experiment plans" ON public.strategic_experiments;
CREATE POLICY "Users update own strategic experiment plans" ON public.strategic_experiments
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users select own experiment observations" ON public.strategic_experiment_observations;
CREATE POLICY "Users select own experiment observations" ON public.strategic_experiment_observations
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users insert own experiment observations" ON public.strategic_experiment_observations;
CREATE POLICY "Users insert own experiment observations" ON public.strategic_experiment_observations
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);

-- Keep the Phase 10 source-decision fingerprint aligned with Phase 5 governance.
CREATE OR REPLACE FUNCTION public.strategic_decision_material_fingerprint(p_decision_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT md5(concat_ws('|',
    d.id::text,
    d.decision_type,
    d.title,
    d.recommendation,
    COALESCE(d.rationale, ''),
    COALESCE(d.goal_id::text, ''),
    COALESCE(d.market_option_id::text, ''),
    COALESCE(d.confidence::text, ''),
    d.reversibility,
    COALESCE(d.commitment_amount::text, ''),
    d.currency,
    d.authority_level,
    d.execution_mode
  ))
  FROM public.strategic_decisions d
  WHERE d.id = p_decision_id;
$$;

REVOKE EXECUTE ON FUNCTION public.strategic_decision_material_fingerprint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.strategic_decision_material_fingerprint(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.strategic_experiment_plan_fingerprint(p_experiment_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT md5(concat_ws('|',
    e.id::text,
    e.decision_id::text,
    COALESCE(e.question_id::text, ''),
    e.title,
    e.hypothesis,
    e.information_objective,
    e.intervention,
    COALESCE(e.comparison_basis, ''),
    e.primary_metric,
    COALESCE(e.metric_unit, ''),
    COALESCE(e.success_operator, ''),
    COALESCE(e.success_threshold::text, ''),
    COALESCE(e.kill_operator, ''),
    COALESCE(e.kill_threshold::text, ''),
    COALESCE(e.minimum_sample_size::text, ''),
    e.cost_ceiling::text,
    e.currency,
    e.commitment_class,
    COALESCE(e.planned_start::text, ''),
    e.deadline::text,
    e.success_conditions::text,
    e.kill_conditions::text,
    e.evidence_requirements::text
  ))
  FROM public.strategic_experiments e
  WHERE e.id = p_experiment_id;
$$;

REVOKE EXECUTE ON FUNCTION public.strategic_experiment_plan_fingerprint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.strategic_experiment_plan_fingerprint(uuid) TO authenticated, service_role;

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
    IF q.status <> 'open' THEN
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

  IF NEW.deadline <= now() THEN
    RAISE EXCEPTION 'Experiment deadline must be in the future';
  END IF;
  IF cardinality(NEW.success_conditions) = 0 OR cardinality(NEW.kill_conditions) = 0 THEN
    RAISE EXCEPTION 'Experiment requires explicit success and kill conditions';
  END IF;

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

    IF material_changed AND OLD.execution_status <> 'not_started' THEN
      RAISE EXCEPTION 'An experiment plan cannot be materially edited after it has started';
    END IF;
    IF material_changed THEN
      NEW.plan_review_status := 'draft';
      NEW.plan_review_fingerprint := NULL;
      NEW.source_decision_fingerprint := NULL;
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
      NEW.review_reason := NULL;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_experiments_prepare ON public.strategic_experiments;
CREATE TRIGGER strategic_experiments_prepare
  BEFORE INSERT OR UPDATE ON public.strategic_experiments
  FOR EACH ROW EXECUTE FUNCTION public.prepare_strategic_experiment();

REVOKE EXECUTE ON FUNCTION public.prepare_strategic_experiment() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.compare_strategic_metric(p_value numeric, p_operator text, p_threshold numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_operator
    WHEN 'gte' THEN p_value >= p_threshold
    WHEN 'lte' THEN p_value <= p_threshold
    WHEN 'gt' THEN p_value > p_threshold
    WHEN 'lt' THEN p_value < p_threshold
    ELSE false
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.compare_strategic_metric(numeric,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compare_strategic_metric(numeric,text,numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_strategic_experiment_observation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  e public.strategic_experiments%ROWTYPE;
  previous_cost numeric;
  evidence_owner uuid;
  evidence_app uuid;
  evidence_type text;
BEGIN
  SELECT * INTO e FROM public.strategic_experiments
  WHERE id = NEW.experiment_id AND user_id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experiment observation must belong to the experiment owner';
  END IF;
  IF e.execution_status NOT IN ('running','paused') THEN
    RAISE EXCEPTION 'Observations may be recorded only while an experiment is running or paused';
  END IF;

  SELECT max(cost_to_date) INTO previous_cost
  FROM public.strategic_experiment_observations
  WHERE experiment_id = NEW.experiment_id AND user_id = NEW.user_id;
  IF NEW.cost_to_date IS NOT NULL AND previous_cost IS NOT NULL AND NEW.cost_to_date < previous_cost THEN
    RAISE EXCEPTION 'Experiment cost-to-date cannot move backwards';
  END IF;
  IF NEW.cost_to_date IS NOT NULL AND NEW.cost_to_date > e.cost_ceiling THEN
    RAISE EXCEPTION 'Experiment cost-to-date cannot exceed its hard cost ceiling';
  END IF;

  IF NEW.evidence_item_id IS NOT NULL THEN
    SELECT user_id, app_id, item_type INTO evidence_owner, evidence_app, evidence_type
    FROM public.strategic_evidence_items WHERE id = NEW.evidence_item_id;
    IF evidence_owner IS NULL OR evidence_owner <> NEW.user_id OR evidence_app IS DISTINCT FROM e.app_id OR evidence_type <> 'observation' THEN
      RAISE EXCEPTION 'Experiment evidence must be an observation owned by the same user and app';
    END IF;
  END IF;

  NEW.success_gate_met := false;
  NEW.kill_gate_met := false;
  IF NEW.metric_name = e.primary_metric AND NEW.metric_value IS NOT NULL THEN
    IF e.success_threshold IS NOT NULL
       AND (e.minimum_sample_size IS NULL OR COALESCE(NEW.sample_size, 0) >= e.minimum_sample_size) THEN
      NEW.success_gate_met := public.compare_strategic_metric(NEW.metric_value, e.success_operator, e.success_threshold);
    END IF;
    IF e.kill_threshold IS NOT NULL THEN
      NEW.kill_gate_met := public.compare_strategic_metric(NEW.metric_value, e.kill_operator, e.kill_threshold);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_experiment_observations_prepare ON public.strategic_experiment_observations;
CREATE TRIGGER strategic_experiment_observations_prepare
  BEFORE INSERT ON public.strategic_experiment_observations
  FOR EACH ROW EXECUTE FUNCTION public.prepare_strategic_experiment_observation();
REVOKE EXECUTE ON FUNCTION public.prepare_strategic_experiment_observation() FROM PUBLIC, anon, authenticated;

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

  IF NEW.kill_gate_met OR (NEW.cost_to_date IS NOT NULL AND NEW.cost_to_date >= e.cost_ceiling) OR NEW.result_state = 'stop' THEN
    stop_text := CASE
      WHEN NEW.kill_gate_met THEN 'Structured kill threshold reached.'
      WHEN NEW.cost_to_date IS NOT NULL AND NEW.cost_to_date >= e.cost_ceiling THEN 'Hard experiment cost ceiling reached.'
      ELSE 'Observation explicitly requested stop.'
    END;

    UPDATE public.strategic_experiments
    SET execution_status = 'stopped', ended_at = now(), stop_reason = stop_text, updated_at = now()
    WHERE id = e.id AND execution_status IN ('running','paused');

    INSERT INTO public.strategic_action_log (
      user_id, app_id, decision_id, event_type, previous_state, next_state, details
    ) VALUES (
      e.user_id, e.app_id, e.decision_id, 'experiment_protective_stop',
      jsonb_build_object('experiment_id', e.id, 'execution_status', e.execution_status),
      jsonb_build_object('experiment_id', e.id, 'execution_status', 'stopped'),
      jsonb_build_object('reason', stop_text, 'observation_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_experiment_observations_protective_stop ON public.strategic_experiment_observations;
CREATE TRIGGER strategic_experiment_observations_protective_stop
  AFTER INSERT ON public.strategic_experiment_observations
  FOR EACH ROW EXECUTE FUNCTION public.apply_strategic_experiment_protective_stop();
REVOKE EXECUTE ON FUNCTION public.apply_strategic_experiment_protective_stop() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_strategic_experiment_review(p_experiment_id uuid)
RETURNS public.strategic_experiments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  e public.strategic_experiments%ROWTYPE;
  d public.strategic_decisions%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO e FROM public.strategic_experiments WHERE id = p_experiment_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF e.execution_status <> 'not_started' THEN RAISE EXCEPTION 'Only unstarted experiments can be reviewed'; END IF;

  SELECT * INTO d FROM public.strategic_decisions WHERE id = e.decision_id AND user_id = uid;
  IF NOT FOUND OR d.status <> 'approved' THEN RAISE EXCEPTION 'Source decision must still be approved'; END IF;

  UPDATE public.strategic_experiments
  SET plan_review_status = 'pending',
      plan_review_fingerprint = public.strategic_experiment_plan_fingerprint(e.id),
      source_decision_fingerprint = public.strategic_decision_material_fingerprint(d.id),
      reviewed_by = NULL, reviewed_at = NULL, review_reason = NULL, updated_at = now()
  WHERE id = e.id
  RETURNING * INTO e;

  INSERT INTO public.strategic_action_log (user_id, app_id, decision_id, event_type, previous_state, next_state, details)
  VALUES (uid, e.app_id, e.decision_id, 'experiment_review_requested',
    jsonb_build_object('experiment_id', e.id, 'review_status', 'draft'),
    jsonb_build_object('experiment_id', e.id, 'review_status', 'pending'), '{}');
  RETURN e;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_strategic_experiment(p_experiment_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS public.strategic_experiments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  e public.strategic_experiments%ROWTYPE;
  d public.strategic_decisions%ROWTYPE;
  current_plan text;
  current_decision text;
  breaches text[];
  next_review text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_action NOT IN ('approve','reject','revoke') THEN RAISE EXCEPTION 'Unsupported experiment review action'; END IF;

  SELECT * INTO e FROM public.strategic_experiments WHERE id = p_experiment_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  SELECT * INTO d FROM public.strategic_decisions WHERE id = e.decision_id AND user_id = uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source decision not found'; END IF;

  IF p_action = 'revoke' THEN
    IF e.plan_review_status <> 'approved' THEN RAISE EXCEPTION 'Only an approved experiment review can be revoked'; END IF;
    next_review := 'revoked';
    UPDATE public.strategic_experiments
      SET plan_review_status = next_review, reviewed_by = uid, reviewed_at = now(), review_reason = p_reason,
          execution_status = CASE WHEN execution_status IN ('running','paused') THEN 'stopped' ELSE execution_status END,
          ended_at = CASE WHEN execution_status IN ('running','paused') THEN now() ELSE ended_at END,
          stop_reason = CASE WHEN execution_status IN ('running','paused') THEN COALESCE(p_reason, 'Experiment review revoked.') ELSE stop_reason END,
          updated_at = now()
      WHERE id = e.id RETURNING * INTO e;
  ELSE
    IF e.plan_review_status <> 'pending' THEN RAISE EXCEPTION 'Experiment must be pending review'; END IF;
    current_plan := public.strategic_experiment_plan_fingerprint(e.id);
    current_decision := public.strategic_decision_material_fingerprint(d.id);
    IF e.plan_review_fingerprint IS DISTINCT FROM current_plan OR e.source_decision_fingerprint IS DISTINCT FROM current_decision THEN
      RAISE EXCEPTION 'Experiment review is stale; resubmit the current plan';
    END IF;

    IF p_action = 'approve' THEN
      IF d.status <> 'approved' THEN RAISE EXCEPTION 'Source decision must still be approved'; END IF;
      breaches := public.current_strategic_stop_breaches(d.id);
      IF cardinality(breaches) > 0 THEN
        RAISE EXCEPTION 'Experiment plan cannot be approved while strategic stop rules are breached: %', array_to_string(breaches, '; ');
      END IF;
      next_review := 'approved';
    ELSE
      next_review := 'rejected';
    END IF;

    UPDATE public.strategic_experiments
      SET plan_review_status = next_review, reviewed_by = uid, reviewed_at = now(), review_reason = p_reason, updated_at = now()
      WHERE id = e.id RETURNING * INTO e;
  END IF;

  INSERT INTO public.strategic_action_log (user_id, app_id, decision_id, event_type, previous_state, next_state, details)
  VALUES (uid, e.app_id, e.decision_id, 'experiment_review_' || p_action,
    jsonb_build_object('experiment_id', e.id), jsonb_build_object('experiment_id', e.id, 'review_status', e.plan_review_status),
    jsonb_build_object('reason', p_reason));
  RETURN e;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_strategic_experiment(p_experiment_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS public.strategic_experiments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  e public.strategic_experiments%ROWTYPE;
  d public.strategic_decisions%ROWTYPE;
  old_status text;
  current_plan text;
  current_decision text;
  breaches text[];
  observation_count integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_status NOT IN ('running','paused','completed','stopped','cancelled') THEN RAISE EXCEPTION 'Unsupported experiment status'; END IF;

  SELECT * INTO e FROM public.strategic_experiments WHERE id = p_experiment_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  old_status := e.execution_status;

  IF NOT (
    (old_status = 'not_started' AND p_status IN ('running','cancelled')) OR
    (old_status = 'running' AND p_status IN ('paused','completed','stopped')) OR
    (old_status = 'paused' AND p_status IN ('running','stopped','cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid experiment lifecycle transition: % -> %', old_status, p_status;
  END IF;

  SELECT * INTO d FROM public.strategic_decisions WHERE id = e.decision_id AND user_id = uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source decision not found'; END IF;

  IF p_status = 'running' THEN
    IF e.plan_review_status <> 'approved' THEN RAISE EXCEPTION 'Experiment must have an approved plan review before it can run'; END IF;
    current_plan := public.strategic_experiment_plan_fingerprint(e.id);
    current_decision := public.strategic_decision_material_fingerprint(d.id);
    IF e.plan_review_fingerprint IS DISTINCT FROM current_plan OR e.source_decision_fingerprint IS DISTINCT FROM current_decision THEN
      RAISE EXCEPTION 'Experiment approval is stale; obtain fresh review';
    END IF;
    IF d.status <> 'approved' THEN RAISE EXCEPTION 'Source decision must still be approved'; END IF;
    IF now() >= e.deadline THEN RAISE EXCEPTION 'Experiment deadline has passed'; END IF;
    breaches := public.current_strategic_stop_breaches(d.id);
    IF cardinality(breaches) > 0 THEN
      RAISE EXCEPTION 'Experiment start/resume blocked by strategic stop rule(s): %', array_to_string(breaches, '; ');
    END IF;
  END IF;

  IF p_status = 'completed' THEN
    SELECT count(*) INTO observation_count FROM public.strategic_experiment_observations WHERE experiment_id = e.id;
    IF observation_count = 0 THEN RAISE EXCEPTION 'Experiment cannot be completed without at least one recorded observation'; END IF;
  END IF;

  UPDATE public.strategic_experiments
  SET execution_status = p_status,
      started_at = CASE WHEN p_status = 'running' AND started_at IS NULL THEN now() ELSE started_at END,
      ended_at = CASE WHEN p_status IN ('completed','stopped','cancelled') THEN now() ELSE ended_at END,
      stop_reason = CASE WHEN p_status IN ('stopped','cancelled') THEN p_reason ELSE stop_reason END,
      updated_at = now()
  WHERE id = e.id RETURNING * INTO e;

  INSERT INTO public.strategic_action_log (user_id, app_id, decision_id, event_type, previous_state, next_state, details)
  VALUES (uid, e.app_id, e.decision_id, 'experiment_status_changed',
    jsonb_build_object('experiment_id', e.id, 'execution_status', old_status),
    jsonb_build_object('experiment_id', e.id, 'execution_status', p_status),
    jsonb_build_object('reason', p_reason));
  RETURN e;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_strategic_experiment_review(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.review_strategic_experiment(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transition_strategic_experiment(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_strategic_experiment_review(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_strategic_experiment(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_strategic_experiment(uuid,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_strategic_experiment_deadline_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.execution_status IN ('running','paused') AND now() >= NEW.deadline THEN
    NEW.execution_status := 'stopped';
    NEW.ended_at := COALESCE(NEW.ended_at, now());
    NEW.stop_reason := COALESCE(NEW.stop_reason, 'Experiment deadline reached.');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS strategic_experiment_deadline_guard ON public.strategic_experiments;
CREATE TRIGGER strategic_experiment_deadline_guard
  BEFORE UPDATE ON public.strategic_experiments
  FOR EACH ROW EXECUTE FUNCTION public.apply_strategic_experiment_deadline_guard();
REVOKE EXECUTE ON FUNCTION public.apply_strategic_experiment_deadline_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.strategic_experiment_portfolio
WITH (security_invoker = true)
AS
SELECT
  e.*,
  d.status AS source_decision_status,
  d.title AS source_decision_title,
  public.strategic_experiment_plan_fingerprint(e.id) AS current_plan_fingerprint,
  public.strategic_decision_material_fingerprint(e.decision_id) AS current_source_decision_fingerprint,
  (
    e.plan_review_status = 'approved'
    AND d.status = 'approved'
    AND e.plan_review_fingerprint = public.strategic_experiment_plan_fingerprint(e.id)
    AND e.source_decision_fingerprint = public.strategic_decision_material_fingerprint(e.decision_id)
  ) AS review_fresh,
  COALESCE(o.cost_to_date, 0)::numeric(14,2) AS cost_to_date,
  COALESCE(o.observation_count, 0)::integer AS observation_count,
  COALESCE(o.success_gate_seen, false) AS success_gate_seen,
  COALESCE(o.kill_gate_seen, false) AS kill_gate_seen
FROM public.strategic_experiments e
JOIN public.strategic_decisions d ON d.id = e.decision_id
LEFT JOIN LATERAL (
  SELECT
    max(x.cost_to_date) AS cost_to_date,
    count(*) AS observation_count,
    bool_or(x.success_gate_met) AS success_gate_seen,
    bool_or(x.kill_gate_met) AS kill_gate_seen
  FROM public.strategic_experiment_observations x
  WHERE x.experiment_id = e.id
) o ON true;

GRANT SELECT ON public.strategic_experiment_portfolio TO authenticated, service_role;

COMMENT ON TABLE public.strategic_experiments IS
  'Bounded, reversible learning plans beneath approved strategic decisions. Running is ledger state only; this table does not execute external actions.';
COMMENT ON COLUMN public.strategic_experiments.information_value_score_snapshot IS
  'Snapshot of the linked strategic question information-value proxy at plan time. It is not expected monetary value.';
COMMENT ON COLUMN public.strategic_experiments.commitment_leverage_ratio IS
  'Approved source decision commitment divided by experiment cost ceiling when both are known in the same currency. It is not ROI, NPV, or probability of success.';
COMMENT ON VIEW public.strategic_experiment_portfolio IS
  'RLS-respecting experiment portfolio with current review freshness, spend-to-date and gate observations.';
