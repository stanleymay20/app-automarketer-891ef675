-- ScrollMarketer Phase 9 epistemic hardening.
-- A raw stored stress_score must not become the assessment-level max when an
-- observed-frequency branch is backed only by an unvalidated observation.
-- The Phase 9 scenario snapshot already stores qualified_stress_score per
-- branch; enforce the persisted aggregate from that qualified field.

CREATE OR REPLACE FUNCTION public.enforce_phase9_qualified_scenario_stress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot public.strategic_context_snapshots%ROWTYPE;
  v_qualified_max numeric;
BEGIN
  SELECT * INTO v_snapshot
  FROM public.strategic_context_snapshots
  WHERE id = NEW.context_snapshot_id
    AND user_id = NEW.user_id
    AND app_id = NEW.app_id
    AND purpose = 'scenario_planning'
    AND focus_type = 'scenario'
    AND focus_id = NEW.scenario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 9 scenario assessment requires a matching scenario-planning snapshot';
  END IF;

  SELECT max(NULLIF(branch->>'qualified_stress_score', '')::numeric)
  INTO v_qualified_max
  FROM jsonb_array_elements(COALESCE(v_snapshot.context #> '{phase9,branches}', '[]'::jsonb)) AS x(branch)
  WHERE branch->>'qualified_stress_score' IS NOT NULL;

  NEW.max_stress_score := v_qualified_max;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_phase9_qualified_scenario_stress() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS phase9_scenario_assessment_qualified_stress
  ON public.strategic_scenario_assessment_runs;
CREATE TRIGGER phase9_scenario_assessment_qualified_stress
  BEFORE INSERT ON public.strategic_scenario_assessment_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_phase9_qualified_scenario_stress();

COMMENT ON FUNCTION public.enforce_phase9_qualified_scenario_stress() IS
  'Recomputes persisted Phase 9 max stress from snapshot branches whose stress is epistemically qualified. Unvalidated observed-frequency evidence cannot inflate the assessment-level max stress.';
