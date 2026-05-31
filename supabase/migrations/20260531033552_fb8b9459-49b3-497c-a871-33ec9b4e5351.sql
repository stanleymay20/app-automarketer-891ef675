
-- Prospects table: discovered opportunities across 5 categories
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospects TO authenticated;
GRANT ALL ON public.prospects TO service_role;

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own prospects" ON public.prospects
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service inserts prospects" ON public.prospects
  FOR INSERT WITH CHECK (true);

CREATE INDEX idx_prospects_user_cat ON public.prospects(user_id, category, prospect_score DESC);
CREATE INDEX idx_prospects_status ON public.prospects(user_id, status);

CREATE TRIGGER trg_prospects_updated_at
  BEFORE UPDATE ON public.prospects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Prospect actions: outreach drafts + learning loop events
CREATE TABLE public.prospect_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  action_type text NOT NULL, -- linkedin_message | email | partnership_pitch | grant_application | campaign | view | save | contact | respond | convert
  channel text,
  subject text,
  body text,
  campaign_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospect_actions TO authenticated;
GRANT ALL ON public.prospect_actions TO service_role;

ALTER TABLE public.prospect_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own prospect actions" ON public.prospect_actions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_prospect_actions_prospect ON public.prospect_actions(prospect_id, created_at DESC);
