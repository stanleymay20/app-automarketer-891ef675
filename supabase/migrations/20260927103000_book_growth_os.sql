-- ScrollMarketer Book Growth OS
-- Adds book-specific campaign metadata plus measurable external promoter execution.

CREATE TABLE IF NOT EXISTS public.book_marketing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  title text NOT NULL,
  subtitle text,
  author_name text,
  isbn_paperback text,
  isbn_hardcover text,
  isbn_epub text,
  asin text,
  primary_conversion_url text,
  retailer_urls jsonb NOT NULL DEFAULT '{}'::jsonb,
  genres text[] NOT NULL DEFAULT '{}'::text[],
  themes text[] NOT NULL DEFAULT '{}'::text[],
  markets text[] NOT NULL DEFAULT '{}'::text[],
  launch_stage text NOT NULL DEFAULT 'prelaunch'
    CHECK (launch_stage IN ('prelaunch','launch','evergreen','relaunch')),
  launch_date date,
  review_goal integer,
  sales_goal integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id)
);

CREATE INDEX IF NOT EXISTS book_marketing_profiles_user_idx
  ON public.book_marketing_profiles(user_id);

ALTER TABLE public.book_marketing_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own book marketing profiles" ON public.book_marketing_profiles;
CREATE POLICY "Users manage own book marketing profiles"
  ON public.book_marketing_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.book_promoters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  name text NOT NULL,
  profile_url text,
  email text,
  organization text,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','trial','active','paused','completed','declined')),
  fee numeric,
  fee_currency text NOT NULL DEFAULT 'EUR',
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_promoters_user_app_idx
  ON public.book_promoters(user_id, app_id);

ALTER TABLE public.book_promoters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own book promoters" ON public.book_promoters;
CREATE POLICY "Users manage own book promoters"
  ON public.book_promoters
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.book_promotion_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  book_profile_id uuid NOT NULL REFERENCES public.book_marketing_profiles(id) ON DELETE CASCADE,
  promoter_id uuid REFERENCES public.book_promoters(id) ON DELETE SET NULL,
  distribution_target_id uuid REFERENCES public.distribution_targets(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  platform text NOT NULL,
  community_name text,
  destination_url text NOT NULL,
  tracking_token text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  audience_size_claimed bigint,
  budget numeric,
  budget_currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','approved','live','completed','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  conversions_reported integer NOT NULL DEFAULT 0,
  revenue_reported numeric NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tracking_token)
);

CREATE INDEX IF NOT EXISTS book_promotion_assignments_user_app_idx
  ON public.book_promotion_assignments(user_id, app_id);

CREATE INDEX IF NOT EXISTS book_promotion_assignments_promoter_idx
  ON public.book_promotion_assignments(promoter_id)
  WHERE promoter_id IS NOT NULL;

ALTER TABLE public.book_promotion_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own book promotion assignments" ON public.book_promotion_assignments;
CREATE POLICY "Users manage own book promotion assignments"
  ON public.book_promotion_assignments
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.book_promotion_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.book_promotion_assignments(id) ON DELETE CASCADE,
  platform text NOT NULL,
  community_name text,
  post_url text,
  evidence_url text,
  audience_size_claimed bigint,
  impressions_reported bigint,
  engagements_reported bigint,
  conversions_reported integer NOT NULL DEFAULT 0,
  revenue_reported numeric NOT NULL DEFAULT 0,
  posted_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_promotion_placements_user_idx
  ON public.book_promotion_placements(user_id);

CREATE INDEX IF NOT EXISTS book_promotion_placements_assignment_idx
  ON public.book_promotion_placements(assignment_id);

ALTER TABLE public.book_promotion_placements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own book promotion placements" ON public.book_promotion_placements;
CREATE POLICY "Users manage own book promotion placements"
  ON public.book_promotion_placements
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.book_promotion_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.book_promotion_assignments(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  referrer text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS book_promotion_clicks_assignment_idx
  ON public.book_promotion_clicks(assignment_id, clicked_at DESC);

ALTER TABLE public.book_promotion_clicks ENABLE ROW LEVEL SECURITY;

-- Owners can inspect clicks belonging to their assignments; inserts happen through the service-role edge function.
DROP POLICY IF EXISTS "Users read own book promotion clicks" ON public.book_promotion_clicks;
CREATE POLICY "Users read own book promotion clicks"
  ON public.book_promotion_clicks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.book_promotion_assignments a
      WHERE a.id = assignment_id
        AND a.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.set_book_growth_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_book_marketing_profiles_updated_at ON public.book_marketing_profiles;
CREATE TRIGGER trg_book_marketing_profiles_updated_at
  BEFORE UPDATE ON public.book_marketing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_book_growth_updated_at();

DROP TRIGGER IF EXISTS trg_book_promoters_updated_at ON public.book_promoters;
CREATE TRIGGER trg_book_promoters_updated_at
  BEFORE UPDATE ON public.book_promoters
  FOR EACH ROW EXECUTE FUNCTION public.set_book_growth_updated_at();

DROP TRIGGER IF EXISTS trg_book_promotion_assignments_updated_at ON public.book_promotion_assignments;
CREATE TRIGGER trg_book_promotion_assignments_updated_at
  BEFORE UPDATE ON public.book_promotion_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_book_growth_updated_at();
