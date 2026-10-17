-- ScrollMarketer Phase 4: Strategy Simulation
-- Additive scenario/countermove and sensitivity foundation.
-- This migration deliberately does NOT infer competitor probabilities from
-- ephemeral competitor_signals. Unknown likelihood stays NULL.

CREATE TABLE IF NOT EXISTS public.strategic_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.growth_goals(id) ON DELETE SET NULL,
  decision_id uuid REFERENCES public.strategic_decisions(id) ON DELETE SET NULL,
  market_option_id uuid REFERENCES public.strategic_market_options(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  base_move text NOT NULL,
  decision_question text,
  time_horizon text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','active','completed','archived'])),
  conclusion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_scenarios_user_app_idx
  ON public.strategic_scenarios (user_id, app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_scenarios_decision_idx
  ON public.strategic_scenarios (decision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_scenarios_market_idx
  ON public.strategic_scenarios (market_option_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_scenarios TO authenticated;
GRANT ALL ON public.strategic_scenarios TO service_role;
ALTER TABLE public.strategic_scenarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic scenarios" ON public.strategic_scenarios;
CREATE POLICY "Users manage own strategic scenarios" ON public.strategic_scenarios
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.strategic_scenario_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.strategic_scenarios(id) ON DELETE CASCADE,
  parent_branch_id uuid REFERENCES public.strategic_scenario_branches(id) ON DELETE CASCADE,
  evidence_item_id uuid REFERENCES public.strategic_evidence_items(id) ON DELETE SET NULL,
  actor_type text NOT NULL DEFAULT 'market'
    CHECK (actor_type = ANY (ARRAY['company','competitor','customer','market','regulator','partner','internal','other'])),
  actor_name text,
  event_type text NOT NULL DEFAULT 'other',
  event_description text NOT NULL,
  likelihood_basis text NOT NULL DEFAULT 'unknown'
    CHECK (likelihood_basis = ANY (ARRAY['unknown','manual_assumption','observed_frequency'])),
  likelihood_pct numeric(5,2)
    CHECK (likelihood_pct IS NULL OR likelihood_pct BETWEEN 0 AND 100),
  observed_response_count integer
    CHECK (observed_response_count IS NULL OR observed_response_count >= 0),
  comparable_event_count integer
    CHECK (comparable_event_count IS NULL OR comparable_event_count > 0),
  impact_score integer NOT NULL DEFAULT 0 CHECK (impact_score BETWEEN -100 AND 100),
  decision_effect text NOT NULL DEFAULT 'unknown'
    CHECK (decision_effect = ANY (ARRAY['holds','changes','unknown'])),
  response_move text,
  response_reversibility text NOT NULL DEFAULT 'reversible'
    CHECK (response_reversibility = ANY (ARRAY['reversible','partly_reversible','hard_to_reverse'])),
  stress_score numeric(5,2)
    CHECK (stress_score IS NULL OR stress_score BETWEEN 0 AND 100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_scenario_branches_scenario_idx
  ON public.strategic_scenario_branches (scenario_id, created_at ASC);
CREATE INDEX IF NOT EXISTS strategic_scenario_branches_parent_idx
  ON public.strategic_scenario_branches (parent_branch_id, created_at ASC);
CREATE INDEX IF NOT EXISTS strategic_scenario_branches_stress_idx
  ON public.strategic_scenario_branches (scenario_id, stress_score DESC NULLS LAST);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_scenario_branches TO authenticated;
GRANT ALL ON public.strategic_scenario_branches TO service_role;
ALTER TABLE public.strategic_scenario_branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic scenario branches" ON public.strategic_scenario_branches;
CREATE POLICY "Users manage own strategic scenario branches" ON public.strategic_scenario_branches
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Sensitivity records are intentionally explicit/manual: ScrollMarketer stores
-- the low/base/high assumptions and outcomes but does not invent them.
CREATE TABLE IF NOT EXISTS public.strategic_sensitivity_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.strategic_scenarios(id) ON DELETE CASCADE,
  evidence_item_id uuid REFERENCES public.strategic_evidence_items(id) ON DELETE SET NULL,
  variable_name text NOT NULL,
  variable_unit text,
  low_value numeric,
  base_value numeric,
  high_value numeric,
  outcome_metric text NOT NULL,
  outcome_unit text,
  low_outcome numeric,
  base_outcome numeric,
  high_outcome numeric,
  evidence_basis text NOT NULL DEFAULT 'assumption'
    CHECK (evidence_basis = ANY (ARRAY['observation','experiment','assumption','model','other'])),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_sensitivity_scenario_idx
  ON public.strategic_sensitivity_tests (scenario_id, created_at ASC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_sensitivity_tests TO authenticated;
GRANT ALL ON public.strategic_sensitivity_tests TO service_role;
ALTER TABLE public.strategic_sensitivity_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic sensitivity tests" ON public.strategic_sensitivity_tests;
CREATE POLICY "Users manage own strategic sensitivity tests" ON public.strategic_sensitivity_tests
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Cross-entity ownership validation prevents an authenticated user from linking
-- scenario objects to another user's app/objective/decision/market/evidence.
CREATE OR REPLACE FUNCTION public.validate_strategic_scenario_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.apps WHERE id = NEW.app_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Scenario app must belong to the same user';
  END IF;
  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.growth_goals WHERE id = NEW.goal_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Scenario goal must belong to the same user';
  END IF;
  IF NEW.decision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.strategic_decisions WHERE id = NEW.decision_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Scenario decision must belong to the same user';
  END IF;
  IF NEW.market_option_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.strategic_market_options WHERE id = NEW.market_option_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Scenario market option must belong to the same user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_scenarios_validate_ownership ON public.strategic_scenarios;
CREATE TRIGGER strategic_scenarios_validate_ownership
  BEFORE INSERT OR UPDATE OF user_id, app_id, goal_id, decision_id, market_option_id ON public.strategic_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_scenario_ownership();

CREATE OR REPLACE FUNCTION public.prepare_strategic_scenario_branch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_scenario uuid;
  evidence_owner uuid;
  evidence_type text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.strategic_scenarios
    WHERE id = NEW.scenario_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Scenario branch must belong to the scenario owner';
  END IF;

  IF NEW.parent_branch_id IS NOT NULL THEN
    SELECT scenario_id INTO parent_scenario
    FROM public.strategic_scenario_branches
    WHERE id = NEW.parent_branch_id AND user_id = NEW.user_id;
    IF parent_scenario IS NULL OR parent_scenario <> NEW.scenario_id THEN
      RAISE EXCEPTION 'Parent branch must belong to the same scenario and user';
    END IF;
    IF NEW.parent_branch_id = NEW.id THEN
      RAISE EXCEPTION 'Scenario branch cannot be its own parent';
    END IF;
  END IF;

  IF NEW.evidence_item_id IS NOT NULL THEN
    SELECT user_id, item_type INTO evidence_owner, evidence_type
    FROM public.strategic_evidence_items
    WHERE id = NEW.evidence_item_id;
    IF evidence_owner IS NULL OR evidence_owner <> NEW.user_id THEN
      RAISE EXCEPTION 'Scenario branch evidence must belong to the same user';
    END IF;
  END IF;

  CASE NEW.likelihood_basis
    WHEN 'unknown' THEN
      NEW.likelihood_pct := NULL;
      NEW.observed_response_count := NULL;
      NEW.comparable_event_count := NULL;
    WHEN 'manual_assumption' THEN
      IF NEW.likelihood_pct IS NULL THEN
        RAISE EXCEPTION 'Manual-assumption likelihood requires an explicit percentage';
      END IF;
      NEW.observed_response_count := NULL;
      NEW.comparable_event_count := NULL;
    WHEN 'observed_frequency' THEN
      IF NEW.evidence_item_id IS NULL OR evidence_type <> 'observation' THEN
        RAISE EXCEPTION 'Observed-frequency likelihood requires linked observation evidence';
      END IF;
      IF NEW.observed_response_count IS NULL OR NEW.comparable_event_count IS NULL
         OR NEW.observed_response_count > NEW.comparable_event_count THEN
        RAISE EXCEPTION 'Observed-frequency likelihood requires valid response/comparable counts';
      END IF;
      NEW.likelihood_pct := round((NEW.observed_response_count::numeric / NEW.comparable_event_count::numeric) * 100, 2);
  END CASE;

  -- Stress is only a prioritisation aid. Unknown likelihood -> unknown stress.
  IF NEW.likelihood_pct IS NULL OR NEW.decision_effect = 'holds' THEN
    NEW.stress_score := CASE WHEN NEW.decision_effect = 'holds' AND NEW.likelihood_pct IS NOT NULL THEN 0 ELSE NULL END;
  ELSE
    NEW.stress_score := round((NEW.likelihood_pct * abs(NEW.impact_score)::numeric) / 100.0, 2);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_scenario_branches_prepare ON public.strategic_scenario_branches;
CREATE TRIGGER strategic_scenario_branches_prepare
  BEFORE INSERT OR UPDATE ON public.strategic_scenario_branches
  FOR EACH ROW EXECUTE FUNCTION public.prepare_strategic_scenario_branch();

CREATE OR REPLACE FUNCTION public.validate_strategic_sensitivity_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_owner uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.strategic_scenarios
    WHERE id = NEW.scenario_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Sensitivity test must belong to the scenario owner';
  END IF;
  IF NEW.evidence_item_id IS NOT NULL THEN
    SELECT user_id INTO evidence_owner FROM public.strategic_evidence_items WHERE id = NEW.evidence_item_id;
    IF evidence_owner IS NULL OR evidence_owner <> NEW.user_id THEN
      RAISE EXCEPTION 'Sensitivity evidence must belong to the same user';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_sensitivity_validate_ownership ON public.strategic_sensitivity_tests;
CREATE TRIGGER strategic_sensitivity_validate_ownership
  BEFORE INSERT OR UPDATE ON public.strategic_sensitivity_tests
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_sensitivity_ownership();

DROP TRIGGER IF EXISTS strategic_scenarios_set_updated_at ON public.strategic_scenarios;
CREATE TRIGGER strategic_scenarios_set_updated_at
  BEFORE UPDATE ON public.strategic_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.strategic_scenarios IS
  'Scenario containers for explicit strategic moves, uncertainties and conclusions; not autonomous forecasts.';
COMMENT ON COLUMN public.strategic_scenario_branches.likelihood_pct IS
  'Nullable scenario likelihood. Unknown stays NULL. Observed-frequency values are descriptive historical frequencies, not guaranteed future probabilities.';
COMMENT ON COLUMN public.strategic_scenario_branches.stress_score IS
  '0-100 prioritisation proxy = likelihood x absolute impact for branches that may change the decision. Not expected loss.';
COMMENT ON TABLE public.strategic_sensitivity_tests IS
  'Explicit low/base/high sensitivity assumptions and outcomes. Values are stored, not invented by the database.';
