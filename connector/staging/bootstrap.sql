-- STAGING ONLY: connector schema subset, not a complete production clone.
-- Column definitions copied from repository migrations; no live data, jobs or integrations.
-- Create apps table
CREATE TABLE public.apps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  target_audience TEXT,
  primary_goal TEXT CHECK (primary_goal IN ('growth', 'installs', 'signups', 'engagement', 'awareness')),
  brand_tone TEXT CHECK (brand_tone IN ('professional', 'friendly', 'bold', 'casual', 'faith-aligned', 'technical')),
  website_url TEXT,
  platforms TEXT[] DEFAULT '{}',
  posts_count INTEGER DEFAULT 0,
  engagements_count INTEGER DEFAULT 0,
  traffic_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create content table
CREATE TABLE public.content (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  app_id UUID REFERENCES public.apps(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL,
  content_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'published', 'rejected')),
  scheduled_for TIMESTAMP WITH TIME ZONE,
  published_at TIMESTAMP WITH TIME ZONE,
  engagements INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);


CREATE TABLE public.growth_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  app_id UUID REFERENCES public.apps(id) ON DELETE CASCADE NOT NULL,
  goal_type TEXT NOT NULL DEFAULT 'awareness',
  target_value INTEGER NOT NULL DEFAULT 100,
  current_value INTEGER NOT NULL DEFAULT 0,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE TABLE public.campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id UUID REFERENCES public.apps(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  goal_id UUID REFERENCES public.growth_goals(id) ON DELETE SET NULL,
  campaign_name TEXT NOT NULL,
  strategy_summary TEXT,
  themes TEXT[] DEFAULT '{}',
  platform_mix TEXT[] DEFAULT '{}',
  posting_frequency INTEGER NOT NULL DEFAULT 3,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE TABLE public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  app_id uuid,
  category text NOT NULL, -- customer | grant | partner | investor | community
  name text NOT NULL,
  description text,
  url text,
  location text,
  -- scoring
  fit_score int NOT NULL DEFAULT 50,
  opportunity_score int NOT NULL DEFAULT 50,
  urgency_score int NOT NULL DEFAULT 50,
  reachability_score int NOT NULL DEFAULT 50,
  prospect_score int NOT NULL DEFAULT 50,
  match_reason text,
  -- linkage to intelligence
  matched_persona_id uuid,
  matched_icp_id uuid,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- lifecycle
  status text NOT NULL DEFAULT 'new', -- new | saved | watching | contacted | responded | converted | dismissed
  saved_at timestamptz,
  contacted_at timestamptz,
  responded_at timestamptz,
  converted_at timestamptz,
  revenue_attributed numeric NOT NULL DEFAULT 0,
  -- metadata
  source text NOT NULL DEFAULT 'ai_discovery',
  deadline date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Add posting result columns to content table
ALTER TABLE public.content
  ADD COLUMN IF NOT EXISTS external_post_id text,
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE public.prospects ADD COLUMN company_name text, ADD COLUMN stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new','saved','qualified','contacted','responded','meeting','proposal','won','lost'));
ALTER TABLE public.apps ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apps TO authenticated;
GRANT ALL ON public.apps TO service_role;
CREATE POLICY staging_owner_apps ON public.apps TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE INDEX staging_apps_user_idx ON public.apps(user_id);
ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content TO authenticated;
GRANT ALL ON public.content TO service_role;
CREATE POLICY staging_owner_content ON public.content TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE INDEX staging_content_user_idx ON public.content(user_id);
ALTER TABLE public.growth_goals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_goals TO authenticated;
GRANT ALL ON public.growth_goals TO service_role;
CREATE POLICY staging_owner_growth_goals ON public.growth_goals TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE INDEX staging_growth_goals_user_idx ON public.growth_goals(user_id);
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
CREATE POLICY staging_owner_campaigns ON public.campaigns TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE INDEX staging_campaigns_user_idx ON public.campaigns(user_id);
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospects TO authenticated;
GRANT ALL ON public.prospects TO service_role;
CREATE POLICY staging_owner_prospects ON public.prospects TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE INDEX staging_prospects_user_idx ON public.prospects(user_id);
REVOKE ALL ON public.apps, public.content, public.growth_goals, public.campaigns, public.prospects FROM anon;
