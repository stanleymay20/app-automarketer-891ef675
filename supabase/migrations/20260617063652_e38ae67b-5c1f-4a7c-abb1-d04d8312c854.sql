ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS review_draft_subject text,
  ADD COLUMN IF NOT EXISTS review_draft_body text;