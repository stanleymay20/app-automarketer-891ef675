-- ScrollMarketer Phase 8: Controlled Decision Context Assembly
-- Recommendation-only first slice. Context is assembled deterministically from
-- authoritative graph records, validated evidence, unresolved uncertainty,
-- explicitly approved strategic memory, and governance constraints.
-- No autonomous side effect is authorized by this layer.

CREATE TABLE IF NOT EXISTS public.strategic_context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  purpose text NOT NULL
    CHECK (purpose = ANY (ARRAY[
      'strategy_recommendation','market_ranking','scenario_planning'
    ])),
  focus_type text,
  focus_id uuid,
  context_version text NOT NULL DEFAULT 'phase8-v1',
  context_fingerprint text NOT NULL,
  context jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (focus_type IS NULL AND focus_id IS NULL)
    OR (
      focus_type = ANY (ARRAY[
        'app','objective','decision','market_option','scenario','campaign',
        'persona','prospect','distribution_target','learning','evidence','entity'
      ])
      AND focus_id IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS strategic_context_snapshots_user_app_idx
  ON public.strategic_context_snapshots (user_id, app_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_context_snapshots_fingerprint_idx
  ON public.strategic_context_snapshots (context_fingerprint, created_at DESC);

GRANT SELECT ON public.strategic_context_snapshots TO authenticated;
GRANT ALL ON public.strategic_context_snapshots TO service_role;
ALTER TABLE public.strategic_context_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own strategic context snapshots" ON public.strategic_context_snapshots;
CREATE POLICY "Users select own strategic context snapshots"
  ON public.strategic_context_snapshots
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER TABLE public.growth_recommendations
  ADD COLUMN IF NOT EXISTS context_snapshot_id uuid
    REFERENCES public.strategic_context_snapshots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS growth_recommendations_context_snapshot_idx
  ON public.growth_recommendations (context_snapshot_id)
  WHERE context_snapshot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assemble_strategic_decision_context(
  p_app_id uuid,
  p_purpose text,
  p_focus_type text DEFAULT NULL,
  p_focus_id uuid DEFAULT NULL,
  p_node_limit integer DEFAULT 40,
  p_evidence_limit integer DEFAULT 20,
  p_question_limit integer DEFAULT 10,
  p_memory_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := (select auth.uid());
  v_focus_type text := COALESCE(p_focus_type, 'app');
  v_focus_id uuid := COALESCE(p_focus_id, p_app_id);
  v_focus_app uuid;
  v_offering jsonb := '{}'::jsonb;
  v_objectives jsonb := '[]'::jsonb;
  v_graph_relationships jsonb := '[]'::jsonb;
  v_graph_nodes jsonb := '[]'::jsonb;
  v_verified_evidence jsonb := '[]'::jsonb;
  v_epistemic_context jsonb := '[]'::jsonb;
  v_open_questions jsonb := '[]'::jsonb;
  v_unknown_evidence jsonb := '[]'::jsonb;
  v_approved_memories jsonb := '[]'::jsonb;
  v_governance_policies jsonb := '[]'::jsonb;
  v_focus_governance jsonb := '{}'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_context jsonb;
  v_fingerprint text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_purpose IS NULL OR p_purpose <> ALL (ARRAY[
    'strategy_recommendation','market_ranking','scenario_planning'
  ]::text[]) THEN
    RAISE EXCEPTION 'Phase 8 context purpose is not supported: %', p_purpose;
  END IF;

  IF p_node_limit NOT BETWEEN 1 AND 100
     OR p_evidence_limit NOT BETWEEN 1 AND 100
     OR p_question_limit NOT BETWEEN 1 AND 50
     OR p_memory_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Context limits are outside the allowed bounds';
  END IF;

  SELECT jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'description', a.description,
    'offering_type', a.offering_type,
    'primary_goal', a.primary_goal,
    'target_audience', a.target_audience,
    'website_url', a.website_url,
    'brand_tone', a.brand_tone
  )
  INTO v_offering
  FROM public.apps a
  WHERE a.id = p_app_id AND a.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Context app does not exist or is not owned by the current user';
  END IF;

  v_focus_app := public.commercial_graph_node_app(v_user_id, v_focus_type, v_focus_id);
  IF v_focus_app IS DISTINCT FROM p_app_id THEN
    RAISE EXCEPTION 'Phase 8 focus node must belong to the selected app';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'objective_name', q.objective_name,
    'goal_type', q.goal_type,
    'status', q.status,
    'target_market', q.target_market,
    'target_segment', q.target_segment,
    'strategic_rationale', q.strategic_rationale,
    'evidence_threshold', q.evidence_threshold,
    'commitment_class', q.commitment_class,
    'risk_tolerance', q.risk_tolerance,
    'constraints', q.constraints,
    'assumptions', q.assumptions,
    'current_value', q.current_value,
    'target_value', q.target_value,
    'end_date', q.end_date
  ) ORDER BY q.created_at DESC), '[]'::jsonb)
  INTO v_objectives
  FROM (
    SELECT *
    FROM public.growth_goals
    WHERE user_id = v_user_id AND app_id = p_app_id
    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 8
  ) q;

  WITH rels AS (
    SELECT *
    FROM public.commercial_graph_relationships r
    WHERE r.user_id = v_user_id
      AND r.status = 'active'
      AND (r.app_id = p_app_id OR r.edge_scope = 'portfolio')
      AND (
        (r.source_type = v_focus_type AND r.source_id = v_focus_id)
        OR (r.target_type = v_focus_type AND r.target_id = v_focus_id)
      )
    ORDER BY r.created_at DESC
    LIMIT p_node_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'relation_id', r.relation_id,
    'source_type', r.source_type,
    'source_id', r.source_id,
    'relation_type', r.relation_type,
    'target_type', r.target_type,
    'target_id', r.target_id,
    'basis', r.basis,
    'confidence', r.confidence,
    'evidence_item_id', r.evidence_item_id,
    'edge_scope', r.edge_scope
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_graph_relationships
  FROM rels r;

  WITH rels AS (
    SELECT *
    FROM public.commercial_graph_relationships r
    WHERE r.user_id = v_user_id
      AND r.status = 'active'
      AND (r.app_id = p_app_id OR r.edge_scope = 'portfolio')
      AND (
        (r.source_type = v_focus_type AND r.source_id = v_focus_id)
        OR (r.target_type = v_focus_type AND r.target_id = v_focus_id)
      )
    ORDER BY r.created_at DESC
    LIMIT p_node_limit
  ), node_keys AS (
    SELECT v_focus_type AS node_type, v_focus_id AS node_id
    UNION
    SELECT source_type, source_id FROM rels
    UNION
    SELECT target_type, target_id FROM rels
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'node_type', n.node_type,
    'node_id', n.node_id,
    'label', n.label,
    'state', n.state,
    'metadata', n.metadata,
    'app_id', n.app_id
  ) ORDER BY n.created_at DESC), '[]'::jsonb)
  INTO v_graph_nodes
  FROM public.commercial_graph_nodes n
  JOIN node_keys k ON k.node_type = n.node_type AND k.node_id = n.node_id
  WHERE n.user_id = v_user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'claim', e.claim,
    'source_type', e.source_type,
    'source_reference', e.source_reference,
    'confidence', e.confidence,
    'evidence_strength', e.evidence_strength,
    'decision_relevance', e.decision_relevance,
    'impact_if_wrong', e.impact_if_wrong,
    'verification_method', e.verification_method,
    'observed_at', e.observed_at,
    'goal_id', e.goal_id,
    'decision_id', e.decision_id
  ) ORDER BY e.decision_relevance DESC, e.evidence_strength DESC NULLS LAST, e.created_at DESC), '[]'::jsonb)
  INTO v_verified_evidence
  FROM (
    SELECT *
    FROM public.strategic_evidence_items
    WHERE user_id = v_user_id
      AND app_id = p_app_id
      AND item_type = 'observation'
      AND status = 'validated'
    ORDER BY decision_relevance DESC, evidence_strength DESC NULLS LAST, created_at DESC
    LIMIT p_evidence_limit
  ) e;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'item_type', e.item_type,
    'claim', e.claim,
    'status', e.status,
    'confidence', e.confidence,
    'source_type', e.source_type,
    'decision_relevance', e.decision_relevance,
    'impact_if_wrong', e.impact_if_wrong
  ) ORDER BY e.decision_relevance DESC, e.created_at DESC), '[]'::jsonb)
  INTO v_epistemic_context
  FROM (
    SELECT *
    FROM public.strategic_evidence_items
    WHERE user_id = v_user_id
      AND app_id = p_app_id
      AND item_type IN ('inference','assumption')
      AND status IN ('active','validated')
    ORDER BY decision_relevance DESC, created_at DESC
    LIMIT LEAST(p_evidence_limit, 20)
  ) e;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'question', q.question,
    'current_confidence', q.current_confidence,
    'decision_impact', q.decision_impact,
    'answerability', q.answerability,
    'urgency', q.urgency,
    'effort', q.effort,
    'information_value_score', q.information_value_score,
    'goal_id', q.goal_id,
    'decision_id', q.decision_id
  ) ORDER BY q.information_value_score DESC, q.urgency DESC, q.created_at DESC), '[]'::jsonb)
  INTO v_open_questions
  FROM (
    SELECT *
    FROM public.strategic_questions
    WHERE user_id = v_user_id AND app_id = p_app_id AND status = 'open'
    ORDER BY information_value_score DESC, urgency DESC, created_at DESC
    LIMIT p_question_limit
  ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'claim', e.claim,
    'confidence', e.confidence,
    'decision_relevance', e.decision_relevance,
    'impact_if_wrong', e.impact_if_wrong,
    'goal_id', e.goal_id,
    'decision_id', e.decision_id
  ) ORDER BY e.decision_relevance DESC, e.impact_if_wrong DESC, e.created_at DESC), '[]'::jsonb)
  INTO v_unknown_evidence
  FROM (
    SELECT *
    FROM public.strategic_evidence_items
    WHERE user_id = v_user_id
      AND app_id = p_app_id
      AND item_type = 'unknown'
      AND status = 'active'
    ORDER BY decision_relevance DESC, impact_if_wrong DESC, created_at DESC
    LIMIT p_question_limit
  ) e;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'review_id', m.review_id,
    'learning_event_id', m.learning_event_id,
    'reuse_scope', m.reuse_scope,
    'source_app_id', m.source_app_id,
    'target_app_id', m.target_app_id,
    'rationale', m.rationale,
    'lesson', m.lesson,
    'action_summary', m.action_summary,
    'outcome_summary', m.outcome_summary,
    'outcome_direction', m.outcome_direction,
    'mechanism_hypothesis', m.mechanism_hypothesis,
    'causal_status', m.causal_status,
    'confidence', m.confidence,
    'transferability_status', m.transferability_status,
    'transferability_scope', m.transferability_scope,
    'reviewed_at', m.reviewed_at,
    'expires_at', m.expires_at
  ) ORDER BY m.reviewed_at DESC NULLS LAST, m.learning_created_at DESC), '[]'::jsonb)
  INTO v_approved_memories
  FROM (
    SELECT *
    FROM public.approved_strategic_memory_reuse m
    WHERE m.user_id = v_user_id
      AND p_purpose = ANY (m.allowed_purposes)
      AND (
        (m.reuse_scope = 'source_app' AND m.source_app_id = p_app_id)
        OR (m.reuse_scope = 'target_app' AND m.target_app_id = p_app_id)
        OR (m.reuse_scope = 'portfolio')
      )
    ORDER BY m.reviewed_at DESC NULLS LAST, m.learning_created_at DESC
    LIMIT p_memory_limit
  ) m;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'policy_name', p.policy_name,
    'scope', CASE WHEN p.app_id IS NULL THEN 'portfolio' ELSE 'app' END,
    'decision_types', p.decision_types,
    'authority_mode', p.authority_mode,
    'min_confidence', p.min_confidence,
    'max_commitment_amount', p.max_commitment_amount,
    'currency', p.currency,
    'allowed_reversibility', p.allowed_reversibility,
    'human_approval_required', p.human_approval_required,
    'legal_review_required', p.legal_review_required,
    'brand_review_required', p.brand_review_required,
    'executive_approval_required', p.executive_approval_required,
    'priority', p.priority,
    'notes', p.notes
  ) ORDER BY p.priority DESC, p.created_at DESC), '[]'::jsonb)
  INTO v_governance_policies
  FROM public.strategic_governance_policies p
  WHERE p.user_id = v_user_id
    AND p.enabled = true
    AND (p.app_id = p_app_id OR p.app_id IS NULL);

  IF v_focus_type = 'decision' THEN
    SELECT jsonb_build_object(
      'active_stop_rules', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', s.id,
          'rule_name', s.rule_name,
          'rule_type', s.rule_type,
          'threshold_numeric', s.threshold_numeric,
          'threshold_at', s.threshold_at,
          'currency', s.currency,
          'action', s.action,
          'status', s.status,
          'triggered_reason', s.triggered_reason
        ) ORDER BY s.created_at ASC)
        FROM public.strategic_stop_rules s
        WHERE s.user_id = v_user_id
          AND s.decision_id = v_focus_id
          AND s.status <> 'disabled'
      ), '[]'::jsonb),
      'approval_requests', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id,
          'approval_type', a.approval_type,
          'status', a.status,
          'reason', a.reason,
          'reviewed_at', a.reviewed_at
        ) ORDER BY a.created_at DESC)
        FROM public.strategic_approval_requests a
        WHERE a.user_id = v_user_id AND a.decision_id = v_focus_id
      ), '[]'::jsonb)
    ) INTO v_focus_governance;
  ELSE
    v_focus_governance := jsonb_build_object(
      'active_stop_rules', '[]'::jsonb,
      'approval_requests', '[]'::jsonb
    );
  END IF;

  IF jsonb_array_length(v_verified_evidence) = 0 THEN
    v_warnings := v_warnings || jsonb_build_array('No validated observation evidence is available for this app context.');
  END IF;
  IF jsonb_array_length(v_open_questions) > 0 OR jsonb_array_length(v_unknown_evidence) > 0 THEN
    v_warnings := v_warnings || jsonb_build_array('Unresolved uncertainty is present; recommendations must surface it rather than imply certainty.');
  END IF;
  IF jsonb_array_length(v_approved_memories) = 0 THEN
    v_warnings := v_warnings || jsonb_build_array('No strategic memory is currently approved for this purpose and app scope.');
  END IF;

  v_context := jsonb_build_object(
    'context_version', 'phase8-v1',
    'purpose', p_purpose,
    'app_id', p_app_id,
    'focus', jsonb_build_object('node_type', v_focus_type, 'node_id', v_focus_id),
    'offering', v_offering,
    'objectives', v_objectives,
    'graph_neighborhood', jsonb_build_object(
      'nodes', v_graph_nodes,
      'relationships', v_graph_relationships
    ),
    'verified_observations', v_verified_evidence,
    'epistemic_context', v_epistemic_context,
    'unresolved_uncertainty', jsonb_build_object(
      'questions', v_open_questions,
      'unknown_evidence', v_unknown_evidence
    ),
    'approved_strategic_memories', v_approved_memories,
    'governance', jsonb_build_object(
      'enabled_policies', v_governance_policies,
      'focus_decision_controls', v_focus_governance
    ),
    'warnings', v_warnings,
    'counts', jsonb_build_object(
      'graph_nodes', jsonb_array_length(v_graph_nodes),
      'graph_relationships', jsonb_array_length(v_graph_relationships),
      'validated_observations', jsonb_array_length(v_verified_evidence),
      'assumptions_or_inferences', jsonb_array_length(v_epistemic_context),
      'open_questions', jsonb_array_length(v_open_questions),
      'unknown_evidence', jsonb_array_length(v_unknown_evidence),
      'approved_memories', jsonb_array_length(v_approved_memories),
      'enabled_governance_policies', jsonb_array_length(v_governance_policies)
    )
  );

  v_fingerprint := md5(v_context::text);

  RETURN v_context || jsonb_build_object(
    'context_fingerprint', v_fingerprint,
    'assembled_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assemble_strategic_decision_context(uuid,text,text,uuid,integer,integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assemble_strategic_decision_context(uuid,text,text,uuid,integer,integer,integer,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_strategic_context_snapshot(
  p_app_id uuid,
  p_purpose text,
  p_focus_type text DEFAULT NULL,
  p_focus_id uuid DEFAULT NULL,
  p_node_limit integer DEFAULT 40,
  p_evidence_limit integer DEFAULT 20,
  p_question_limit integer DEFAULT 10,
  p_memory_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := (select auth.uid());
  v_context jsonb;
  v_snapshot_id uuid;
  v_fingerprint text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.apps WHERE id = p_app_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Context app does not exist or is not owned by the current user';
  END IF;

  v_context := public.assemble_strategic_decision_context(
    p_app_id,
    p_purpose,
    p_focus_type,
    p_focus_id,
    p_node_limit,
    p_evidence_limit,
    p_question_limit,
    p_memory_limit
  );

  v_fingerprint := v_context->>'context_fingerprint';
  IF v_fingerprint IS NULL OR v_fingerprint = '' THEN
    RAISE EXCEPTION 'Could not fingerprint assembled strategic context';
  END IF;

  INSERT INTO public.strategic_context_snapshots (
    user_id,
    app_id,
    purpose,
    focus_type,
    focus_id,
    context_version,
    context_fingerprint,
    context
  ) VALUES (
    v_user_id,
    p_app_id,
    p_purpose,
    COALESCE(p_focus_type, 'app'),
    COALESCE(p_focus_id, p_app_id),
    COALESCE(v_context->>'context_version', 'phase8-v1'),
    v_fingerprint,
    v_context
  )
  RETURNING id INTO v_snapshot_id;

  INSERT INTO public.strategic_action_log (
    user_id,
    app_id,
    event_type,
    previous_state,
    next_state,
    details
  ) VALUES (
    v_user_id,
    p_app_id,
    'decision_context_snapshot_created',
    '{}'::jsonb,
    jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'purpose', p_purpose,
      'context_fingerprint', v_fingerprint
    ),
    jsonb_build_object(
      'focus_type', COALESCE(p_focus_type, 'app'),
      'focus_id', COALESCE(p_focus_id, p_app_id),
      'context_version', COALESCE(v_context->>'context_version', 'phase8-v1')
    )
  );

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'context_fingerprint', v_fingerprint,
    'context', v_context
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_strategic_context_snapshot(uuid,text,text,uuid,integer,integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_strategic_context_snapshot(uuid,text,text,uuid,integer,integer,integer,integer) TO authenticated, service_role;

COMMENT ON TABLE public.strategic_context_snapshots IS
  'Immutable provenance snapshots of deterministic decision context used by recommendation-only Phase 8 workflows.';
COMMENT ON FUNCTION public.assemble_strategic_decision_context(uuid,text,text,uuid,integer,integer,integer,integer) IS
  'Deterministically assembles an app-scoped recommendation context from authoritative graph records, validated observations, explicit assumptions/inferences, unresolved uncertainty, approved strategic memory and governance constraints. It does not authorize execution.';
COMMENT ON FUNCTION public.create_strategic_context_snapshot(uuid,text,text,uuid,integer,integer,integer,integer) IS
  'Creates an auditable immutable snapshot of the deterministic Phase 8 context for a recommendation-only workflow.';
COMMENT ON COLUMN public.growth_recommendations.context_snapshot_id IS
  'Exact Phase 8 strategic-context snapshot used when the recommendation was generated. NULL for legacy recommendations.';
