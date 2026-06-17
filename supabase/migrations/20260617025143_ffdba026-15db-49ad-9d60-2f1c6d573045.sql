
CREATE TABLE public.prospect_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'manual',
  direction text NOT NULL DEFAULT 'inbound',
  from_address text,
  from_name text,
  subject text,
  body text,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',
  external_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_replies_channel_chk CHECK (channel IN ('email','linkedin','x','manual','other')),
  CONSTRAINT prospect_replies_direction_chk CHECK (direction IN ('inbound','outbound')),
  CONSTRAINT prospect_replies_source_chk CHECK (source IN ('manual','edge','gmail','outlook','webhook'))
);

CREATE UNIQUE INDEX prospect_replies_source_external_uq
  ON public.prospect_replies (source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX prospect_replies_user_received_idx
  ON public.prospect_replies (user_id, received_at DESC);

CREATE INDEX prospect_replies_prospect_idx
  ON public.prospect_replies (prospect_id, received_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospect_replies TO authenticated;
GRANT ALL ON public.prospect_replies TO service_role;

ALTER TABLE public.prospect_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own replies"
  ON public.prospect_replies FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own replies"
  ON public.prospect_replies FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.prospects p WHERE p.id = prospect_id AND p.user_id = auth.uid())
  );

CREATE POLICY "Users update own replies"
  ON public.prospect_replies FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own replies"
  ON public.prospect_replies FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER prospect_replies_set_updated_at
  BEFORE UPDATE ON public.prospect_replies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-stage + activity feed on inbound reply.
CREATE OR REPLACE FUNCTION public.on_prospect_reply_inbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    UPDATE public.prospects
       SET stage = 'responded',
           pipeline_stage = COALESCE(pipeline_stage, 'responded'),
           responded_at = COALESCE(responded_at, NEW.received_at),
           last_contacted_at = GREATEST(COALESCE(last_contacted_at, NEW.received_at), NEW.received_at),
           updated_at = now()
     WHERE id = NEW.prospect_id
       AND user_id = NEW.user_id
       AND (stage IS DISTINCT FROM 'converted');

    INSERT INTO public.prospect_actions (user_id, prospect_id, action_type, channel, subject, body, metadata)
    VALUES (
      NEW.user_id, NEW.prospect_id, 'reply_received', NEW.channel,
      NEW.subject, NEW.body,
      jsonb_build_object('reply_id', NEW.id, 'source', NEW.source, 'from', NEW.from_address)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prospect_replies_auto_stage
  AFTER INSERT ON public.prospect_replies
  FOR EACH ROW EXECUTE FUNCTION public.on_prospect_reply_inbound();
