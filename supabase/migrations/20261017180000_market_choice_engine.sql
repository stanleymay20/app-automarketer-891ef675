-- ScrollMarketer Phase 3: Opportunity and Market Choice
-- Additive only. Unknown factor values remain NULL and are never silently
-- replaced with neutral/default market assumptions.

CREATE TABLE IF NOT EXISTS public.strategic_market_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.growth_goals(id) ON DELETE SET NULL,

  market_name text NOT NULL,
  segment_name text,
  unmet_need text,
  competitor_gap text,
  white_space_hypothesis text,
  route_to_market text,
  distribution_constraints text,

  entry_mode text NOT NULL DEFAULT 'unknown'
    CHECK (entry_mode = ANY (ARRAY[
      'unknown','digital_direct','export','partner','license','franchise',
      'joint_venture','owned_operation','other'
    ])),
  timing_posture text NOT NULL DEFAULT 'unknown'
    CHECK (timing_posture = ANY (ARRAY['unknown','first_mover','fast_follower','wait'])),
  commitment_class text NOT NULL DEFAULT 'reversible'
    CHECK (commitment_class = ANY (ARRAY['reversible','partly_reversible','hard_to_reverse'])),
  estimated_commitment_amount numeric(14,2)
    CHECK (estimated_commitment_amount IS NULL OR estimated_commitment_amount >= 0),
  currency text NOT NULL DEFAULT 'EUR',

  -- Positive opportunity factors. NULL means unknown.
  demand_score integer CHECK (demand_score IS NULL OR demand_score BETWEEN 0 AND 100),
  growth_score integer CHECK (growth_score IS NULL OR growth_score BETWEEN 0 AND 100),
  customer_value_score integer CHECK (customer_value_score IS NULL OR customer_value_score BETWEEN 0 AND 100),
  strategic_fit_score integer CHECK (strategic_fit_score IS NULL OR strategic_fit_score BETWEEN 0 AND 100),
  accessibility_score integer CHECK (accessibility_score IS NULL OR accessibility_score BETWEEN 0 AND 100),
  distribution_readiness_score integer CHECK (distribution_readiness_score IS NULL OR distribution_readiness_score BETWEEN 0 AND 100),

  -- Burden/risk factors. Higher means worse. NULL means unknown.
  competition_intensity_score integer CHECK (competition_intensity_score IS NULL OR competition_intensity_score BETWEEN 0 AND 100),
  regulatory_risk_score integer CHECK (regulatory_risk_score IS NULL OR regulatory_risk_score BETWEEN 0 AND 100),
  pioneering_cost_score integer CHECK (pioneering_cost_score IS NULL OR pioneering_cost_score BETWEEN 0 AND 100),
  capital_intensity_score integer CHECK (capital_intensity_score IS NULL OR capital_intensity_score BETWEEN 0 AND 100),

  evidence_confidence integer CHECK (evidence_confidence IS NULL OR evidence_confidence BETWEEN 0 AND 100),
  evidence_coverage integer NOT NULL DEFAULT 0 CHECK (evidence_coverage BETWEEN 0 AND 100),
  attractiveness_score numeric(5,2) CHECK (attractiveness_score IS NULL OR attractiveness_score BETWEEN 0 AND 100),
  decision_readiness_score numeric(5,2) CHECK (decision_readiness_score IS NULL OR decision_readiness_score BETWEEN 0 AND 100),
  white_space_score numeric(5,2) CHECK (white_space_score IS NULL OR white_space_score BETWEEN 0 AND 100),

  status text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','assessing','candidate','testing','entered','rejected'])),
  next_test text,
  evidence_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_market_options_user_app_idx
  ON public.strategic_market_options (user_id, app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_market_options_rank_idx
  ON public.strategic_market_options (app_id, decision_readiness_score DESC NULLS LAST, attractiveness_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS strategic_market_options_goal_idx
  ON public.strategic_market_options (goal_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_market_options TO authenticated;
GRANT ALL ON public.strategic_market_options TO service_role;

ALTER TABLE public.strategic_market_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic market options" ON public.strategic_market_options;
CREATE POLICY "Users manage own strategic market options" ON public.strategic_market_options
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Weighted opportunity scoring. Only known factors contribute to the weighted
-- mean. Coverage is stored separately so a high score with sparse evidence is
-- visibly different from a well-supported score.
CREATE OR REPLACE FUNCTION public.score_strategic_market_option()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  weighted_sum numeric := 0;
  weight_sum numeric := 0;
  known_count integer := 0;
BEGIN
  -- Positive factors
  IF NEW.demand_score IS NOT NULL THEN weighted_sum := weighted_sum + NEW.demand_score * 0.18; weight_sum := weight_sum + 0.18; known_count := known_count + 1; END IF;
  IF NEW.growth_score IS NOT NULL THEN weighted_sum := weighted_sum + NEW.growth_score * 0.12; weight_sum := weight_sum + 0.12; known_count := known_count + 1; END IF;
  IF NEW.customer_value_score IS NOT NULL THEN weighted_sum := weighted_sum + NEW.customer_value_score * 0.14; weight_sum := weight_sum + 0.14; known_count := known_count + 1; END IF;
  IF NEW.strategic_fit_score IS NOT NULL THEN weighted_sum := weighted_sum + NEW.strategic_fit_score * 0.14; weight_sum := weight_sum + 0.14; known_count := known_count + 1; END IF;
  IF NEW.accessibility_score IS NOT NULL THEN weighted_sum := weighted_sum + NEW.accessibility_score * 0.10; weight_sum := weight_sum + 0.10; known_count := known_count + 1; END IF;
  IF NEW.distribution_readiness_score IS NOT NULL THEN weighted_sum := weighted_sum + NEW.distribution_readiness_score * 0.10; weight_sum := weight_sum + 0.10; known_count := known_count + 1; END IF;

  -- Negative factors are inverted for attractiveness.
  IF NEW.competition_intensity_score IS NOT NULL THEN weighted_sum := weighted_sum + (100 - NEW.competition_intensity_score) * 0.08; weight_sum := weight_sum + 0.08; known_count := known_count + 1; END IF;
  IF NEW.regulatory_risk_score IS NOT NULL THEN weighted_sum := weighted_sum + (100 - NEW.regulatory_risk_score) * 0.05; weight_sum := weight_sum + 0.05; known_count := known_count + 1; END IF;
  IF NEW.pioneering_cost_score IS NOT NULL THEN weighted_sum := weighted_sum + (100 - NEW.pioneering_cost_score) * 0.05; weight_sum := weight_sum + 0.05; known_count := known_count + 1; END IF;
  IF NEW.capital_intensity_score IS NOT NULL THEN weighted_sum := weighted_sum + (100 - NEW.capital_intensity_score) * 0.04; weight_sum := weight_sum + 0.04; known_count := known_count + 1; END IF;

  NEW.evidence_coverage := round((known_count::numeric / 10.0) * 100)::integer;

  -- Do not publish an attractiveness score from a tiny evidence base.
  IF known_count >= 4 AND weight_sum > 0 THEN
    NEW.attractiveness_score := round(weighted_sum / weight_sum, 2);
  ELSE
    NEW.attractiveness_score := NULL;
  END IF;

  -- White-space proxy requires demand, customer value and competition evidence.
  IF NEW.demand_score IS NOT NULL
     AND NEW.customer_value_score IS NOT NULL
     AND NEW.competition_intensity_score IS NOT NULL THEN
    NEW.white_space_score := round(
      NEW.demand_score * 0.40 +
      NEW.customer_value_score * 0.25 +
      (100 - NEW.competition_intensity_score) * 0.35,
      2
    );
  ELSE
    NEW.white_space_score := NULL;
  END IF;

  -- Decision readiness is deliberately conservative: attractiveness is reduced
  -- by incomplete factor coverage and low evidence confidence. This is a
  -- prioritisation proxy, not a forecast of financial return.
  IF NEW.attractiveness_score IS NOT NULL AND NEW.evidence_confidence IS NOT NULL THEN
    NEW.decision_readiness_score := round(
      NEW.attractiveness_score *
      (NEW.evidence_coverage::numeric / 100.0) *
      (NEW.evidence_confidence::numeric / 100.0),
      2
    );
  ELSE
    NEW.decision_readiness_score := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_market_options_score ON public.strategic_market_options;
CREATE TRIGGER strategic_market_options_score
  BEFORE INSERT OR UPDATE ON public.strategic_market_options
  FOR EACH ROW EXECUTE FUNCTION public.score_strategic_market_option();

-- Link proposed strategic decisions back to the market option that generated
-- them without changing existing decision semantics.
ALTER TABLE public.strategic_decisions
  ADD COLUMN IF NOT EXISTS market_option_id uuid REFERENCES public.strategic_market_options(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS strategic_decisions_market_option_idx
  ON public.strategic_decisions (market_option_id, created_at DESC);

COMMENT ON TABLE public.strategic_market_options IS
  'Evidence-aware market/segment options for opportunity ranking, white-space hypotheses, entry mode, pioneering cost and commitment analysis.';
COMMENT ON COLUMN public.strategic_market_options.attractiveness_score IS
  'Weighted mean over known factors only; NULL until at least four factors are known. Evidence coverage must be shown alongside it.';
COMMENT ON COLUMN public.strategic_market_options.decision_readiness_score IS
  'Conservative prioritisation proxy = attractiveness × evidence coverage × evidence confidence. Not expected financial return.';
COMMENT ON COLUMN public.strategic_market_options.white_space_score IS
  'Demand/customer-value/competition proxy only; it does not prove an unmet need or competitor weakness.';
