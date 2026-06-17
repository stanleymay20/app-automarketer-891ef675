-- Fix: platform_connections_safe view was missing grants, so the frontend
-- couldn't read connection status even though writes succeeded.
ALTER VIEW public.platform_connections_safe SET (security_invoker = on);

-- Base table needs a SELECT policy so the security-invoker view can read rows.
DROP POLICY IF EXISTS "Users can view their own connections" ON public.platform_connections;
CREATE POLICY "Users can view their own connections"
  ON public.platform_connections
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Grant SELECT on the safe view to authenticated users.
GRANT SELECT ON public.platform_connections_safe TO authenticated;
GRANT ALL ON public.platform_connections_safe TO service_role;
-- Also ensure base-table SELECT GRANT exists (RLS still scopes per-user).
GRANT SELECT ON public.platform_connections TO authenticated;