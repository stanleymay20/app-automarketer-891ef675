-- ScrollMarketer Commercial Decision Intelligence foundation
-- Additive migration only. Existing growth goals remain valid and become
-- the measurable layer of a richer strategic objective.

ALTER TABLE public.growth_goals
  ADD COLUMN IF NOT EXISTS objective_name text,
  ADD COLUMN IF NOT EXISTS strategic_rationale text,
  ADD COLUMN IF NOT EXISTS target_market text,
  ADD COLUMN IF NOT EXISTS target_segment text,
  ADD COLUMN IF NOT EXISTS assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_threshold integer NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS commitment_class text NOT NULL DEFAULT 'reversible',
  ADD COLUMN IF NOT EXISTS risk_tolerance text NOT NULL DEFAULT 'moderate';

ALTER TABLE public.growth_goals
  DROP CONSTRAINT IF EXISTS growth_goals_evidence_threshold_check,
  ADD CONSTRAINT growth_goals_evidence_threshold_check
    CHECK (evidence_threshold BETWEEN 0 AND 100),
  DROP CONSTRAINT IF EXISTS growth_goals_commitment_class_check,
  ADD CONSTRAINT growth_goals_commitment_class_check
    CHECK (commitment_class = ANY (ARRAY['reversible','partly_reversible','hard_to_reverse'])),
  DROP CONSTRAINT IF EXISTS growth_goals_risk_tolerance_check,
  ADD CONSTRAINT growth_goals_risk_tolerance_check
    CHECK (risk_tolerance = ANY (ARRAY['conservative','moderate','aggressive']));

-- Preserve legacy goals without inventing strategic context. The display name
-- is derived only from the existing goal type; rationale/market assumptions stay unknown.
UPDATE public.growth_goals
SET objective_name = initcap(replace(goal_type, '_', ' '))
WHERE objective_name IS NULL;

CREATE TABLE IF NOT EXISTS public.strategic_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.growth_goals(id) ON DELETE SET NULL,
  recommendation_id uuid REFERENCES public.growth_recommendations(id) ON DELETE SET NULL,
  decision_type text NOT NULL DEFAULT 'test'
    CHECK (decision_type = ANY (ARRAY[
      'research','wait','test','partner','reposition','product','price',
      'enter','exit','advertise','scale','other'
    ])),
  title text NOT NULL,
  recommendation text NOT NULL,
  rationale text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  unknowns text[] NOT NULL DEFAULT ARRAY[]::text[],
  sensitivities jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence integer CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  expected_upside text,
  expected_downside text,
  reversibility text NOT NULL DEFAULT 'reversible'
    CHECK (reversibility = ANY (ARRAY['reversible','partly_reversible','hard_to_reverse'])),
  commitment_amount numeric(14,2),
  currency text NOT NULL DEFAULT 'EUR',
  authority_level text NOT NULL DEFAULT 'recommend'
    CHECK (authority_level = ANY (ARRAY[
      'observe','recommend','draft','bounded_execute','executive_approval'
    ])),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status = ANY (ARRAY[
      'proposed','approved','rejected','executing','executed','cancelled'
    ])),
  next_information_needed text,
  success_conditions text[] NOT NULL DEFAULT ARRAY[]::text[],
  kill_conditions text[] NOT NULL DEFAULT ARRAY[]::text[],
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  executed_at timestamptz,
  outcome_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_decisions_user_created_idx
  ON public.strategic_decisions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_decisions_app_status_idx
  ON public.strategic_decisions (app_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_decisions_goal_idx
  ON public.strategic_decisions (goal_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_decisions TO authenticated;
GRANT ALL ON public.strategic_decisions TO service_role;

ALTER TABLE public.strategic_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic decisions" ON public.strategic_decisions;
CREATE POLICY "Users manage own strategic decisions" ON public.strategic_decisions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS strategic_decisions_set_updated_at ON public.strategic_decisions;
CREATE TRIGGER strategic_decisions_set_updated_at
  BEFORE UPDATE ON public.strategic_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.strategic_decisions IS
  'Auditable decision ledger: recommendation, evidence, uncertainty, reversibility, authority, execution and outcome.';
COMMENT ON COLUMN public.strategic_decisions.evidence IS
  'Observed evidence only. Inferences and assumptions belong in assumptions/unknowns.';
COMMENT ON COLUMN public.strategic_decisions.next_information_needed IS
  'The next question or evidence most likely to improve the decision.';
