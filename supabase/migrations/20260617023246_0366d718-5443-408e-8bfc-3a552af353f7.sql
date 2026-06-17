
-- 1. Token-safe view for platform_connections
CREATE OR REPLACE VIEW public.platform_connections_safe
WITH (security_invoker = true) AS
SELECT
  id, user_id, platform, connected, connected_at,
  account_name, account_id, created_at, updated_at,
  expires_at, scope, app_id
FROM public.platform_connections;

GRANT SELECT ON public.platform_connections_safe TO authenticated;
GRANT ALL  ON public.platform_connections_safe TO service_role;

-- 2. Remove client SELECT on the raw token-bearing table
DROP POLICY IF EXISTS "Users can view their own connections" ON public.platform_connections;

-- Keep INSERT/UPDATE/DELETE policies so the disconnect flow (which nulls tokens) keeps working.
-- service_role bypasses RLS and continues to read tokens for publishing edge functions.
REVOKE SELECT ON public.platform_connections FROM authenticated, anon;
GRANT  SELECT (id, user_id, platform, connected, connected_at, account_name, account_id,
               created_at, updated_at, expires_at, scope, app_id)
  ON public.platform_connections TO authenticated;  -- column-level fallback, no tokens

-- 3. Lock down click_events anon INSERT
DROP POLICY IF EXISTS "Anyone can record click events" ON public.click_events;

CREATE POLICY "Authenticated users insert their own click events"
ON public.click_events
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- service_role (used by track-click edge function) bypasses RLS, so public tracking continues.
