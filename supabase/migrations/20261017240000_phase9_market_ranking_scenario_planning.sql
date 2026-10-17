-- ScrollMarketer Phase 9: recommendation-only market ranking + scenario planning.
-- Deterministic ranking/summary stays authoritative; AI may only annotate/explain.
-- Phase 9 writes immutable analysis artifacts and never mutates market scores,
-- scenario conclusions, approvals, execution state, spend, pricing, or external systems.

CREATE TABLE IF NOT EXISTS public.strategic_market_ranking_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  objective_id uuid REFERENCES public.growth_goals(id) ON DELETE SET NULL,
  context_snapshot_id uuid NOT NULL REFERENCES public.strategic_context_snapshots(id) ON DELETE RESTRICT,
  top_market_option_id uuid REFERENCES public.strategic_market_options(id) ON DELETE SET NULL,
  summary text,
  market_count integer NOT NULL DEFAULT 0 CHECK (market_count >= 0),
  ranked_count integer NOT NULL DEFAULT 0 CHECK (ranked_count >= 0),
  insufficient_evidence_count integer NOT NULL DEFAULT 0 CHECK (insufficient_evidence_count >= 0),
  excluded_count integer NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.strategic_market_ranking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.strategic_market_ranking_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  market_option_id uuid NOT NULL REFERENCES public.strategic_market_options(id) ON DELETE RESTRICT,
  rank_state text NOT NULL CHECK (rank_state = ANY (ARRAY['ranked','insufficient_evidence','excluded'])),
  deterministic_rank integer CHECK (deterministic_rank IS NULL OR deterministic_rank > 0),
  decision_readiness_score numeric(5,2) CHECK (decision_readiness_score IS NULL OR decision_readiness_score BETWEEN 0 AND 100),
  attractiveness_score numeric(5,2) CHECK (attractiveness_score IS NULL OR attractiveness_score BETWEEN 0 AND 100),
  evidence_coverage integer NOT NULL CHECK (evidence_coverage BETWEEN 0 AND 100),
  evidence_confidence integer CHECK (evidence_confidence IS NULL OR evidence_confidence BETWEEN 0 AND 100),
  recommendation text CHECK (recommendation IS NULL OR recommendation = ANY (ARRAY['test','research','wait','deprioritize'])),
  rationale text,
  confidence integer CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  evidence_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  memory_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  question_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  unknown_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  next_information_needed text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, market_option_id)
);

