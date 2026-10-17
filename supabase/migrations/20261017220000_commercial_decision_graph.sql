-- ScrollMarketer Phase 7: Commercial Decision Graph / Commercial World Model
-- Native tables remain authoritative. This layer exposes them as graph nodes,
-- derives structural relationships from existing foreign keys, and adds only
-- explicit semantic edges plus durable entities that do not already have a
-- first-class table.

-- ---------------------------------------------------------------------------
-- Durable commercial entities for concepts without a canonical native table.
-- Do not use this table to duplicate apps, objectives, decisions, campaigns,
-- personas, prospects, market options, scenarios, evidence or learnings.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_graph_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  entity_type text NOT NULL
    CHECK (entity_type = ANY (ARRAY[
      'competitor','partner','channel','segment','pricing_offer',
      'customer_need','market','regulator','supplier','custom'
    ])),
  label text NOT NULL,
  description text,
  external_reference text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status = ANY (ARRAY['active','archived'])),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commercial_graph_entities_user_app_idx
  ON public.commercial_graph_entities (user_id, app_id, entity_type, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_graph_entities TO authenticated;
GRANT ALL ON public.commercial_graph_entities TO service_role;
ALTER TABLE public.commercial_graph_entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own commercial graph entities" ON public.commercial_graph_entities;
CREATE POLICY "Users manage own commercial graph entities"
  ON public.commercial_graph_entities
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.validate_commercial_graph_entity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF btrim(NEW.label) = '' THEN
    RAISE EXCEPTION 'Commercial graph entity label cannot be empty';
  END IF;
  IF NEW.app_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.apps WHERE id = NEW.app_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Commercial graph entity app must belong to the same user';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commercial_graph_entities_validate ON public.commercial_graph_entities;
CREATE TRIGGER commercial_graph_entities_validate
  BEFORE INSERT OR UPDATE ON public.commercial_graph_entities
  FOR EACH ROW EXECUTE FUNCTION public.validate_commercial_graph_entity();

-- ---------------------------------------------------------------------------
-- Explicit semantic graph edges. Structural/FK edges are exposed separately
-- through a view below; they are never copied into this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  edge_scope text NOT NULL DEFAULT 'app'
    CHECK (edge_scope = ANY (ARRAY['app','portfolio'])),
  source_type text NOT NULL
    CHECK (source_type = ANY (ARRAY[
      'app','objective','decision','market_option','scenario','campaign',
      'persona','prospect','distribution_target','learning','evidence','entity'
    ])),
  source_id uuid NOT NULL,
  relation_type text NOT NULL
    CHECK (relation_type = ANY (ARRAY[
      'targets','serves','competes_with','distributed_through','partners_with',
      'priced_as','supported_by','challenged_by','informs','executes',
      'produced','learned_from','tests','transfers_to','depends_on',
      'influences','related_to'
    ])),
  target_type text NOT NULL
    CHECK (target_type = ANY (ARRAY[
      'app','objective','decision','market_option','scenario','campaign',
      'persona','prospect','distribution_target','learning','evidence','entity'
    ])),
  target_id uuid NOT NULL,
  basis text NOT NULL DEFAULT 'manual'
    CHECK (basis = ANY (ARRAY['manual','evidence','review'])),
  confidence integer CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  evidence_item_id uuid REFERENCES public.strategic_evidence_items(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status = ANY (ARRAY['active','revoked'])),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (source_type = target_type AND source_id = target_id))
);

