
ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS offering_type text,
  ADD COLUMN IF NOT EXISTS goal_type     text;

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS source_type       text,
  ADD COLUMN IF NOT EXISTS evidence_summary  text,
  ADD COLUMN IF NOT EXISTS discovery_run_id  uuid;

CREATE INDEX IF NOT EXISTS prospects_user_source_type_idx
  ON public.prospects (user_id, source_type);

CREATE INDEX IF NOT EXISTS prospects_user_discovery_run_idx
  ON public.prospects (user_id, discovery_run_id)
  WHERE discovery_run_id IS NOT NULL;
