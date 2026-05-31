
CREATE TABLE public.campaign_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  app_id UUID NOT NULL,
  asset_type TEXT NOT NULL, -- 'linkedin_post','x_post','landing_variant','lead_magnet','outreach_email','distribution_plan','creative_brief','image_brief','video_brief'
  ref_table TEXT,
  ref_id UUID,
  title TEXT,
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_assets_campaign ON public.campaign_assets(campaign_id);
CREATE INDEX idx_campaign_assets_user ON public.campaign_assets(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_assets TO authenticated;
GRANT ALL ON public.campaign_assets TO service_role;

ALTER TABLE public.campaign_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own campaign assets"
ON public.campaign_assets
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service inserts campaign assets"
ON public.campaign_assets
FOR INSERT
WITH CHECK (true);

CREATE TRIGGER update_campaign_assets_updated_at
BEFORE UPDATE ON public.campaign_assets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
