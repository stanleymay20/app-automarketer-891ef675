
-- =========== channel_spend ===========
CREATE TABLE public.channel_spend (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id UUID REFERENCES public.apps(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  channel TEXT NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  campaign_name TEXT,
  spend_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate NUMERIC(12,6) NOT NULL DEFAULT 1,
  normalized_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'csv' | 'connector'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_spend_user_date ON public.channel_spend(user_id, date DESC);
CREATE INDEX idx_channel_spend_app ON public.channel_spend(app_id, date DESC);
CREATE INDEX idx_channel_spend_channel ON public.channel_spend(channel, date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_spend TO authenticated;
GRANT ALL ON public.channel_spend TO service_role;

ALTER TABLE public.channel_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own channel_spend"
  ON public.channel_spend FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_channel_spend_updated_at
  BEFORE UPDATE ON public.channel_spend
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-compute normalized_spend if not provided
CREATE OR REPLACE FUNCTION public.channel_spend_normalize()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.normalized_spend IS NULL OR NEW.normalized_spend = 0 THEN
    NEW.normalized_spend := ROUND(COALESCE(NEW.spend_amount,0) * COALESCE(NEW.exchange_rate,1), 2);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER channel_spend_normalize_trg
  BEFORE INSERT OR UPDATE ON public.channel_spend
  FOR EACH ROW EXECUTE FUNCTION public.channel_spend_normalize();

-- =========== mmm_runs ===========
CREATE TABLE public.mmm_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id UUID REFERENCES public.apps(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  adstock_lambda NUMERIC(6,4),
  hill_alpha NUMERIC(8,4),
  hill_gamma NUMERIC(12,4),
  roi_mean NUMERIC(10,4),
  roi_p10 NUMERIC(10,4),
  roi_p90 NUMERIC(10,4),
  probability_roi_gt_1 NUMERIC(5,4),
  marginal_roi NUMERIC(10,4),
  saturation_point NUMERIC(12,2),
  optimal_spend NUMERIC(12,2),
  fit_quality NUMERIC(5,4),
  sample_size INTEGER NOT NULL DEFAULT 0,
  model_version TEXT NOT NULL DEFAULT 'bootstrap-v0',
  window_start DATE,
  window_end DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mmm_runs_user_channel ON public.mmm_runs(user_id, channel, generated_at DESC);
CREATE INDEX idx_mmm_runs_app ON public.mmm_runs(app_id, generated_at DESC);

GRANT SELECT ON public.mmm_runs TO authenticated;
GRANT ALL ON public.mmm_runs TO service_role;

ALTER TABLE public.mmm_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own mmm_runs"
  ON public.mmm_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages mmm_runs"
  ON public.mmm_runs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- =========== content organic cost fields ===========
ALTER TABLE public.content
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS ai_generation_cost NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS editing_cost NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS design_cost NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agency_cost NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freelancer_cost NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_estimated NUMERIC(10,2) DEFAULT 0;

CREATE OR REPLACE FUNCTION public.content_compute_cost()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.cost_estimated := ROUND(
    COALESCE(NEW.estimated_hours,0) * COALESCE(NEW.hourly_rate,0)
    + COALESCE(NEW.ai_generation_cost,0)
    + COALESCE(NEW.editing_cost,0)
    + COALESCE(NEW.design_cost,0)
    + COALESCE(NEW.agency_cost,0)
    + COALESCE(NEW.freelancer_cost,0)
  , 2);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS content_compute_cost_trg ON public.content;
CREATE TRIGGER content_compute_cost_trg
  BEFORE INSERT OR UPDATE OF estimated_hours, hourly_rate, ai_generation_cost, editing_cost, design_cost, agency_cost, freelancer_cost
  ON public.content
  FOR EACH ROW EXECUTE FUNCTION public.content_compute_cost();