CREATE INDEX IF NOT EXISTS commercial_graph_edges_user_app_idx
  ON public.commercial_graph_edges (user_id, app_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS commercial_graph_edges_source_idx
  ON public.commercial_graph_edges (user_id, source_type, source_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS commercial_graph_edges_target_idx
  ON public.commercial_graph_edges (user_id, target_type, target_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_graph_edges TO authenticated;
GRANT ALL ON public.commercial_graph_edges TO service_role;
ALTER TABLE public.commercial_graph_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own commercial graph edges" ON public.commercial_graph_edges;
CREATE POLICY "Users manage own commercial graph edges"
  ON public.commercial_graph_edges
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- Resolve an owned graph node to its canonical app. NULL app is valid for
-- portfolio-level prospects/evidence/learnings/entities, but missing ownership
-- raises instead of silently accepting an opaque UUID.
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
  found_node boolean := false;
BEGIN
  CASE p_node_type
    WHEN 'app' THEN
      SELECT id, true INTO resolved_app, found_node
      FROM public.apps WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'objective' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.growth_goals WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'decision' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.strategic_decisions WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'market_option' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.strategic_market_options WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'scenario' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.strategic_scenarios WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'campaign' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.campaigns WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'persona' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.personas WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'prospect' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.prospects WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'distribution_target' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.distribution_targets WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'learning' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.learning_events WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'evidence' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.strategic_evidence_items WHERE id = p_node_id AND user_id = p_user_id;
    WHEN 'entity' THEN
      SELECT app_id, true INTO resolved_app, found_node
      FROM public.commercial_graph_entities WHERE id = p_node_id AND user_id = p_user_id;
    ELSE
      RAISE EXCEPTION 'Unsupported commercial graph node type: %', p_node_type;
  END CASE;

  IF NOT found_node THEN
    RAISE EXCEPTION 'Commercial graph node does not exist or is not owned by the user';
  END IF;
  RETURN resolved_app;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.commercial_graph_node_app(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_graph_node_app(uuid,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_commercial_graph_edge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  source_app uuid;
  target_app uuid;
  evidence_app uuid;
  canonical_app uuid;
BEGIN
  source_app := public.commercial_graph_node_app(NEW.user_id, NEW.source_type, NEW.source_id);
  target_app := public.commercial_graph_node_app(NEW.user_id, NEW.target_type, NEW.target_id);

  IF NEW.evidence_item_id IS NOT NULL THEN
    SELECT app_id INTO evidence_app
    FROM public.strategic_evidence_items
    WHERE id = NEW.evidence_item_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Commercial graph edge evidence must belong to the same user';
    END IF;
  END IF;

  IF NEW.edge_scope = 'app' THEN
    IF source_app IS NOT NULL AND target_app IS NOT NULL AND source_app <> target_app THEN
      RAISE EXCEPTION 'App-scoped graph edge cannot connect different apps';
    END IF;
    canonical_app := COALESCE(source_app, target_app, NEW.app_id);
    IF canonical_app IS NULL THEN
      RAISE EXCEPTION 'App-scoped graph edge requires an app context';
    END IF;
    IF NEW.app_id IS NOT NULL AND NEW.app_id <> canonical_app THEN
      RAISE EXCEPTION 'Graph edge app does not match linked nodes';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.apps WHERE id = canonical_app AND user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Graph edge app must belong to the same user';
    END IF;
    IF evidence_app IS NOT NULL AND evidence_app <> canonical_app THEN
      RAISE EXCEPTION 'Graph edge evidence must belong to the same app';
    END IF;
    NEW.app_id := canonical_app;
  ELSE
    -- Portfolio scope is explicit. It may connect two owned apps, but is not
    -- silently displayed as belonging to either one.
    NEW.app_id := NULL;
  END IF;

  IF NEW.basis = 'evidence' AND NEW.evidence_item_id IS NULL THEN
    RAISE EXCEPTION 'Evidence-based graph edge requires linked evidence';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commercial_graph_edges_validate ON public.commercial_graph_edges;
CREATE TRIGGER commercial_graph_edges_validate
  BEFORE INSERT OR UPDATE ON public.commercial_graph_edges
  FOR EACH ROW EXECUTE FUNCTION public.validate_commercial_graph_edge();

-- ---------------------------------------------------------------------------
-- Read-only normalized node view over authoritative native tables.
-- SECURITY INVOKER keeps underlying RLS in force.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.commercial_graph_nodes
WITH (security_invoker = true)
AS
SELECT 'app'::text AS node_type, a.id AS node_id, a.user_id, a.id AS app_id,
       a.name AS label, 'active'::text AS state,
       jsonb_build_object('offering_type', a.offering_type, 'primary_goal', a.primary_goal) AS metadata,
       a.created_at
FROM public.apps a
UNION ALL
SELECT 'objective', g.id, g.user_id, g.app_id,
       COALESCE(g.objective_name, initcap(replace(g.goal_type, '_', ' '))), g.status,
       jsonb_build_object('goal_type', g.goal_type, 'target_market', g.target_market, 'target_segment', g.target_segment),
       g.created_at
FROM public.growth_goals g
UNION ALL
SELECT 'decision', d.id, d.user_id, d.app_id, d.title, d.status,
       jsonb_build_object('decision_type', d.decision_type, 'confidence', d.confidence, 'reversibility', d.reversibility),
       d.created_at
FROM public.strategic_decisions d
UNION ALL
SELECT 'market_option', m.id, m.user_id, m.app_id,
       concat(m.market_name, CASE WHEN m.segment_name IS NULL THEN '' ELSE ' · ' || m.segment_name END), m.status,
       jsonb_build_object('entry_mode', m.entry_mode, 'timing_posture', m.timing_posture, 'decision_readiness', m.decision_readiness_score),
       m.created_at
FROM public.strategic_market_options m
UNION ALL
SELECT 'scenario', s.id, s.user_id, s.app_id, s.title, s.status,
       jsonb_build_object('time_horizon', s.time_horizon, 'decision_question', s.decision_question),
       s.created_at
FROM public.strategic_scenarios s
UNION ALL
SELECT 'campaign', c.id, c.user_id, c.app_id, c.campaign_name,
       CASE WHEN c.active THEN 'active' ELSE 'inactive' END,
       jsonb_build_object('goal_id', c.goal_id, 'platform_mix', c.platform_mix), c.created_at
FROM public.campaigns c
UNION ALL
SELECT 'persona', p.id, p.user_id, p.app_id, p.title, 'active',
       jsonb_build_object('company_size', p.company_size, 'channels', p.channels), p.created_at
FROM public.personas p
UNION ALL
SELECT 'prospect', p.id, p.user_id, p.app_id,
       COALESCE(p.company_name, p.contact_name, p.category, 'Prospect'),
       COALESCE(p.pipeline_stage, p.stage, 'unknown'),
       jsonb_build_object('category', p.category, 'company_size', p.company_size), p.created_at
FROM public.prospects p
UNION ALL
SELECT 'distribution_target', t.id, t.user_id, t.app_id, t.name, t.status,
       jsonb_build_object('target_type', t.target_type, 'platform', t.platform, 'audience', t.audience), t.created_at
FROM public.distribution_targets t
UNION ALL
SELECT 'learning', l.id, l.user_id, l.app_id,
       left(l.lesson, 180), l.status,
       jsonb_build_object('learning_kind', l.learning_kind, 'causal_status', l.causal_status, 'transferability_status', l.transferability_status), l.created_at
FROM public.learning_events l
UNION ALL
SELECT 'evidence', e.id, e.user_id, e.app_id,
       left(e.claim, 180), e.status,
       jsonb_build_object('item_type', e.item_type, 'source_type', e.source_type, 'confidence', e.confidence), e.created_at
FROM public.strategic_evidence_items e
UNION ALL
SELECT 'entity', x.id, x.user_id, x.app_id, x.label, x.status,
       jsonb_build_object('entity_type', x.entity_type, 'description', x.description, 'attributes', x.attributes), x.created_at
FROM public.commercial_graph_entities x;

GRANT SELECT ON public.commercial_graph_nodes TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Combined relationship view: explicit semantic edges + authoritative
-- structural relationships derived from native foreign keys.
-- ---------------------------------------------------------------------------
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
SELECT 'structural:evidence-learning:' || link.id::text, link.user_id, le.app_id, 'app',
       'evidence', link.evidence_item_id,
       CASE link.relationship WHEN 'supports' THEN 'supported_by' WHEN 'challenges' THEN 'challenged_by' ELSE 'informs' END,
       'learning', link.learning_event_id,
       'structural', NULL::integer, link.evidence_item_id,
       jsonb_build_object('evidence_relationship', link.relationship), 'active', link.created_at
FROM public.strategic_learning_evidence_links link
JOIN public.learning_events le ON le.id = link.learning_event_id;

GRANT SELECT ON public.commercial_graph_relationships TO authenticated, service_role;

COMMENT ON TABLE public.commercial_graph_entities IS
  'Durable commercial-world entities only where no native first-class table exists. Do not duplicate authoritative native records.';
COMMENT ON TABLE public.commercial_graph_edges IS
  'Explicit semantic relationships supplementing, not replacing, native foreign-key relationships.';
COMMENT ON VIEW public.commercial_graph_nodes IS
  'Security-invoker normalized graph-node view over native authoritative tables plus durable external commercial entities.';
COMMENT ON VIEW public.commercial_graph_relationships IS
  'Security-invoker combined view of explicit semantic edges and structural relationships derived from authoritative native foreign keys.';
