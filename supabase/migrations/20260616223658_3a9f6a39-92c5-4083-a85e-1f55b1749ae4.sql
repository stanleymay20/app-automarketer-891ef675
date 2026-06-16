
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS contact_email      text,
  ADD COLUMN IF NOT EXISTS contact_name       text,
  ADD COLUMN IF NOT EXISTS contact_linkedin   text,
  ADD COLUMN IF NOT EXISTS contact_role       text,
  ADD COLUMN IF NOT EXISTS company_size       text,
  ADD COLUMN IF NOT EXISTS industry           text,
  ADD COLUMN IF NOT EXISTS notes              text,
  ADD COLUMN IF NOT EXISTS owner_id           uuid,
  ADD COLUMN IF NOT EXISTS next_action_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_contacted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS source_confidence  integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS stage              text    NOT NULL DEFAULT 'new';

-- Backfill stage from legacy status
UPDATE public.prospects
SET stage = CASE
  WHEN status IN ('saved','watching') THEN 'saved'
  WHEN status = 'contacted'           THEN 'contacted'
  WHEN status = 'responded'           THEN 'responded'
  WHEN status = 'converted'           THEN 'won'
  WHEN status = 'dismissed'           THEN 'lost'
  ELSE 'new'
END
WHERE stage = 'new';

-- Bound stage values
ALTER TABLE public.prospects
  DROP CONSTRAINT IF EXISTS prospects_stage_check;
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_stage_check
  CHECK (stage IN ('new','saved','qualified','contacted','responded','meeting','proposal','won','lost'));

-- Bound source_confidence
ALTER TABLE public.prospects
  DROP CONSTRAINT IF EXISTS prospects_source_confidence_check;
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_source_confidence_check
  CHECK (source_confidence BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS prospects_user_stage_idx
  ON public.prospects (user_id, stage);

CREATE INDEX IF NOT EXISTS prospects_user_next_action_idx
  ON public.prospects (user_id, next_action_at)
  WHERE next_action_at IS NOT NULL;
