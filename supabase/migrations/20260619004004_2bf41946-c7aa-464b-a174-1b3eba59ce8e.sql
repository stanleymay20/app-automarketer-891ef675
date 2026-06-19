
ALTER TABLE public.autopilot_settings
  ADD COLUMN IF NOT EXISTS gmail_reply_sync_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmail_last_synced_at TIMESTAMPTZ;
