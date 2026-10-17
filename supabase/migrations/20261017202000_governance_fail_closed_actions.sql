-- ScrollMarketer Phase 5 hardening: fail closed on unsupported governance actions.
-- Manual execution remains a human workflow and does not need a synthetic
-- governance ALLOW row. The current governance evaluator supports only the
-- bounded-autonomous execution request that it actually enforces.

ALTER TABLE public.strategic_governance_evaluations
  DROP CONSTRAINT IF EXISTS strategic_governance_evaluations_supported_action_check,
  ADD CONSTRAINT strategic_governance_evaluations_supported_action_check
    CHECK (requested_action = 'autonomous_execute');

ALTER TABLE public.strategic_governance_policies
  ALTER COLUMN human_approval_required SET DEFAULT false;

COMMENT ON COLUMN public.strategic_governance_policies.human_approval_required IS
  'Optional additional human checkpoint. Strategic decisions still require status=approved before bounded autonomous execution regardless of this flag.';
COMMENT ON COLUMN public.strategic_governance_evaluations.requested_action IS
  'Currently constrained to autonomous_execute. Unsupported action modes fail closed rather than returning a misleading ALLOW result.';
