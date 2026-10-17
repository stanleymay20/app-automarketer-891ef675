-- Product activation events from first-party products such as ScrollLibrary.
-- These events are intentionally separate from social performance_signals:
-- one describes product activation, the other describes post/channel engagement.

CREATE TABLE public.product_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id UUID NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL CHECK (char_length(product_key) BETWEEN 1 AND 64),
  external_event_id TEXT NOT NULL CHECK (char_length(external_event_id) BETWEEN 1 AND 128),
  external_user_key TEXT CHECK (external_user_key IS NULL OR char_length(external_user_key) <= 128),
  session_id TEXT CHECK (session_id IS NULL OR char_length(session_id) <= 128),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'book_generated',
      'chapter_completed',
      'quiz_completed',
      'certificate_issued',
      'second_book',
      'upgrade_clicked',
      'paid_conversion'
    )
  ),
  source TEXT,
  medium TEXT,
  campaign TEXT,
  term TEXT,
  content TEXT,
  referrer TEXT,
  landing_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT product_events_product_event_unique UNIQUE (product_key, external_event_id)
);

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own product events"
ON public.product_events
FOR SELECT
USING (auth.uid() = user_id);

CREATE INDEX idx_product_events_app_received
  ON public.product_events(app_id, received_at DESC);

CREATE INDEX idx_product_events_app_type_received
  ON public.product_events(app_id, event_type, received_at DESC);

CREATE INDEX idx_product_events_campaign
  ON public.product_events(app_id, campaign)
  WHERE campaign IS NOT NULL;

CREATE INDEX idx_product_events_session
  ON public.product_events(app_id, session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON TABLE public.product_events IS
  'First-party product activation events ingested through authenticated server-to-server bridges.';

COMMENT ON COLUMN public.product_events.external_user_key IS
  'Pseudonymous one-way user key; raw product user IDs and emails must not be stored here.';
