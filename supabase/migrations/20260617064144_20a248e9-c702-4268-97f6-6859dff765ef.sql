-- 1) Extend prospect_messages.status to cover the approval-gate states
ALTER TABLE public.prospect_messages DROP CONSTRAINT IF EXISTS prospect_messages_status_chk;
ALTER TABLE public.prospect_messages ADD CONSTRAINT prospect_messages_status_chk
  CHECK (status = ANY (ARRAY[
    'draft'::text, 'pending_approval'::text, 'queued'::text,
    'sent'::text, 'failed'::text, 'bounced'::text
  ]));

-- 2) autopilot_runs — per-tick observability
CREATE TABLE IF NOT EXISTS public.autopilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  users_processed integer NOT NULL DEFAULT 0,
  evaluated integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  review_required integer NOT NULL DEFAULT 0,
  blocked integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.autopilot_runs TO authenticated;
GRANT ALL ON public.autopilot_runs TO service_role;

ALTER TABLE public.autopilot_runs ENABLE ROW LEVEL SECURITY;

-- Per-user runs are visible to that user; global ticks (user_id IS NULL) are admin/service only.
CREATE POLICY "Users view their own autopilot runs"
  ON public.autopilot_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS autopilot_runs_started_idx
  ON public.autopilot_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS autopilot_runs_user_started_idx
  ON public.autopilot_runs (user_id, started_at DESC);