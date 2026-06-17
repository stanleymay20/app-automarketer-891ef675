
-- ============================================================
-- prospect_messages: outbound message log
-- ============================================================
CREATE TABLE public.prospect_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'email',
  subject text,
  body text NOT NULL,
  from_address text,
  to_address text NOT NULL,
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued',
  error_message text,
  sent_at timestamptz,
  sequence_id uuid,
  sequence_step_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_messages_channel_chk CHECK (channel IN ('email','linkedin','x','other')),
  CONSTRAINT prospect_messages_status_chk CHECK (status IN ('queued','sent','failed','bounced'))
);

CREATE INDEX prospect_messages_user_sent_idx ON public.prospect_messages (user_id, sent_at DESC NULLS LAST);
CREATE INDEX prospect_messages_prospect_idx ON public.prospect_messages (prospect_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospect_messages TO authenticated;
GRANT ALL ON public.prospect_messages TO service_role;

ALTER TABLE public.prospect_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own messages"
  ON public.prospect_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own messages"
  ON public.prospect_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.prospects p WHERE p.id = prospect_id AND p.user_id = auth.uid())
  );
CREATE POLICY "Users update own messages"
  ON public.prospect_messages FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own messages"
  ON public.prospect_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER prospect_messages_set_updated_at
  BEFORE UPDATE ON public.prospect_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- prospect_sequences: scheduled follow-up steps
-- ============================================================
CREATE TABLE public.prospect_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  sequence_name text NOT NULL DEFAULT 'default-3-step',
  step_number int NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled',
  template_id text,
  message_id uuid REFERENCES public.prospect_messages(id) ON DELETE SET NULL,
  subject text,
  body text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_sequences_status_chk CHECK (status IN ('scheduled','sent','skipped','paused','completed','failed')),
  CONSTRAINT prospect_sequences_step_chk CHECK (step_number >= 1),
  CONSTRAINT prospect_sequences_uq UNIQUE (prospect_id, sequence_name, step_number)
);

CREATE INDEX prospect_sequences_due_idx
  ON public.prospect_sequences (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX prospect_sequences_user_idx
  ON public.prospect_sequences (user_id, status);
CREATE INDEX prospect_sequences_prospect_idx
  ON public.prospect_sequences (prospect_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospect_sequences TO authenticated;
GRANT ALL ON public.prospect_sequences TO service_role;

ALTER TABLE public.prospect_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own sequences"
  ON public.prospect_sequences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own sequences"
  ON public.prospect_sequences FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.prospects p WHERE p.id = prospect_id AND p.user_id = auth.uid())
  );
CREATE POLICY "Users update own sequences"
  ON public.prospect_sequences FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own sequences"
  ON public.prospect_sequences FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER prospect_sequences_set_updated_at
  BEFORE UPDATE ON public.prospect_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Extend the reply trigger to pause sequences on inbound replies.
-- ============================================================
CREATE OR REPLACE FUNCTION public.on_prospect_reply_inbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE paused_count int;
BEGIN
  IF NEW.direction = 'inbound' THEN
    -- Stage + timestamps
    UPDATE public.prospects
       SET stage = 'responded',
           pipeline_stage = COALESCE(pipeline_stage, 'responded'),
           responded_at = COALESCE(responded_at, NEW.received_at),
           last_contacted_at = GREATEST(COALESCE(last_contacted_at, NEW.received_at), NEW.received_at),
           updated_at = now()
     WHERE id = NEW.prospect_id
       AND user_id = NEW.user_id
       AND (stage IS DISTINCT FROM 'converted');

    -- Activity feed entry for the reply
    INSERT INTO public.prospect_actions (user_id, prospect_id, action_type, channel, subject, body, metadata)
    VALUES (
      NEW.user_id, NEW.prospect_id, 'reply_received', NEW.channel,
      NEW.subject, NEW.body,
      jsonb_build_object('reply_id', NEW.id, 'source', NEW.source, 'from', NEW.from_address)
    );

    -- Pause every still-scheduled sequence step for this prospect
    UPDATE public.prospect_sequences
       SET status = 'paused', updated_at = now()
     WHERE prospect_id = NEW.prospect_id
       AND user_id = NEW.user_id
       AND status = 'scheduled';
    GET DIAGNOSTICS paused_count = ROW_COUNT;

    IF paused_count > 0 THEN
      INSERT INTO public.prospect_actions (user_id, prospect_id, action_type, channel, metadata)
      VALUES (
        NEW.user_id, NEW.prospect_id, 'sequence_paused', NEW.channel,
        jsonb_build_object('paused_steps', paused_count, 'reason', 'inbound_reply', 'reply_id', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.on_prospect_reply_inbound() FROM PUBLIC, anon, authenticated;
