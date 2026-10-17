-- ScrollMarketer Phase 5 hardening: governance freshness guards
-- Approvals and ALLOW evaluations are valid only for the exact decision and
-- policy state they reviewed. Any relevant change invalidates reuse.

ALTER TABLE public.strategic_approval_requests
  ADD COLUMN IF NOT EXISTS decision_fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS policy_fingerprint text NOT NULL DEFAULT '';

ALTER TABLE public.strategic_governance_evaluations
  ADD COLUMN IF NOT EXISTS policy_fingerprint text NOT NULL DEFAULT '';

DROP INDEX IF EXISTS public.strategic_approval_pending_uidx;
CREATE UNIQUE INDEX strategic_approval_pending_uidx
  ON public.strategic_approval_requests (
    decision_id, approval_type, decision_fingerprint, policy_fingerprint
  )
  WHERE status = 'pending';

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
    NEW.policy_fingerprint := '';
    NEW.result := 'block';
    NEW.reasons := jsonb_build_array('No enabled governance policy applies to this decision.');
    RETURN NEW;
  END IF;

  NEW.policy_id := p.id;
  NEW.policy_snapshot := to_jsonb(p);
  -- Conservative freshness: any policy update invalidates old approvals/evaluations.
  NEW.policy_fingerprint := md5(concat_ws('|', p.id::text, p.updated_at::text));

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

    -- Pending approvals for a previous decision/policy version cannot satisfy
    -- the current evaluation and are cancelled to avoid UI ambiguity.
    UPDATE public.strategic_approval_requests ar
    SET status = 'cancelled'
    WHERE ar.user_id = d.user_id
      AND ar.decision_id = d.id
      AND ar.status = 'pending'
      AND (
        ar.decision_fingerprint <> NEW.decision_fingerprint
        OR ar.policy_fingerprint <> NEW.policy_fingerprint
      );

    FOREACH approval_kind IN ARRAY ARRAY['human','legal','brand','executive']::text[]
    LOOP
      IF (approval_kind = 'human' AND need_human)
         OR (approval_kind = 'legal' AND need_legal)
         OR (approval_kind = 'brand' AND need_brand)
         OR (approval_kind = 'executive' AND need_executive) THEN

        SELECT EXISTS (
          SELECT 1 FROM public.strategic_approval_requests ar
          WHERE ar.decision_id = d.id
            AND ar.user_id = d.user_id
            AND ar.policy_id = p.id
            AND ar.approval_type = approval_kind
            AND ar.status = 'approved'
            AND ar.decision_fingerprint = NEW.decision_fingerprint
            AND ar.policy_fingerprint = NEW.policy_fingerprint
        ) INTO approved_exists;

        SELECT EXISTS (
          SELECT 1 FROM public.strategic_approval_requests ar
          WHERE ar.decision_id = d.id
            AND ar.user_id = d.user_id
            AND ar.policy_id = p.id
            AND ar.approval_type = approval_kind
            AND ar.status = 'rejected'
            AND ar.decision_fingerprint = NEW.decision_fingerprint
            AND ar.policy_fingerprint = NEW.policy_fingerprint
        ) INTO rejected_exists;

        IF rejected_exists AND NOT approved_exists THEN
          eval_result := 'block';
          reasons := reasons || jsonb_build_array(initcap(approval_kind) || ' approval was rejected for the current decision/policy version.');
        ELSIF NOT approved_exists THEN
          IF eval_result <> 'block' THEN eval_result := 'review'; END IF;
          reasons := reasons || jsonb_build_array(initcap(approval_kind) || ' approval is required.');
          INSERT INTO public.strategic_approval_requests (
            user_id, app_id, decision_id, policy_id, approval_type, reason,
            decision_snapshot, policy_snapshot, decision_fingerprint,
            policy_fingerprint, requested_by
          ) VALUES (
            d.user_id, d.app_id, d.id, p.id, approval_kind,
            'Required by deterministic governance evaluation.',
            to_jsonb(d), to_jsonb(p), NEW.decision_fingerprint,
            NEW.policy_fingerprint, COALESCE((select auth.uid()), d.user_id)
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

CREATE OR REPLACE FUNCTION public.guard_strategic_bounded_execution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  fingerprint text;
  policy_fingerprint text;
  current_policy_id uuid;
  current_policy_updated_at timestamptz;
  breaches text[];
BEGIN
  -- This trigger is attached only to governance-relevant columns. While a
  -- decision is executing/executed under bounded autonomy, ANY such mutation
  -- must still match a fresh ALLOW evaluation.
  IF NEW.execution_mode = 'bounded_autonomous'
     AND NEW.status IN ('executing','executed') THEN

    fingerprint := md5(concat_ws('|',
      NEW.id::text,
      NEW.decision_type,
      NEW.title,
      NEW.recommendation,
      COALESCE(NEW.rationale, ''),
      COALESCE(NEW.goal_id::text, ''),
      COALESCE(NEW.market_option_id::text, ''),
      COALESCE(NEW.confidence::text, ''),
      NEW.reversibility,
      COALESCE(NEW.commitment_amount::text, ''),
      NEW.currency,
      NEW.authority_level,
      NEW.execution_mode
    ));

    SELECT gp.id, gp.updated_at
      INTO current_policy_id, current_policy_updated_at
    FROM public.strategic_governance_policies gp
    WHERE gp.user_id = NEW.user_id
      AND gp.enabled = true
      AND (gp.app_id IS NULL OR gp.app_id = NEW.app_id)
      AND (cardinality(gp.decision_types) = 0 OR NEW.decision_type = ANY(gp.decision_types))
    ORDER BY (gp.app_id IS NOT NULL) DESC, gp.priority DESC, gp.created_at DESC
    LIMIT 1;

    IF current_policy_id IS NULL THEN
      RAISE EXCEPTION 'Bounded autonomous execution requires an enabled applicable governance policy';
    END IF;

    policy_fingerprint := md5(concat_ws('|', current_policy_id::text, current_policy_updated_at::text));

    IF NOT EXISTS (
      SELECT 1 FROM public.strategic_governance_evaluations ge
      WHERE ge.decision_id = NEW.id
        AND ge.user_id = NEW.user_id
        AND ge.policy_id = current_policy_id
        AND ge.requested_action = 'autonomous_execute'
        AND ge.result = 'allow'
        AND ge.decision_fingerprint = fingerprint
        AND ge.policy_fingerprint = policy_fingerprint
    ) THEN
      RAISE EXCEPTION 'Bounded autonomous execution requires a fresh ALLOW governance evaluation for the current decision and policy state';
    END IF;

    breaches := public.current_strategic_stop_breaches(NEW.id);
    IF cardinality(breaches) > 0 THEN
      RAISE EXCEPTION 'Bounded autonomous execution blocked by stop rule(s): %', array_to_string(breaches, '; ');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Include semantic decision fields in the guard trigger so a decision cannot be
-- materially changed mid-execution while reusing an old approval/evaluation.
DROP TRIGGER IF EXISTS strategic_decisions_guard_bounded_execution ON public.strategic_decisions;
CREATE TRIGGER strategic_decisions_guard_bounded_execution
  BEFORE UPDATE OF status, execution_mode, decision_type, title, recommendation,
    rationale, goal_id, market_option_id, confidence, commitment_amount, currency,
    reversibility, authority_level
  ON public.strategic_decisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_strategic_bounded_execution();

REVOKE EXECUTE ON FUNCTION public.prepare_strategic_governance_evaluation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_strategic_bounded_execution() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.strategic_approval_requests.decision_fingerprint IS
  'Fingerprint of the exact decision state reviewed. A later decision change requires a new approval.';
COMMENT ON COLUMN public.strategic_approval_requests.policy_fingerprint IS
  'Fingerprint of the exact policy version reviewed. A later policy update requires a new approval.';
COMMENT ON COLUMN public.strategic_governance_evaluations.policy_fingerprint IS
  'Fingerprint of the applicable policy version at evaluation time; stale ALLOW evaluations cannot authorize execution.';