CREATE TABLE IF NOT EXISTS public.strategic_scenario_assessment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.strategic_scenarios(id) ON DELETE RESTRICT,
  context_snapshot_id uuid NOT NULL REFERENCES public.strategic_context_snapshots(id) ON DELETE RESTRICT,
  recommendation text NOT NULL CHECK (recommendation = ANY (ARRAY['holds','changes','needs_more_evidence'])),
  confidence integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  rationale text,
  branch_count integer NOT NULL DEFAULT 0 CHECK (branch_count >= 0),
  assessed_branch_count integer NOT NULL DEFAULT 0 CHECK (assessed_branch_count >= 0),
  known_likelihood_count integer NOT NULL DEFAULT 0 CHECK (known_likelihood_count >= 0),
  unknown_likelihood_count integer NOT NULL DEFAULT 0 CHECK (unknown_likelihood_count >= 0),
  holds_count integer NOT NULL DEFAULT 0 CHECK (holds_count >= 0),
  changes_count integer NOT NULL DEFAULT 0 CHECK (changes_count >= 0),
  unknown_effect_count integer NOT NULL DEFAULT 0 CHECK (unknown_effect_count >= 0),
  max_stress_score numeric(5,2) CHECK (max_stress_score IS NULL OR max_stress_score BETWEEN 0 AND 100),
  sensitivity_count integer NOT NULL DEFAULT 0 CHECK (sensitivity_count >= 0),
  branch_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  evidence_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  memory_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  question_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  unknown_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  next_information_needed text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_market_ranking_runs_user_app_idx
  ON public.strategic_market_ranking_runs (user_id, app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_market_ranking_items_run_idx
  ON public.strategic_market_ranking_items (run_id, deterministic_rank ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS strategic_scenario_assessment_user_app_idx
  ON public.strategic_scenario_assessment_runs (user_id, app_id, scenario_id, created_at DESC);

GRANT SELECT ON public.strategic_market_ranking_runs, public.strategic_market_ranking_items, public.strategic_scenario_assessment_runs TO authenticated;
GRANT ALL ON public.strategic_market_ranking_runs, public.strategic_market_ranking_items, public.strategic_scenario_assessment_runs TO service_role;

ALTER TABLE public.strategic_market_ranking_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategic_market_ranking_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategic_scenario_assessment_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own market ranking runs" ON public.strategic_market_ranking_runs;
CREATE POLICY "Users select own market ranking runs" ON public.strategic_market_ranking_runs
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users select own market ranking items" ON public.strategic_market_ranking_items;
CREATE POLICY "Users select own market ranking items" ON public.strategic_market_ranking_items
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users select own scenario assessment runs" ON public.strategic_scenario_assessment_runs;
CREATE POLICY "Users select own scenario assessment runs" ON public.strategic_scenario_assessment_runs
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- Create an immutable market-ranking context snapshot with the full authoritative
-- market-option basis embedded alongside the Phase 8 controlled context.
CREATE OR REPLACE FUNCTION public.create_market_ranking_context_snapshot(
  p_app_id uuid,
  p_objective_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_context jsonb;
  v_basis jsonb := '[]'::jsonb;
  v_fingerprint text;
  v_snapshot_id uuid;
  v_focus_type text := CASE WHEN p_objective_id IS NULL THEN 'app' ELSE 'objective' END;
  v_focus_id uuid := COALESCE(p_objective_id, p_app_id);
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.apps WHERE id = p_app_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'Market-ranking app does not exist or is not owned by the current user';
  END IF;
  IF p_objective_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.growth_goals WHERE id = p_objective_id AND user_id = v_user_id AND app_id = p_app_id
  ) THEN
    RAISE EXCEPTION 'Market-ranking objective must belong to the selected app';
  END IF;

  v_context := public.assemble_strategic_decision_context(
    p_app_id, 'market_ranking', v_focus_type, v_focus_id, 60, 30, 15, 10
  );

  WITH basis AS (
    SELECT m.*,
      CASE
        WHEN m.status IN ('entered','rejected') THEN 'excluded'::text
        WHEN m.decision_readiness_score IS NULL THEN 'insufficient_evidence'::text
        ELSE 'ranked'::text
      END AS rank_state,
      row_number() OVER (
        ORDER BY
          CASE WHEN m.status NOT IN ('entered','rejected') AND m.decision_readiness_score IS NOT NULL THEN 0 ELSE 1 END,
          m.decision_readiness_score DESC NULLS LAST,
          m.attractiveness_score DESC NULLS LAST,
          m.evidence_coverage DESC,
          m.evidence_confidence DESC NULLS LAST,
          m.id ASC
      ) AS raw_rank
    FROM public.strategic_market_options m
    WHERE m.user_id = v_user_id
      AND m.app_id = p_app_id
      AND (p_objective_id IS NULL OR m.goal_id = p_objective_id OR m.goal_id IS NULL)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'market_option_id', b.id,
    'market_name', b.market_name,
    'segment_name', b.segment_name,
    'status', b.status,
    'rank_state', b.rank_state,
    'deterministic_rank', CASE WHEN b.rank_state = 'ranked' THEN b.raw_rank ELSE NULL END,
    'decision_readiness_score', b.decision_readiness_score,
    'attractiveness_score', b.attractiveness_score,
    'white_space_score', b.white_space_score,
    'evidence_coverage', b.evidence_coverage,
    'evidence_confidence', b.evidence_confidence,
    'demand_score', b.demand_score,
    'growth_score', b.growth_score,
    'customer_value_score', b.customer_value_score,
    'strategic_fit_score', b.strategic_fit_score,
    'accessibility_score', b.accessibility_score,
    'distribution_readiness_score', b.distribution_readiness_score,
    'competition_intensity_score', b.competition_intensity_score,
    'regulatory_risk_score', b.regulatory_risk_score,
    'pioneering_cost_score', b.pioneering_cost_score,
    'capital_intensity_score', b.capital_intensity_score,
    'entry_mode', b.entry_mode,
    'timing_posture', b.timing_posture,
    'commitment_class', b.commitment_class,
    'estimated_commitment_amount', b.estimated_commitment_amount,
    'currency', b.currency,
    'unmet_need', b.unmet_need,
    'competitor_gap', b.competitor_gap,
    'white_space_hypothesis', b.white_space_hypothesis,
    'route_to_market', b.route_to_market,
    'distribution_constraints', b.distribution_constraints,
    'next_test', b.next_test,
    'evidence_notes', b.evidence_notes
  ) ORDER BY
    CASE b.rank_state WHEN 'ranked' THEN 0 WHEN 'insufficient_evidence' THEN 1 ELSE 2 END,
    b.raw_rank ASC), '[]'::jsonb)
  INTO v_basis
  FROM basis b;

  v_context := v_context || jsonb_build_object(
    'phase9', jsonb_build_object(
      'mode', 'recommendation_only',
      'market_ranking_basis', v_basis,
      'ranking_rule', jsonb_build_object(
        'primary', 'decision_readiness_score DESC',
        'tie_breakers', jsonb_build_array('attractiveness_score DESC','evidence_coverage DESC','evidence_confidence DESC','market_option_id ASC'),
        'insufficient_evidence', 'decision_readiness_score NULL is not numerically ranked',
        'excluded_statuses', jsonb_build_array('entered','rejected'),
        'warning', 'Ranking is a prioritisation aid, not expected financial return.'
      ),
      'objective_id', p_objective_id
    )
  );
  v_fingerprint := md5(v_context::text);

  INSERT INTO public.strategic_context_snapshots (
    user_id, app_id, purpose, focus_type, focus_id, context_version, context_fingerprint, context
  ) VALUES (
    v_user_id, p_app_id, 'market_ranking', v_focus_type, v_focus_id,
    'phase9-market-v1', v_fingerprint, v_context
  ) RETURNING id INTO v_snapshot_id;

  INSERT INTO public.strategic_action_log (user_id, app_id, event_type, details)
  VALUES (v_user_id, p_app_id, 'market_ranking_context_created', jsonb_build_object(
    'snapshot_id', v_snapshot_id, 'objective_id', p_objective_id, 'fingerprint', v_fingerprint
  ));

  RETURN jsonb_build_object('snapshot_id', v_snapshot_id, 'context_fingerprint', v_fingerprint, 'context', v_context);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_market_ranking_context_snapshot(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_market_ranking_context_snapshot(uuid,uuid) TO authenticated, service_role;

-- Scenario-planning snapshot with authoritative branches/sensitivities embedded.
CREATE OR REPLACE FUNCTION public.create_scenario_planning_context_snapshot(
  p_app_id uuid,
  p_scenario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_context jsonb;
  v_scenario jsonb;
  v_branches jsonb := '[]'::jsonb;
  v_sensitivities jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_fingerprint text;
  v_snapshot_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT jsonb_build_object(
    'id', s.id, 'title', s.title, 'description', s.description, 'base_move', s.base_move,
    'decision_question', s.decision_question, 'time_horizon', s.time_horizon,
    'status', s.status, 'decision_id', s.decision_id, 'market_option_id', s.market_option_id,
    'goal_id', s.goal_id
  ) INTO v_scenario
  FROM public.strategic_scenarios s
  WHERE s.id = p_scenario_id AND s.user_id = v_user_id AND s.app_id = p_app_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scenario must belong to the selected app'; END IF;

  v_context := public.assemble_strategic_decision_context(
    p_app_id, 'scenario_planning', 'scenario', p_scenario_id, 60, 30, 15, 10
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'parent_branch_id', b.parent_branch_id,
    'actor_type', b.actor_type,
    'actor_name', b.actor_name,
    'event_type', b.event_type,
    'event_description', b.event_description,
    'likelihood_basis', b.likelihood_basis,
    'likelihood_pct', b.likelihood_pct,
    'likelihood_evidence_status', e.status,
    'likelihood_qualification', CASE
      WHEN b.likelihood_basis = 'unknown' THEN 'unknown'
      WHEN b.likelihood_basis = 'manual_assumption' THEN 'manual_assumption'
      WHEN b.likelihood_basis = 'observed_frequency' AND e.item_type = 'observation' AND e.status = 'validated' THEN 'validated_observation'
      ELSE 'unverified_observation'
    END,
    'observed_response_count', b.observed_response_count,
    'comparable_event_count', b.comparable_event_count,
    'impact_score', b.impact_score,
    'decision_effect', b.decision_effect,
    'response_move', b.response_move,
    'response_reversibility', b.response_reversibility,
    'stress_score', b.stress_score,
    'qualified_stress_score', CASE
      WHEN b.likelihood_basis = 'observed_frequency' AND NOT (e.item_type = 'observation' AND e.status = 'validated') THEN NULL
      ELSE b.stress_score
    END,
    'evidence_item_id', b.evidence_item_id,
    'notes', b.notes
  ) ORDER BY b.created_at ASC), '[]'::jsonb)
  INTO v_branches
  FROM public.strategic_scenario_branches b
  LEFT JOIN public.strategic_evidence_items e ON e.id = b.evidence_item_id AND e.user_id = b.user_id
  WHERE b.user_id = v_user_id AND b.scenario_id = p_scenario_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'variable_name', t.variable_name,
    'variable_unit', t.variable_unit,
    'low_value', t.low_value,
    'base_value', t.base_value,
    'high_value', t.high_value,
    'outcome_metric', t.outcome_metric,
    'outcome_unit', t.outcome_unit,
    'low_outcome', t.low_outcome,
    'base_outcome', t.base_outcome,
    'high_outcome', t.high_outcome,
    'evidence_basis', t.evidence_basis,
    'evidence_item_id', t.evidence_item_id,
    'notes', t.notes
  ) ORDER BY t.created_at ASC), '[]'::jsonb)
  INTO v_sensitivities
  FROM public.strategic_sensitivity_tests t
  WHERE t.user_id = v_user_id AND t.scenario_id = p_scenario_id;

  SELECT jsonb_build_object(
    'branch_count', count(*)::integer,
    'assessed_branch_count', count(*) FILTER (WHERE decision_effect <> 'unknown')::integer,
    'known_likelihood_count', count(*) FILTER (WHERE likelihood_pct IS NOT NULL)::integer,
    'unknown_likelihood_count', count(*) FILTER (WHERE likelihood_pct IS NULL)::integer,
    'holds_count', count(*) FILTER (WHERE decision_effect = 'holds')::integer,
    'changes_count', count(*) FILTER (WHERE decision_effect = 'changes')::integer,
    'unknown_effect_count', count(*) FILTER (WHERE decision_effect = 'unknown')::integer,
    'max_stress_score', max(stress_score),
    'sensitivity_count', (SELECT count(*)::integer FROM public.strategic_sensitivity_tests t WHERE t.user_id = v_user_id AND t.scenario_id = p_scenario_id)
  ) INTO v_summary
  FROM public.strategic_scenario_branches b
  WHERE b.user_id = v_user_id AND b.scenario_id = p_scenario_id;

  v_context := v_context || jsonb_build_object(
    'phase9', jsonb_build_object(
      'mode', 'recommendation_only',
      'scenario', v_scenario,
      'branches', v_branches,
      'sensitivities', v_sensitivities,
      'deterministic_summary', v_summary,
      'warning', 'Scenario likelihoods are assumptions or descriptive frequencies, never guaranteed future probabilities.'
    )
  );
  v_fingerprint := md5(v_context::text);

  INSERT INTO public.strategic_context_snapshots (
    user_id, app_id, purpose, focus_type, focus_id, context_version, context_fingerprint, context
  ) VALUES (
    v_user_id, p_app_id, 'scenario_planning', 'scenario', p_scenario_id,
    'phase9-scenario-v1', v_fingerprint, v_context
  ) RETURNING id INTO v_snapshot_id;

  INSERT INTO public.strategic_action_log (user_id, app_id, event_type, details)
  VALUES (v_user_id, p_app_id, 'scenario_planning_context_created', jsonb_build_object(
    'snapshot_id', v_snapshot_id, 'scenario_id', p_scenario_id, 'fingerprint', v_fingerprint
  ));

  RETURN jsonb_build_object('snapshot_id', v_snapshot_id, 'context_fingerprint', v_fingerprint, 'context', v_context);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_scenario_planning_context_snapshot(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_scenario_planning_context_snapshot(uuid,uuid) TO authenticated, service_role;

-- Service-role-only atomic recording of a ranking run. Deterministic rank fields
-- are copied from the immutable snapshot, never accepted from the model.
CREATE OR REPLACE FUNCTION public.record_strategic_market_ranking_run(
  p_user_id uuid,
  p_app_id uuid,
  p_objective_id uuid,
  p_snapshot_id uuid,
  p_summary text,
  p_annotations jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot public.strategic_context_snapshots%ROWTYPE;
  v_basis jsonb;
  v_item jsonb;
  v_basis_item jsonb;
  v_run_id uuid;
  v_top uuid;
  v_market_count integer;
  v_ranked_count integer;
  v_insufficient integer;
  v_excluded integer;
  v_market_id uuid;
BEGIN
  SELECT * INTO v_snapshot FROM public.strategic_context_snapshots
  WHERE id = p_snapshot_id AND user_id = p_user_id AND app_id = p_app_id AND purpose = 'market_ranking';
  IF NOT FOUND THEN RAISE EXCEPTION 'Market-ranking snapshot is invalid'; END IF;
  IF p_objective_id IS DISTINCT FROM NULLIF(v_snapshot.context #>> '{phase9,objective_id}', '')::uuid THEN
    RAISE EXCEPTION 'Market-ranking objective does not match snapshot';
  END IF;

  v_basis := COALESCE(v_snapshot.context #> '{phase9,market_ranking_basis}', '[]'::jsonb);
  v_market_count := jsonb_array_length(v_basis);
  SELECT count(*) FILTER (WHERE item->>'rank_state' = 'ranked'),
         count(*) FILTER (WHERE item->>'rank_state' = 'insufficient_evidence'),
         count(*) FILTER (WHERE item->>'rank_state' = 'excluded')
    INTO v_ranked_count, v_insufficient, v_excluded
  FROM jsonb_array_elements(v_basis) AS x(item);
  SELECT (item->>'market_option_id')::uuid INTO v_top
  FROM jsonb_array_elements(v_basis) AS x(item)
  WHERE item->>'rank_state' = 'ranked'
  ORDER BY (item->>'deterministic_rank')::integer ASC
  LIMIT 1;

  INSERT INTO public.strategic_market_ranking_runs (
    user_id, app_id, objective_id, context_snapshot_id, top_market_option_id,
    summary, market_count, ranked_count, insufficient_evidence_count, excluded_count
  ) VALUES (
    p_user_id, p_app_id, p_objective_id, p_snapshot_id, v_top,
    NULLIF(btrim(COALESCE(p_summary,'')),''), v_market_count, v_ranked_count, v_insufficient, v_excluded
  ) RETURNING id INTO v_run_id;

  FOR v_basis_item IN SELECT item FROM jsonb_array_elements(v_basis) AS x(item) LOOP
    v_market_id := (v_basis_item->>'market_option_id')::uuid;
    SELECT item INTO v_item
    FROM jsonb_array_elements(COALESCE(p_annotations,'[]'::jsonb)) AS a(item)
    WHERE item->>'market_option_id' = v_market_id::text
    LIMIT 1;

    INSERT INTO public.strategic_market_ranking_items (
      run_id, user_id, market_option_id, rank_state, deterministic_rank,
      decision_readiness_score, attractiveness_score, evidence_coverage, evidence_confidence,
      recommendation, rationale, confidence, evidence_refs, memory_refs, question_refs, unknown_refs,
      next_information_needed
    ) VALUES (
      v_run_id, p_user_id, v_market_id, v_basis_item->>'rank_state',
      NULLIF(v_basis_item->>'deterministic_rank','')::integer,
      NULLIF(v_basis_item->>'decision_readiness_score','')::numeric,
      NULLIF(v_basis_item->>'attractiveness_score','')::numeric,
      COALESCE(NULLIF(v_basis_item->>'evidence_coverage','')::integer,0),
      NULLIF(v_basis_item->>'evidence_confidence','')::integer,
      CASE WHEN v_item->>'recommendation' = ANY (ARRAY['test','research','wait','deprioritize']) THEN v_item->>'recommendation' ELSE NULL END,
      NULLIF(btrim(COALESCE(v_item->>'rationale','')),''),
      NULLIF(v_item->>'confidence','')::integer,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'evidence_refs','[]'::jsonb))::uuid), ARRAY[]::uuid[]),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'memory_refs','[]'::jsonb))::uuid), ARRAY[]::uuid[]),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'question_refs','[]'::jsonb))::uuid), ARRAY[]::uuid[]),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'unknown_refs','[]'::jsonb))::uuid), ARRAY[]::uuid[]),
      NULLIF(btrim(COALESCE(v_item->>'next_information_needed','')),'')
    );
  END LOOP;

  INSERT INTO public.strategic_action_log (user_id, app_id, event_type, details)
  VALUES (p_user_id, p_app_id, 'market_ranking_completed', jsonb_build_object(
    'run_id', v_run_id, 'snapshot_id', p_snapshot_id, 'top_market_option_id', v_top
  ));
  RETURN v_run_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_strategic_market_ranking_run(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_strategic_market_ranking_run(uuid,uuid,uuid,uuid,text,jsonb) TO service_role;

-- Service-role-only atomic scenario assessment recording. Summary metrics come
-- from the immutable snapshot, never from model-generated numbers.
CREATE OR REPLACE FUNCTION public.record_strategic_scenario_assessment_run(
  p_user_id uuid,
  p_app_id uuid,
  p_scenario_id uuid,
  p_snapshot_id uuid,
  p_recommendation text,
  p_confidence integer,
  p_rationale text,
  p_branch_refs uuid[],
  p_evidence_refs uuid[],
  p_memory_refs uuid[],
  p_question_refs uuid[],
  p_unknown_refs uuid[],
  p_next_information_needed text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot public.strategic_context_snapshots%ROWTYPE;
  v_summary jsonb;
  v_run_id uuid;
BEGIN
  SELECT * INTO v_snapshot FROM public.strategic_context_snapshots
  WHERE id = p_snapshot_id AND user_id = p_user_id AND app_id = p_app_id
    AND purpose = 'scenario_planning' AND focus_type = 'scenario' AND focus_id = p_scenario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scenario-planning snapshot is invalid'; END IF;
  IF p_recommendation <> ALL (ARRAY['holds','changes','needs_more_evidence']::text[]) THEN
    RAISE EXCEPTION 'Unsupported scenario recommendation';
  END IF;
  IF p_confidence NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Scenario confidence out of range'; END IF;
  v_summary := COALESCE(v_snapshot.context #> '{phase9,deterministic_summary}', '{}'::jsonb);

  INSERT INTO public.strategic_scenario_assessment_runs (
    user_id, app_id, scenario_id, context_snapshot_id, recommendation, confidence, rationale,
    branch_count, assessed_branch_count, known_likelihood_count, unknown_likelihood_count,
    holds_count, changes_count, unknown_effect_count, max_stress_score, sensitivity_count,
    branch_refs, evidence_refs, memory_refs, question_refs, unknown_refs, next_information_needed
  ) VALUES (
    p_user_id, p_app_id, p_scenario_id, p_snapshot_id, p_recommendation, p_confidence,
    NULLIF(btrim(COALESCE(p_rationale,'')),''),
    COALESCE((v_summary->>'branch_count')::integer,0),
    COALESCE((v_summary->>'assessed_branch_count')::integer,0),
    COALESCE((v_summary->>'known_likelihood_count')::integer,0),
    COALESCE((v_summary->>'unknown_likelihood_count')::integer,0),
    COALESCE((v_summary->>'holds_count')::integer,0),
    COALESCE((v_summary->>'changes_count')::integer,0),
    COALESCE((v_summary->>'unknown_effect_count')::integer,0),
    NULLIF(v_summary->>'max_stress_score','')::numeric,
    COALESCE((v_summary->>'sensitivity_count')::integer,0),
    COALESCE(p_branch_refs, ARRAY[]::uuid[]), COALESCE(p_evidence_refs, ARRAY[]::uuid[]),
    COALESCE(p_memory_refs, ARRAY[]::uuid[]), COALESCE(p_question_refs, ARRAY[]::uuid[]),
    COALESCE(p_unknown_refs, ARRAY[]::uuid[]), NULLIF(btrim(COALESCE(p_next_information_needed,'')),'')
  ) RETURNING id INTO v_run_id;

  INSERT INTO public.strategic_action_log (user_id, app_id, event_type, details)
  VALUES (p_user_id, p_app_id, 'scenario_assessment_completed', jsonb_build_object(
    'run_id', v_run_id, 'snapshot_id', p_snapshot_id, 'scenario_id', p_scenario_id,
    'recommendation', p_recommendation
  ));
  RETURN v_run_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_strategic_scenario_assessment_run(uuid,uuid,uuid,uuid,text,integer,text,uuid[],uuid[],uuid[],uuid[],uuid[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_strategic_scenario_assessment_run(uuid,uuid,uuid,uuid,text,integer,text,uuid[],uuid[],uuid[],uuid[],uuid[],text) TO service_role;

COMMENT ON TABLE public.strategic_market_ranking_runs IS
  'Immutable recommendation-only market-ranking runs tied to an immutable controlled context snapshot.';
COMMENT ON TABLE public.strategic_market_ranking_items IS
  'Deterministic market rank fields copied from the snapshot; AI annotations cannot change rank or market scores.';
COMMENT ON TABLE public.strategic_scenario_assessment_runs IS
  'Immutable recommendation-only scenario assessments; deterministic branch metrics are snapshot-derived and do not alter the scenario.';
