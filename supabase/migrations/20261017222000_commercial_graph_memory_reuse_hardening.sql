-- ScrollMarketer Phase 7 hardening:
-- 1) generic graph-node resolution must fail reliably for unknown/foreign UUIDs;
-- 2) derived learning/evidence edges must use the correct semantic direction;
-- 3) memory-reuse approvals are freshness-bound and materially immutable;
-- 4) bounded-autonomy reuse rechecks current evidence at use time.

-- ---------------------------------------------------------------------------
-- Reliable graph-node ownership resolution.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_graph_node_app(
  p_user_id uuid,
  p_node_type text,
  p_node_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  resolved_app uuid;
BEGIN
  IF p_node_type = 'app' THEN
    SELECT id INTO resolved_app FROM public.apps WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'objective' THEN
    SELECT app_id INTO resolved_app FROM public.growth_goals WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'decision' THEN
    SELECT app_id INTO resolved_app FROM public.strategic_decisions WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'market_option' THEN
    SELECT app_id INTO resolved_app FROM public.strategic_market_options WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'scenario' THEN
    SELECT app_id INTO resolved_app FROM public.strategic_scenarios WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'campaign' THEN
    SELECT app_id INTO resolved_app FROM public.campaigns WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'persona' THEN
    SELECT app_id INTO resolved_app FROM public.personas WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'prospect' THEN
    SELECT app_id INTO resolved_app FROM public.prospects WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'distribution_target' THEN
    SELECT app_id INTO resolved_app FROM public.distribution_targets WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'learning' THEN
    SELECT app_id INTO resolved_app FROM public.learning_events WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'evidence' THEN
    SELECT app_id INTO resolved_app FROM public.strategic_evidence_items WHERE id = p_node_id AND user_id = p_user_id;
  ELSIF p_node_type = 'entity' THEN
    SELECT app_id INTO resolved_app FROM public.commercial_graph_entities WHERE id = p_node_id AND user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'Unsupported commercial graph node type: %', p_node_type;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commercial graph node does not exist or is not owned by the user';
  END IF;
  RETURN resolved_app;
END;
$$;

-- Correct evidence semantics: a learning is supported/challenged by evidence,
-- not the other way around. All other structural relationships are unchanged.
CREATE OR REPLACE VIEW public.commercial_graph_relationships
WITH (security_invoker = true)
AS
SELECT e.id::text AS relation_id, e.user_id, e.app_id, e.edge_scope,
       e.source_type, e.source_id, e.relation_type, e.target_type, e.target_id,
       e.basis, e.confidence, e.evidence_item_id, e.metadata, e.status, e.created_at
FROM public.commercial_graph_edges e
UNION ALL
SELECT 'structural:app-objective:' || g.id::text, g.user_id, g.app_id, 'app',
       'app', g.app_id, 'targets', 'objective', g.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', g.created_at
FROM public.growth_goals g
UNION ALL
SELECT 'structural:app-market:' || m.id::text, m.user_id, m.app_id, 'app',
       'app', m.app_id, 'targets', 'market_option', m.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', m.created_at
FROM public.strategic_market_options m
UNION ALL
SELECT 'structural:app-campaign:' || c.id::text, c.user_id, c.app_id, 'app',
       'app', c.app_id, 'executes', 'campaign', c.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', c.created_at
FROM public.campaigns c
UNION ALL
SELECT 'structural:app-persona:' || p.id::text, p.user_id, p.app_id, 'app',
       'app', p.app_id, 'serves', 'persona', p.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', p.created_at
FROM public.personas p
UNION ALL
SELECT 'structural:app-prospect:' || p.id::text, p.user_id, p.app_id, 'app',
       'app', p.app_id, 'serves', 'prospect', p.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', p.created_at
FROM public.prospects p WHERE p.app_id IS NOT NULL
UNION ALL
SELECT 'structural:app-distribution:' || t.id::text, t.user_id, t.app_id, 'app',
       'app', t.app_id, 'distributed_through', 'distribution_target', t.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', t.created_at
FROM public.distribution_targets t WHERE t.app_id IS NOT NULL
UNION ALL
SELECT 'structural:objective-decision:' || d.id::text, d.user_id, d.app_id, 'app',
       'objective', d.goal_id, 'informs', 'decision', d.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', d.created_at
FROM public.strategic_decisions d WHERE d.goal_id IS NOT NULL
UNION ALL
SELECT 'structural:market-decision:' || d.id::text, d.user_id, d.app_id, 'app',
       'market_option', d.market_option_id, 'informs', 'decision', d.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', d.created_at
FROM public.strategic_decisions d WHERE d.market_option_id IS NOT NULL
UNION ALL
SELECT 'structural:decision-scenario:' || s.id::text, s.user_id, s.app_id, 'app',
       'decision', s.decision_id, 'tests', 'scenario', s.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', s.created_at
FROM public.strategic_scenarios s WHERE s.decision_id IS NOT NULL
UNION ALL
SELECT 'structural:decision-learning:' || l.id::text, l.user_id, l.app_id, 'app',
       'decision', l.decision_id, 'learned_from', 'learning', l.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', l.created_at
FROM public.learning_events l WHERE l.decision_id IS NOT NULL
UNION ALL
SELECT 'structural:market-learning:' || l.id::text, l.user_id, l.app_id, 'app',
       'market_option', l.market_option_id, 'learned_from', 'learning', l.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', l.created_at
FROM public.learning_events l WHERE l.market_option_id IS NOT NULL
UNION ALL
SELECT 'structural:scenario-learning:' || l.id::text, l.user_id, l.app_id, 'app',
       'scenario', l.scenario_id, 'learned_from', 'learning', l.id,
       'structural', NULL::integer, NULL::uuid, '{}'::jsonb, 'active', l.created_at
FROM public.learning_events l WHERE l.scenario_id IS NOT NULL
UNION ALL
SELECT 'structural:learning-evidence:' || link.id::text, link.user_id, le.app_id, 'app',
       'learning', link.learning_event_id,
       CASE link.relationship WHEN 'supports' THEN 'supported_by' WHEN 'challenges' THEN 'challenged_by' ELSE 'informs' END,
       'evidence', link.evidence_item_id,
       'structural', NULL::integer, link.evidence_item_id,
       jsonb_build_object('evidence_relationship', link.relationship), 'active', link.created_at
FROM public.strategic_learning_evidence_links link
JOIN public.learning_events le ON le.id = link.learning_event_id;

-- ---------------------------------------------------------------------------
-- Memory reuse freshness and immutable approval semantics.
-- ---------------------------------------------------------------------------
ALTER TABLE public.strategic_memory_reuse_reviews
  ADD COLUMN IF NOT EXISTS learning_fingerprint text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS strategic_memory_reuse_open_scope_uidx
  ON public.strategic_memory_reuse_reviews (
    learning_event_id,
    reuse_scope,
    COALESCE(target_app_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status IN ('pending','approved');

CREATE OR REPLACE FUNCTION public.strategic_learning_reuse_fingerprint(p_learning_event_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT md5(concat_ws('|',
    l.id::text,
    COALESCE(l.app_id::text, ''),
    l.learning_kind,
    l.lesson,
    COALESCE(l.action_summary, ''),
    l.context::text,
    COALESCE(l.outcome_summary, ''),
    l.outcome_direction,
    COALESCE(l.mechanism_hypothesis, ''),
    l.causal_status,
    COALESCE(l.confidence::text, ''),
    l.transferability_status,
    COALESCE(l.transferability_scope, ''),
    l.transferability_conditions::text,
    l.source_snapshot::text,
    l.status,
    COALESCE(l.supersedes_learning_event_id::text, '')
  ))
  FROM public.learning_events l
  WHERE l.id = p_learning_event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.strategic_learning_reuse_fingerprint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.strategic_learning_reuse_fingerprint(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_strategic_memory_reuse_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  source_app uuid;
  learning_kind_value text;
  learning_status_value text;
  causal_status_value text;
  transferability_value text;
  current_fingerprint text;
BEGIN
  SELECT app_id, learning_kind, status, causal_status, transferability_status
    INTO source_app, learning_kind_value, learning_status_value, causal_status_value, transferability_value
  FROM public.learning_events
  WHERE id = NEW.learning_event_id AND user_id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Memory reuse review requires an owned learning event';
  END IF;
  IF learning_kind_value = 'operational' THEN
    RAISE EXCEPTION 'Reviewed strategic-memory reuse is only for strategic learning events';
  END IF;

  IF NEW.target_app_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.apps WHERE id = NEW.target_app_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Memory reuse target app must belong to the same user';
  END IF;

  IF NEW.reuse_scope = 'source_app' AND source_app IS NULL THEN
    RAISE EXCEPTION 'Source-app memory reuse requires learning with an app context';
  END IF;
  IF NEW.reuse_scope = 'target_app' AND source_app IS NOT NULL AND NEW.target_app_id = source_app THEN
    RAISE EXCEPTION 'Use source_app scope when reusing memory in its original app';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'approved' THEN
      IF NEW.status NOT IN ('approved','revoked') THEN
        RAISE EXCEPTION 'Approved memory reuse may only remain approved or be revoked';
      END IF;
      IF NEW.status = 'approved' AND (
        NEW.learning_event_id IS DISTINCT FROM OLD.learning_event_id OR
        NEW.reuse_scope IS DISTINCT FROM OLD.reuse_scope OR
        NEW.target_app_id IS DISTINCT FROM OLD.target_app_id OR
        NEW.allowed_purposes IS DISTINCT FROM OLD.allowed_purposes OR
        NEW.expires_at IS DISTINCT FROM OLD.expires_at
      ) THEN
        RAISE EXCEPTION 'Approved memory reuse is immutable; revoke it and create a fresh review';
      END IF;
    ELSIF OLD.status IN ('rejected','revoked') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'Closed memory reuse review is immutable; create a fresh review';
    END IF;
  END IF;

  current_fingerprint := public.strategic_learning_reuse_fingerprint(NEW.learning_event_id);
  IF current_fingerprint IS NULL OR current_fingerprint = '' THEN
    RAISE EXCEPTION 'Could not fingerprint strategic learning for reuse review';
  END IF;

  IF NEW.status = 'approved' THEN
    IF learning_status_value <> 'active' THEN
      RAISE EXCEPTION 'Only active strategic learning can be approved for reuse';
    END IF;
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'Approved memory reuse cannot already be expired';
    END IF;

    IF 'bounded_autonomy' = ANY (NEW.allowed_purposes) THEN
      IF causal_status_value <> 'supported' THEN
        RAISE EXCEPTION 'Bounded-autonomy memory reuse requires supported causal status';
      END IF;
      IF NEW.reuse_scope = 'portfolio' THEN
        RAISE EXCEPTION 'Bounded-autonomy memory reuse cannot be approved portfolio-wide';
      END IF;
      IF NEW.reuse_scope = 'target_app' THEN
        IF transferability_value <> 'tested' THEN
          RAISE EXCEPTION 'Cross-app bounded-autonomy reuse requires tested transferability';
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM public.strategic_learning_transfer_tests t
          WHERE t.user_id = NEW.user_id
            AND t.source_learning_event_id = NEW.learning_event_id
            AND t.target_app_id = NEW.target_app_id
            AND t.status = 'completed'
            AND t.result = 'supported'
        ) THEN
          RAISE EXCEPTION 'Cross-app bounded-autonomy reuse requires a completed supporting transfer test for the target app';
        END IF;
      END IF;
    END IF;

    NEW.learning_fingerprint := current_fingerprint;
    IF (select auth.uid()) IS NOT NULL THEN
      NEW.reviewed_by := (select auth.uid());
    END IF;
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
  ELSIF NEW.status IN ('rejected','revoked') THEN
    IF (select auth.uid()) IS NOT NULL THEN
      NEW.reviewed_by := (select auth.uid());
    END IF;
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
  ELSE
    NEW.learning_fingerprint := '';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW public.approved_strategic_memory_reuse
WITH (security_invoker = true)
AS
SELECT r.id AS review_id,
       r.user_id,
       r.learning_event_id,
       l.app_id AS source_app_id,
       r.reuse_scope,
       r.target_app_id,
       r.allowed_purposes,
       r.rationale,
       r.reviewed_by,
       r.reviewed_at,
       r.expires_at,
       r.learning_fingerprint,
       l.lesson,
       l.action_summary,
       l.context,
       l.outcome_summary,
       l.outcome_direction,
       l.mechanism_hypothesis,
       l.causal_status,
       l.confidence,
       l.transferability_status,
       l.transferability_scope,
       l.source_snapshot,
       l.created_at AS learning_created_at
FROM public.strategic_memory_reuse_reviews r
JOIN public.learning_events l ON l.id = r.learning_event_id AND l.user_id = r.user_id
WHERE r.status = 'approved'
  AND l.status = 'active'
  AND r.learning_fingerprint = public.strategic_learning_reuse_fingerprint(l.id)
  AND (r.expires_at IS NULL OR r.expires_at > now());

CREATE OR REPLACE FUNCTION public.strategic_memory_reuse_allowed(
  p_user_id uuid,
  p_learning_event_id uuid,
  p_purpose text,
  p_target_app_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  allowed boolean := false;
  current_support_valid boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.approved_strategic_memory_reuse r
    WHERE r.user_id = p_user_id
      AND r.learning_event_id = p_learning_event_id
      AND p_purpose = ANY (r.allowed_purposes)
      AND (
        (r.reuse_scope = 'source_app' AND r.source_app_id = p_target_app_id)
        OR (r.reuse_scope = 'target_app' AND r.target_app_id = p_target_app_id)
        OR (r.reuse_scope = 'portfolio' AND p_purpose <> 'bounded_autonomy')
      )
  ) INTO allowed;

  IF NOT allowed THEN
    RETURN false;
  END IF;

  IF p_purpose <> 'bounded_autonomy' THEN
    RETURN true;
  END IF;

  -- Recheck current support rather than trusting a stale supported label.
  SELECT EXISTS (
    SELECT 1
    FROM public.learning_events l
    WHERE l.id = p_learning_event_id
      AND l.user_id = p_user_id
      AND l.status = 'active'
      AND l.causal_status = 'supported'
      AND (
        EXISTS (
          SELECT 1
          FROM public.strategic_learning_evidence_links el
          JOIN public.strategic_evidence_items e ON e.id = el.evidence_item_id
          WHERE el.learning_event_id = l.id
            AND el.user_id = p_user_id
            AND el.relationship = 'supports'
            AND e.item_type = 'observation'
            AND e.status = 'validated'
        )
        OR EXISTS (
          SELECT 1
          FROM public.strategic_learning_transfer_tests t
          WHERE t.source_learning_event_id = l.id
            AND t.user_id = p_user_id
            AND t.status = 'completed'
            AND t.result = 'supported'
            AND (t.target_app_id IS NULL OR t.target_app_id = p_target_app_id)
        )
      )
  ) INTO current_support_valid;

  RETURN current_support_valid;
END;
$$;

COMMENT ON COLUMN public.strategic_memory_reuse_reviews.learning_fingerprint IS
  'Fingerprint of the material strategic-learning state at approval time. A changed learning stops appearing in the approved reuse view until re-reviewed.';
