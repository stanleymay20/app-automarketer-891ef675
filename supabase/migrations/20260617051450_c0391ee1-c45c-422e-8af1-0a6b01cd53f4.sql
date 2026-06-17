ALTER TABLE public.prospect_sequences
  ADD COLUMN IF NOT EXISTS user_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

CREATE INDEX IF NOT EXISTS prospect_sequences_user_approved_idx
  ON public.prospect_sequences (user_id, status, user_approved);