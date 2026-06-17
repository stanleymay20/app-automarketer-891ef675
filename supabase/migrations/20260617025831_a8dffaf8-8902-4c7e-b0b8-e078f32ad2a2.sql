
ALTER TABLE public.prospect_sequences
  DROP CONSTRAINT IF EXISTS prospect_sequences_status_chk;
ALTER TABLE public.prospect_sequences
  ADD CONSTRAINT prospect_sequences_status_chk
  CHECK (status IN ('scheduled','sending','sent','skipped','paused','completed','failed'));
