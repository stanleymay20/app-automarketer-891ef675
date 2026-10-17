-- ScrollMarketer Phase 5: Deterministic Governance & Authority
-- Additive, explicit and fail-closed for bounded autonomous strategic execution.
-- No capital/confidence thresholds are invented: bounded_execute policies are
-- invalid unless the owner explicitly configures them.

ALTER TABLE public.strategic_decisions
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'manual'
    CHECK (execution_mode = ANY (ARRAY['manual','bounded_autonomous']));

CREATE TABLE IF NOT EXISTS public.strategic_governance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  policy_name text NOT NULL,
  decision_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  authority_mode text NOT NULL DEFAULT 'manual_only'
    CHECK (authority_mode = ANY (ARRAY['manual_only','recommend','draft','bounded_execute'])),
  min_confidence integer CHECK (min_confidence IS NULL OR min_confidence BETWEEN 0 AND 100),
  max_commitment_amount numeric(14,2) CHECK (max_commitment_amount IS NULL OR max_commitment_amount >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  allowed_reversibility text[] NOT NULL DEFAULT ARRAY[]::text[],
  human_approval_required boolean NOT NULL DEFAULT true,
  legal_review_required boolean NOT NULL DEFAULT false,
  brand_review_required boolean NOT NULL DEFAULT false,
  executive_approval_required boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision_types <@ ARRAY['research','wait','test','partner','reposition','product','price','enter','exit','advertise','scale','other']::text[]),
  CHECK (allowed_reversibility <@ ARRAY['reversible','partly_reversible','hard_to_reverse']::text[]),
  CHECK (
    authority_mode <> 'bounded_execute'
    OR (
      min_confidence IS NOT NULL
      AND max_commitment_amount IS NOT NULL
      AND cardinality(allowed_reversibility) > 0
    )
  )
);

