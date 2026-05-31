
ALTER TABLE public.content
  ADD COLUMN IF NOT EXISTS failure_category text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_latency_ms integer;

CREATE INDEX IF NOT EXISTS idx_content_status_category ON public.content(status, failure_category);
CREATE INDEX IF NOT EXISTS idx_content_published_at ON public.content(published_at);

-- Backfill historic failures so the dashboard is meaningful immediately
UPDATE public.content SET failure_category = CASE
  WHEN failure_reason ILIKE '%token expired%' OR failure_reason ILIKE '%reconnect%' OR failure_reason ILIKE '%not connected%' THEN 'token_expired'
  WHEN failure_reason ILIKE '%credits%' OR failure_reason ILIKE '%402%' THEN 'account_no_credits'
  WHEN failure_reason ILIKE '%character limit%' OR failure_reason ILIKE '%too long%' OR failure_reason ILIKE '%exceeds%' THEN 'content_too_long'
  WHEN failure_reason ILIKE '%429%' OR failure_reason ILIKE '%rate limit%' THEN 'rate_limit'
  WHEN failure_reason ILIKE '%5__%' OR failure_reason ~ '5\d{2}' THEN 'platform_5xx'
  WHEN failure_reason ILIKE '%validation%' OR failure_reason ILIKE '%too short%' OR failure_reason ILIKE '%unattached%' THEN 'validation'
  WHEN failure_reason IS NULL THEN 'unknown'
  ELSE 'platform_error'
END
WHERE status = 'failed' AND failure_category IS NULL;
