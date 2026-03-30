-- Add posting result columns to content table
ALTER TABLE public.content
  ADD COLUMN IF NOT EXISTS external_post_id text,
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS failure_reason text;