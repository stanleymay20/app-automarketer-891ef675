ALTER TABLE public.grants ADD COLUMN app_id uuid;
ALTER TABLE public.grant_applications ADD COLUMN app_id uuid;
CREATE INDEX IF NOT EXISTS idx_grants_app_id ON public.grants(app_id);
CREATE INDEX IF NOT EXISTS idx_grant_applications_app_id ON public.grant_applications(app_id);