ALTER TABLE public.book_promotion_placements
  ADD COLUMN IF NOT EXISTS revenue_currency text NOT NULL DEFAULT 'EUR';

COMMENT ON COLUMN public.book_promotion_placements.revenue_reported IS
  'Promoter- or operator-reported conversion revenue. This is not independently verified unless reconciled with retailer/payment evidence.';

COMMENT ON COLUMN public.book_promotion_placements.impressions_reported IS
  'Promoter- or platform-reported impressions. Must not be conflated with claimed community membership or independently tracked clicks.';
