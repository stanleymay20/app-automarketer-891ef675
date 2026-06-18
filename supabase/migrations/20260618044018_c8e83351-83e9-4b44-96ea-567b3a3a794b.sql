
-- Remove client read access to OAuth token columns; keep safe view + write paths
REVOKE SELECT (access_token, refresh_token, token_type) ON public.platform_connections FROM authenticated;
REVOKE SELECT (access_token, refresh_token, token_type) ON public.platform_connections FROM anon;

-- Tighten autopilot_runs SELECT so NULL user_id (system rows) are never exposed
DROP POLICY IF EXISTS "Users view their own autopilot runs" ON public.autopilot_runs;
CREATE POLICY "Users view their own autopilot runs"
  ON public.autopilot_runs
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());
