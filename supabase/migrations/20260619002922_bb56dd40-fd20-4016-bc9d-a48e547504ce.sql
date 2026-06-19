
-- New table for Dawn Autopilot run history
CREATE TABLE public.dawn_autopilot_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  app_id UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','partial','failed')),
  prospects_discovered INT NOT NULL DEFAULT 0,
  prospects_enriched INT NOT NULL DEFAULT 0,
  prospects_qualified INT NOT NULL DEFAULT 0,
  prospects_auto_sent INT NOT NULL DEFAULT 0,
  prospects_sent_to_review INT NOT NULL DEFAULT 0,
  content_generated INT NOT NULL DEFAULT 0,
  content_scheduled INT NOT NULL DEFAULT 0,
  proposals_created INT NOT NULL DEFAULT 0,
  followups_created INT NOT NULL DEFAULT 0,
  revenue_expected NUMERIC(12,2) NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  brief JSONB,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dawn_autopilot_runs TO authenticated;
GRANT ALL ON public.dawn_autopilot_runs TO service_role;

ALTER TABLE public.dawn_autopilot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own dawn runs" ON public.dawn_autopilot_runs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own dawn runs" ON public.dawn_autopilot_runs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own dawn runs" ON public.dawn_autopilot_runs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own dawn runs" ON public.dawn_autopilot_runs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_dawn_runs_user_started ON public.dawn_autopilot_runs(user_id, started_at DESC);

CREATE TRIGGER trg_dawn_runs_updated_at
  BEFORE UPDATE ON public.dawn_autopilot_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add dawn fields to user_settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS dawn_autopilot_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dawn_autopilot_time TEXT NOT NULL DEFAULT '05:00',
  ADD COLUMN IF NOT EXISTS dawn_timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS dawn_max_daily_prospects INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS dawn_max_daily_outreach INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS dawn_max_daily_content INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS dawn_require_review_for_content BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dawn_require_review_for_high_value BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dawn_high_value_threshold NUMERIC(12,2) NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS dawn_last_run_at TIMESTAMPTZ;
