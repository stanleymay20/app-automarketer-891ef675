-- ScrollMarketer Phase 7: reviewed strategic-memory reuse contract.
-- Strategic memory is NOT automatically prompt context. Reuse requires an
-- explicit approved purpose/scope record, and stronger safeguards apply to
-- bounded autonomous decisions.

CREATE TABLE IF NOT EXISTS public.strategic_memory_reuse_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  learning_event_id uuid NOT NULL REFERENCES public.learning_events(id) ON DELETE CASCADE,
  reuse_scope text NOT NULL DEFAULT 'source_app'
    CHECK (reuse_scope = ANY (ARRAY['source_app','target_app','portfolio'])),
  target_app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  allowed_purposes text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','approved','rejected','revoked'])),
  rationale text,
  review_notes text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(allowed_purposes) > 0),
  CHECK (allowed_purposes <@ ARRAY[
    'strategy_recommendation','campaign_generation','content_generation',
    'prospect_qualification','market_ranking','scenario_planning','bounded_autonomy'
  ]::text[]),
  CHECK (
    (reuse_scope = 'target_app' AND target_app_id IS NOT NULL)
    OR (reuse_scope IN ('source_app','portfolio') AND target_app_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS strategic_memory_reuse_user_status_idx
  ON public.strategic_memory_reuse_reviews (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_memory_reuse_learning_idx
  ON public.strategic_memory_reuse_reviews (learning_event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_memory_reuse_target_idx
  ON public.strategic_memory_reuse_reviews (target_app_id, status, created_at DESC)
  WHERE target_app_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_memory_reuse_reviews TO authenticated;
GRANT ALL ON public.strategic_memory_reuse_reviews TO service_role;
ALTER TABLE public.strategic_memory_reuse_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic memory reuse reviews" ON public.strategic_memory_reuse_reviews;
CREATE POLICY "Users manage own strategic memory reuse reviews"
  ON public.strategic_memory_reuse_reviews
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

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

  IF NEW.status = 'approved' THEN
    IF learning_status_value <> 'active' THEN
      RAISE EXCEPTION 'Only active strategic learning can be approved for reuse';
    END IF;
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'Approved memory reuse cannot already be expired';
    END IF;

    -- Bounded autonomy is intentionally stricter than recommendation/generation.
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

    NEW.reviewed_by := COALESCE(NEW.reviewed_by, (select auth.uid()));
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
  ELSIF NEW.status IN ('rejected','revoked') THEN
    NEW.reviewed_by := COALESCE(NEW.reviewed_by, (select auth.uid()));
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
  ELSE
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_memory_reuse_validate ON public.strategic_memory_reuse_reviews;
CREATE TRIGGER strategic_memory_reuse_validate
  BEFORE INSERT OR UPDATE ON public.strategic_memory_reuse_reviews
  FOR EACH ROW EXECUTE FUNCTION public.validate_strategic_memory_reuse_review();

-- Read contract for future agents/generators. This view does not itself inject
-- anything into prompts; it exposes only currently approved, active, unexpired
-- reviewed strategic memory.
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
  AND (r.expires_at IS NULL OR r.expires_at > now());

GRANT SELECT ON public.approved_strategic_memory_reuse TO authenticated, service_role;

-- Deterministic permission query for future execution/generation paths. It
-- returns permission only; callers must still surface causal status/context and
-- obey every other governance/evidence rule.
CREATE OR REPLACE FUNCTION public.strategic_memory_reuse_allowed(
  p_user_id uuid,
  p_learning_event_id uuid,
  p_purpose text,
  p_target_app_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
  );
$$;

REVOKE EXECUTE ON FUNCTION public.strategic_memory_reuse_allowed(uuid,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.strategic_memory_reuse_allowed(uuid,uuid,text,uuid) TO authenticated, service_role;

-- Append reuse-review transitions into the existing strategic audit chain.
CREATE OR REPLACE FUNCTION public.audit_strategic_memory_reuse_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_app uuid;
BEGIN
  SELECT app_id INTO source_app
  FROM public.learning_events
  WHERE id = NEW.learning_event_id AND user_id = NEW.user_id;

  INSERT INTO public.strategic_action_log (
    user_id,
    app_id,
    event_type,
    previous_state,
    next_state,
    details
  ) VALUES (
    NEW.user_id,
    COALESCE(NEW.target_app_id, source_app),
    'memory_reuse_review_changed',
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object(
      'status', OLD.status,
      'scope', OLD.reuse_scope,
      'target_app_id', OLD.target_app_id,
      'allowed_purposes', OLD.allowed_purposes
    ) ELSE '{}'::jsonb END,
    jsonb_build_object(
      'status', NEW.status,
      'scope', NEW.reuse_scope,
      'target_app_id', NEW.target_app_id,
      'allowed_purposes', NEW.allowed_purposes
    ),
    jsonb_build_object(
      'review_id', NEW.id,
      'learning_event_id', NEW.learning_event_id,
      'reviewed_by', NEW.reviewed_by,
      'expires_at', NEW.expires_at
    )
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_strategic_memory_reuse_review() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS strategic_memory_reuse_audit ON public.strategic_memory_reuse_reviews;
CREATE TRIGGER strategic_memory_reuse_audit
  AFTER INSERT OR UPDATE ON public.strategic_memory_reuse_reviews
  FOR EACH ROW EXECUTE FUNCTION public.audit_strategic_memory_reuse_review();

COMMENT ON TABLE public.strategic_memory_reuse_reviews IS
  'Explicit human review contract controlling which strategic memories may be reused, for which purpose and scope. Memory is not automatically prompt context.';
COMMENT ON VIEW public.approved_strategic_memory_reuse IS
  'Only active, approved, unexpired reviewed strategic memory. Reading this view does not bypass governance or prove causation.';
COMMENT ON FUNCTION public.strategic_memory_reuse_allowed(uuid,uuid,text,uuid) IS
  'Deterministic reuse-permission check for future generators/agents. It grants permission only and does not assert truth or causality.';