CREATE INDEX IF NOT EXISTS strategic_governance_policies_user_app_idx
  ON public.strategic_governance_policies (user_id, app_id, enabled, priority DESC, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_governance_policies TO authenticated;
GRANT ALL ON public.strategic_governance_policies TO service_role;
ALTER TABLE public.strategic_governance_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own strategic governance policies" ON public.strategic_governance_policies;
DROP POLICY IF EXISTS "Users insert own strategic governance policies" ON public.strategic_governance_policies;
DROP POLICY IF EXISTS "Users update own strategic governance policies" ON public.strategic_governance_policies;
DROP POLICY IF EXISTS "Users delete own strategic governance policies" ON public.strategic_governance_policies;
CREATE POLICY "Users select own strategic governance policies" ON public.strategic_governance_policies
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY "Users insert own strategic governance policies" ON public.strategic_governance_policies
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users update own strategic governance policies" ON public.strategic_governance_policies
  FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users delete own strategic governance policies" ON public.strategic_governance_policies
  FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

CREATE TABLE IF NOT EXISTS public.strategic_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES public.strategic_decisions(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.strategic_governance_policies(id) ON DELETE SET NULL,
  approval_type text NOT NULL
    CHECK (approval_type = ANY (ARRAY['human','legal','brand','executive'])),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','approved','rejected','cancelled'])),
  reason text,
  decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS strategic_approval_pending_uidx
  ON public.strategic_approval_requests (decision_id, approval_type)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS strategic_approval_user_app_idx
  ON public.strategic_approval_requests (user_id, app_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.strategic_approval_requests TO authenticated;
GRANT ALL ON public.strategic_approval_requests TO service_role;
ALTER TABLE public.strategic_approval_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own strategic approval requests" ON public.strategic_approval_requests;
DROP POLICY IF EXISTS "Users insert own strategic approval requests" ON public.strategic_approval_requests;
DROP POLICY IF EXISTS "Users update own strategic approval requests" ON public.strategic_approval_requests;
CREATE POLICY "Users select own strategic approval requests" ON public.strategic_approval_requests
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY "Users insert own strategic approval requests" ON public.strategic_approval_requests
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users update own strategic approval requests" ON public.strategic_approval_requests
  FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

CREATE TABLE IF NOT EXISTS public.strategic_stop_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES public.strategic_decisions(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  rule_type text NOT NULL
    CHECK (rule_type = ANY (ARRAY['confidence_floor','commitment_ceiling','deadline','manual_halt'])),
  threshold_numeric numeric,
  threshold_at timestamptz,
  currency text,
  action text NOT NULL DEFAULT 'block_autonomy'
    CHECK (action = ANY (ARRAY['block_autonomy','require_review'])),
  status text NOT NULL DEFAULT 'active'
    CHECK (status = ANY (ARRAY['active','triggered','disabled'])),
  triggered_reason text,
  triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (rule_type = 'confidence_floor' AND threshold_numeric BETWEEN 0 AND 100 AND threshold_at IS NULL)
    OR (rule_type = 'commitment_ceiling' AND threshold_numeric >= 0 AND threshold_at IS NULL)
    OR (rule_type = 'deadline' AND threshold_at IS NOT NULL AND threshold_numeric IS NULL)
    OR (rule_type = 'manual_halt' AND threshold_numeric IS NULL AND threshold_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS strategic_stop_rules_decision_idx
  ON public.strategic_stop_rules (decision_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_stop_rules TO authenticated;
GRANT ALL ON public.strategic_stop_rules TO service_role;
ALTER TABLE public.strategic_stop_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic stop rules" ON public.strategic_stop_rules;
CREATE POLICY "Users manage own strategic stop rules" ON public.strategic_stop_rules
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE TABLE IF NOT EXISTS public.strategic_governance_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES public.strategic_decisions(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.strategic_governance_policies(id) ON DELETE SET NULL,
  requested_action text NOT NULL DEFAULT 'autonomous_execute'
    CHECK (requested_action = ANY (ARRAY['autonomous_execute','manual_execute','approve'])),
  result text NOT NULL DEFAULT 'block'
    CHECK (result = ANY (ARRAY['allow','review','block'])),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_fingerprint text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_governance_eval_decision_idx
  ON public.strategic_governance_evaluations (decision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_governance_eval_user_app_idx
  ON public.strategic_governance_evaluations (user_id, app_id, created_at DESC);

GRANT SELECT, INSERT ON public.strategic_governance_evaluations TO authenticated;
GRANT ALL ON public.strategic_governance_evaluations TO service_role;
ALTER TABLE public.strategic_governance_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own strategic governance evaluations" ON public.strategic_governance_evaluations;
DROP POLICY IF EXISTS "Users insert own strategic governance evaluations" ON public.strategic_governance_evaluations;
CREATE POLICY "Users select own strategic governance evaluations" ON public.strategic_governance_evaluations
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY "Users insert own strategic governance evaluations" ON public.strategic_governance_evaluations
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);

CREATE TABLE IF NOT EXISTS public.strategic_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.strategic_decisions(id) ON DELETE SET NULL,
  policy_id uuid REFERENCES public.strategic_governance_policies(id) ON DELETE SET NULL,
  approval_request_id uuid REFERENCES public.strategic_approval_requests(id) ON DELETE SET NULL,
  evaluation_id uuid REFERENCES public.strategic_governance_evaluations(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_action_log_user_app_idx
  ON public.strategic_action_log (user_id, app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_action_log_decision_idx
  ON public.strategic_action_log (decision_id, created_at DESC);

GRANT SELECT ON public.strategic_action_log TO authenticated;
GRANT ALL ON public.strategic_action_log TO service_role;
ALTER TABLE public.strategic_action_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own strategic action log" ON public.strategic_action_log;
CREATE POLICY "Users select own strategic action log" ON public.strategic_action_log
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- ---------- ownership validation ----------
CREATE OR REPLACE FUNCTION public.validate_strategic_governance_policy_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.app_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.apps WHERE id = NEW.app_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Governance policy app must belong to the same user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_governance_policy_validate_ownership ON public.strategic_governance_policies;
CREATE TRIGGER strategic_governance_policy_validate_ownership
  BEFORE INSERT OR UPDATE OF user_id, app_id ON public.strategic_governance_policies
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_governance_policy_ownership();

CREATE OR REPLACE FUNCTION public.validate_strategic_approval_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  decision_app uuid;
BEGIN
  SELECT app_id INTO decision_app
  FROM public.strategic_decisions
  WHERE id = NEW.decision_id AND user_id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval decision must belong to the same user';
  END IF;
  NEW.app_id := decision_app;
  IF NEW.policy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.strategic_governance_policies WHERE id = NEW.policy_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Approval policy must belong to the same user';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.requested_by IS NULL THEN
    NEW.requested_by := (select auth.uid());
  END IF;
  IF NEW.status IN ('approved','rejected') AND NEW.reviewed_at IS NULL THEN
    NEW.reviewed_at := now();
    NEW.reviewed_by := COALESCE(NEW.reviewed_by, (select auth.uid()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_approval_validate_ownership ON public.strategic_approval_requests;
CREATE TRIGGER strategic_approval_validate_ownership
  BEFORE INSERT OR UPDATE ON public.strategic_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_approval_ownership();

CREATE OR REPLACE FUNCTION public.validate_strategic_stop_rule_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  decision_app uuid;
BEGIN
  SELECT app_id INTO decision_app
  FROM public.strategic_decisions
  WHERE id = NEW.decision_id AND user_id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stop-rule decision must belong to the same user';
  END IF;
  NEW.app_id := decision_app;
  IF NEW.status = 'triggered' AND NEW.triggered_at IS NULL THEN
    NEW.triggered_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_stop_rule_validate_ownership ON public.strategic_stop_rules;
CREATE TRIGGER strategic_stop_rule_validate_ownership
  BEFORE INSERT OR UPDATE ON public.strategic_stop_rules
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_stop_rule_ownership();

-- Returns deterministic, currently observable stop-rule breaches for a decision.
CREATE OR REPLACE FUNCTION public.current_strategic_stop_breaches(p_decision_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  d public.strategic_decisions%ROWTYPE;
  r public.strategic_stop_rules%ROWTYPE;
  breaches text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO d FROM public.strategic_decisions WHERE id = p_decision_id;
  IF NOT FOUND THEN
    RETURN ARRAY['decision_not_accessible']::text[];
  END IF;

  FOR r IN
    SELECT * FROM public.strategic_stop_rules
    WHERE decision_id = p_decision_id AND status <> 'disabled'
    ORDER BY created_at ASC
  LOOP
    IF r.status = 'triggered' THEN
      breaches := array_append(breaches, r.rule_name || ': triggered');
    ELSIF r.rule_type = 'confidence_floor' AND (d.confidence IS NULL OR d.confidence < r.threshold_numeric) THEN
      breaches := array_append(breaches, r.rule_name || ': confidence below floor or unknown');
    ELSIF r.rule_type = 'commitment_ceiling' AND (d.commitment_amount IS NULL OR d.commitment_amount > r.threshold_numeric) THEN
      breaches := array_append(breaches, r.rule_name || ': commitment exceeds ceiling or is unknown');
    ELSIF r.rule_type = 'deadline' AND now() > r.threshold_at THEN
      breaches := array_append(breaches, r.rule_name || ': deadline passed');
    END IF;
  END LOOP;

  RETURN breaches;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.current_strategic_stop_breaches(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_strategic_stop_breaches(uuid) TO authenticated, service_role;

-- ---------- deterministic governance evaluation ----------
CREATE OR REPLACE FUNCTION public.prepare_strategic_governance_evaluation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  d public.strategic_decisions%ROWTYPE;
  p public.strategic_governance_policies%ROWTYPE;
  reasons jsonb := '[]'::jsonb;
  eval_result text := 'allow';
  approval_kind text;
  need_human boolean := false;
  need_legal boolean := false;
  need_brand boolean := false;
  need_executive boolean := false;
  rejected_exists boolean;
  approved_exists boolean;
  breaches text[];
BEGIN
  SELECT * INTO d
  FROM public.strategic_decisions
  WHERE id = NEW.decision_id AND user_id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Governance evaluation decision must belong to the same user';
  END IF;

  NEW.app_id := d.app_id;
  NEW.decision_snapshot := to_jsonb(d);
  NEW.decision_fingerprint := md5(concat_ws('|',
    d.id::text,
    d.decision_type,
    COALESCE(d.confidence::text, ''),
    d.reversibility,
    COALESCE(d.commitment_amount::text, ''),
    d.currency,
    d.authority_level,
    d.execution_mode
  ));

  SELECT * INTO p
  FROM public.strategic_governance_policies gp
  WHERE gp.user_id = NEW.user_id
    AND gp.enabled = true
    AND (gp.app_id IS NULL OR gp.app_id = d.app_id)
    AND (cardinality(gp.decision_types) = 0 OR d.decision_type = ANY(gp.decision_types))
  ORDER BY (gp.app_id IS NOT NULL) DESC, gp.priority DESC, gp.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    NEW.policy_id := NULL;
    NEW.policy_snapshot := '{}'::jsonb;
    NEW.result := 'block';
    NEW.reasons := jsonb_build_array('No enabled governance policy applies to this decision.');
    RETURN NEW;
  END IF;

  NEW.policy_id := p.id;
  NEW.policy_snapshot := to_jsonb(p);

  IF NEW.requested_action = 'autonomous_execute' THEN
    IF p.authority_mode <> 'bounded_execute' THEN
      eval_result := 'block';
      reasons := reasons || jsonb_build_array('Applicable policy does not authorize bounded autonomous execution.');
    END IF;

    IF d.status <> 'approved' THEN
      IF eval_result <> 'block' THEN eval_result := 'review'; END IF;
      reasons := reasons || jsonb_build_array('Decision must be human-approved before autonomous execution can be considered.');
    END IF;

    IF d.execution_mode <> 'bounded_autonomous' THEN
      IF eval_result <> 'block' THEN eval_result := 'review'; END IF;
      reasons := reasons || jsonb_build_array('Decision execution mode is not armed for bounded autonomy.');
    END IF;

    IF d.confidence IS NULL OR d.confidence < p.min_confidence THEN
      eval_result := 'block';
      reasons := reasons || jsonb_build_array('Decision confidence is unknown or below the configured minimum.');
    END IF;

    IF d.commitment_amount IS NULL THEN
      eval_result := 'block';
      reasons := reasons || jsonb_build_array('Commitment amount is unknown; bounded autonomy requires an explicit amount, including zero.');
    ELSIF d.currency <> p.currency THEN
      eval_result := 'block';
      reasons := reasons || jsonb_build_array('Decision currency does not match the policy currency.');
    ELSIF d.commitment_amount > p.max_commitment_amount THEN
      eval_result := 'block';
      reasons := reasons || jsonb_build_array('Commitment amount exceeds the configured autonomous ceiling.');
    END IF;

    IF NOT (d.reversibility = ANY(p.allowed_reversibility)) THEN
      eval_result := 'block';
      reasons := reasons || jsonb_build_array('Decision reversibility is outside the policy allow-list.');
    END IF;

    need_human := p.human_approval_required;
    need_legal := p.legal_review_required;
    need_brand := p.brand_review_required;
    need_executive := p.executive_approval_required OR d.reversibility = 'hard_to_reverse';

    breaches := public.current_strategic_stop_breaches(d.id);
    IF cardinality(breaches) > 0 THEN
      eval_result := 'block';
      reasons := reasons || to_jsonb(breaches);
    END IF;

    FOREACH approval_kind IN ARRAY ARRAY['human','legal','brand','executive']::text[]
    LOOP
      IF (approval_kind = 'human' AND need_human)
         OR (approval_kind = 'legal' AND need_legal)
         OR (approval_kind = 'brand' AND need_brand)
         OR (approval_kind = 'executive' AND need_executive) THEN

        SELECT EXISTS (
          SELECT 1 FROM public.strategic_approval_requests ar
          WHERE ar.decision_id = d.id AND ar.user_id = d.user_id
            AND ar.approval_type = approval_kind AND ar.status = 'approved'
        ) INTO approved_exists;

        SELECT EXISTS (
          SELECT 1 FROM public.strategic_approval_requests ar
          WHERE ar.decision_id = d.id AND ar.user_id = d.user_id
            AND ar.approval_type = approval_kind AND ar.status = 'rejected'
        ) INTO rejected_exists;

        IF rejected_exists AND NOT approved_exists THEN
          eval_result := 'block';
          reasons := reasons || jsonb_build_array(initcap(approval_kind) || ' approval was rejected.');
        ELSIF NOT approved_exists THEN
          IF eval_result <> 'block' THEN eval_result := 'review'; END IF;
          reasons := reasons || jsonb_build_array(initcap(approval_kind) || ' approval is required.');
          INSERT INTO public.strategic_approval_requests (
            user_id, app_id, decision_id, policy_id, approval_type, reason,
            decision_snapshot, policy_snapshot, requested_by
          ) VALUES (
            d.user_id, d.app_id, d.id, p.id, approval_kind,
            'Required by deterministic governance evaluation.',
            to_jsonb(d), to_jsonb(p), COALESCE((select auth.uid()), d.user_id)
          ) ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  END IF;

  NEW.result := eval_result;
  NEW.reasons := reasons;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_governance_evaluation_prepare ON public.strategic_governance_evaluations;
CREATE TRIGGER strategic_governance_evaluation_prepare
  BEFORE INSERT ON public.strategic_governance_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.prepare_strategic_governance_evaluation();

-- Bounded autonomous execution is fail-closed. Manual execution remains possible
-- after human approval and can still be recorded in the decision ledger.
CREATE OR REPLACE FUNCTION public.guard_strategic_bounded_execution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  fingerprint text;
  breaches text[];
BEGIN
  IF NEW.execution_mode = 'bounded_autonomous'
     AND NEW.status IN ('executing','executed')
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.execution_mode IS DISTINCT FROM NEW.execution_mode) THEN

    fingerprint := md5(concat_ws('|',
      NEW.id::text,
      NEW.decision_type,
      COALESCE(NEW.confidence::text, ''),
      NEW.reversibility,
      COALESCE(NEW.commitment_amount::text, ''),
      NEW.currency,
      NEW.authority_level,
      NEW.execution_mode
    ));

    IF NOT EXISTS (
      SELECT 1 FROM public.strategic_governance_evaluations ge
      WHERE ge.decision_id = NEW.id
        AND ge.user_id = NEW.user_id
        AND ge.requested_action = 'autonomous_execute'
        AND ge.result = 'allow'
        AND ge.decision_fingerprint = fingerprint
    ) THEN
      RAISE EXCEPTION 'Bounded autonomous execution requires a current ALLOW governance evaluation';
    END IF;

    breaches := public.current_strategic_stop_breaches(NEW.id);
    IF cardinality(breaches) > 0 THEN
      RAISE EXCEPTION 'Bounded autonomous execution blocked by stop rule(s): %', array_to_string(breaches, '; ');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_decisions_guard_bounded_execution ON public.strategic_decisions;
CREATE TRIGGER strategic_decisions_guard_bounded_execution
  BEFORE UPDATE OF status, execution_mode, confidence, commitment_amount, currency, reversibility, authority_level
  ON public.strategic_decisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_strategic_bounded_execution();

-- ---------- append-only strategic action ledger ----------
CREATE OR REPLACE FUNCTION public.log_strategic_decision_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     OR OLD.execution_mode IS DISTINCT FROM NEW.execution_mode
     OR OLD.outcome_summary IS DISTINCT FROM NEW.outcome_summary THEN
    INSERT INTO public.strategic_action_log (
      user_id, app_id, decision_id, event_type, previous_state, next_state, details
    ) VALUES (
      NEW.user_id,
      NEW.app_id,
      NEW.id,
      CASE
        WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'decision_status_changed'
        WHEN OLD.execution_mode IS DISTINCT FROM NEW.execution_mode THEN 'decision_execution_mode_changed'
        ELSE 'decision_outcome_updated'
      END,
      jsonb_build_object('status', OLD.status, 'execution_mode', OLD.execution_mode, 'outcome_summary', OLD.outcome_summary),
      jsonb_build_object('status', NEW.status, 'execution_mode', NEW.execution_mode, 'outcome_summary', NEW.outcome_summary),
      '{}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_strategic_decision_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS strategic_decisions_log_transition ON public.strategic_decisions;
CREATE TRIGGER strategic_decisions_log_transition
  AFTER UPDATE ON public.strategic_decisions
  FOR EACH ROW EXECUTE FUNCTION public.log_strategic_decision_transition();

CREATE OR REPLACE FUNCTION public.log_strategic_approval_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.strategic_action_log (
      user_id, app_id, decision_id, policy_id, approval_request_id,
      event_type, next_state, details
    ) VALUES (
      NEW.user_id, NEW.app_id, NEW.decision_id, NEW.policy_id, NEW.id,
      'approval_requested',
      jsonb_build_object('approval_type', NEW.approval_type, 'status', NEW.status),
      jsonb_build_object('reason', NEW.reason)
    );
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.strategic_action_log (
      user_id, app_id, decision_id, policy_id, approval_request_id,
      event_type, previous_state, next_state, details
    ) VALUES (
      NEW.user_id, NEW.app_id, NEW.decision_id, NEW.policy_id, NEW.id,
      'approval_status_changed',
      jsonb_build_object('approval_type', OLD.approval_type, 'status', OLD.status),
      jsonb_build_object('approval_type', NEW.approval_type, 'status', NEW.status),
      jsonb_build_object('reviewed_by', NEW.reviewed_by, 'reviewed_at', NEW.reviewed_at)
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_strategic_approval_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS strategic_approval_log_transition ON public.strategic_approval_requests;
CREATE TRIGGER strategic_approval_log_transition
  AFTER INSERT OR UPDATE ON public.strategic_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_strategic_approval_transition();

CREATE OR REPLACE FUNCTION public.log_strategic_governance_evaluation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.strategic_action_log (
    user_id, app_id, decision_id, policy_id, evaluation_id,
    event_type, next_state, details
  ) VALUES (
    NEW.user_id, NEW.app_id, NEW.decision_id, NEW.policy_id, NEW.id,
    'governance_evaluated',
    jsonb_build_object('requested_action', NEW.requested_action, 'result', NEW.result),
    jsonb_build_object('reasons', NEW.reasons, 'decision_fingerprint', NEW.decision_fingerprint)
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_strategic_governance_evaluation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS strategic_governance_eval_log ON public.strategic_governance_evaluations;
CREATE TRIGGER strategic_governance_eval_log
  AFTER INSERT ON public.strategic_governance_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.log_strategic_governance_evaluation();

CREATE OR REPLACE FUNCTION public.log_strategic_stop_rule_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.strategic_action_log (
      user_id, app_id, decision_id, event_type, previous_state, next_state, details
    ) VALUES (
      NEW.user_id,
      NEW.app_id,
      NEW.decision_id,
      CASE WHEN TG_OP = 'INSERT' THEN 'stop_rule_created' ELSE 'stop_rule_status_changed' END,
      CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE jsonb_build_object('status', OLD.status) END,
      jsonb_build_object('status', NEW.status),
      jsonb_build_object('rule_name', NEW.rule_name, 'rule_type', NEW.rule_type, 'action', NEW.action, 'triggered_reason', NEW.triggered_reason)
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_strategic_stop_rule_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS strategic_stop_rule_log_transition ON public.strategic_stop_rules;
CREATE TRIGGER strategic_stop_rule_log_transition
  AFTER INSERT OR UPDATE ON public.strategic_stop_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_strategic_stop_rule_transition();

DROP TRIGGER IF EXISTS strategic_governance_policies_set_updated_at ON public.strategic_governance_policies;
CREATE TRIGGER strategic_governance_policies_set_updated_at
  BEFORE UPDATE ON public.strategic_governance_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS strategic_approval_requests_set_updated_at ON public.strategic_approval_requests;
CREATE TRIGGER strategic_approval_requests_set_updated_at
  BEFORE UPDATE ON public.strategic_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS strategic_stop_rules_set_updated_at ON public.strategic_stop_rules;
CREATE TRIGGER strategic_stop_rules_set_updated_at
  BEFORE UPDATE ON public.strategic_stop_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger helpers are not public RPC endpoints.
REVOKE EXECUTE ON FUNCTION public.validate_strategic_governance_policy_ownership() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_strategic_approval_ownership() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_strategic_stop_rule_ownership() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prepare_strategic_governance_evaluation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_strategic_bounded_execution() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.strategic_governance_policies IS
  'Explicit owner-configured strategic authority envelopes. bounded_execute is invalid without explicit confidence, capital and reversibility limits.';
COMMENT ON TABLE public.strategic_governance_evaluations IS
  'Append-only deterministic governance decisions. Results are calculated by a database trigger, not trusted from the client.';
COMMENT ON TABLE public.strategic_approval_requests IS
  'Auditable human/legal/brand/executive approvals required by governance policy or hard-to-reverse decisions.';
COMMENT ON TABLE public.strategic_stop_rules IS
  'Machine-enforceable stop rules for bounded autonomy using decision-native values or an explicit manual halt.';
COMMENT ON TABLE public.strategic_action_log IS
  'Append-only strategic chain from governance evaluation through approval, execution state and outcome.';
COMMENT ON COLUMN public.strategic_decisions.execution_mode IS
  'manual preserves human execution semantics; bounded_autonomous activates fail-closed governance checks before executing/executed status.';
