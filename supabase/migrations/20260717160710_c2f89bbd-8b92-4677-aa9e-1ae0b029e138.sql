
-- ============ email_subscribers ============
CREATE TABLE public.email_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  email text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'subscribed' CHECK (status IN ('pending','subscribed','unsubscribed','bounced','complained')),
  consent_source text,
  consent_at timestamptz DEFAULT now(),
  unsubscribed_at timestamptz,
  unsubscribe_reason text,
  unsubscribe_token text NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);
CREATE UNIQUE INDEX email_subscribers_token_idx ON public.email_subscribers(unsubscribe_token);
CREATE INDEX email_subscribers_user_status_idx ON public.email_subscribers(user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_subscribers TO authenticated;
GRANT ALL ON public.email_subscribers TO service_role;
ALTER TABLE public.email_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subs" ON public.email_subscribers FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "service subs" ON public.email_subscribers FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER email_subscribers_updated BEFORE UPDATE ON public.email_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ nurture_sequences ============
CREATE TABLE public.nurture_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL DEFAULT 'lead_captured' CHECK (trigger_type IN ('lead_captured','manual','tag_added')),
  is_active boolean NOT NULL DEFAULT false,
  from_name text,
  from_email text,
  reply_to text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nurture_seq_user_active_idx ON public.nurture_sequences(user_id, is_active);
CREATE INDEX nurture_seq_app_active_idx ON public.nurture_sequences(app_id, is_active) WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nurture_sequences TO authenticated;
GRANT ALL ON public.nurture_sequences TO service_role;
ALTER TABLE public.nurture_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own seq" ON public.nurture_sequences FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "service seq" ON public.nurture_sequences FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER nurture_seq_updated BEFORE UPDATE ON public.nurture_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ nurture_steps ============
CREATE TABLE public.nurture_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.nurture_sequences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step_order int NOT NULL,
  step_type text NOT NULL DEFAULT 'custom' CHECK (step_type IN ('welcome','value','proof','offer','reengagement','custom')),
  delay_hours int NOT NULL DEFAULT 24,
  subject text NOT NULL,
  body_html text,
  body_text text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_order)
);
CREATE INDEX nurture_steps_seq_idx ON public.nurture_steps(sequence_id, step_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nurture_steps TO authenticated;
GRANT ALL ON public.nurture_steps TO service_role;
ALTER TABLE public.nurture_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own steps" ON public.nurture_steps FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "service steps" ON public.nurture_steps FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER nurture_steps_updated BEFORE UPDATE ON public.nurture_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ nurture_enrollments ============
CREATE TABLE public.nurture_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sequence_id uuid NOT NULL REFERENCES public.nurture_sequences(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL REFERENCES public.email_subscribers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','converted','unsubscribed','completed','failed')),
  current_step_order int NOT NULL DEFAULT 0,
  next_send_at timestamptz,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, subscriber_id)
);
CREATE INDEX nurture_enrol_due_idx ON public.nurture_enrollments(status, next_send_at) WHERE status = 'active';
CREATE INDEX nurture_enrol_user_idx ON public.nurture_enrollments(user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nurture_enrollments TO authenticated;
GRANT ALL ON public.nurture_enrollments TO service_role;
ALTER TABLE public.nurture_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enrol" ON public.nurture_enrollments FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "service enrol" ON public.nurture_enrollments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER nurture_enrol_updated BEFORE UPDATE ON public.nurture_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ nurture_sends ============
CREATE TABLE public.nurture_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  enrollment_id uuid NOT NULL REFERENCES public.nurture_enrollments(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES public.nurture_sequences(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.nurture_steps(id) ON DELETE SET NULL,
  subscriber_id uuid NOT NULL REFERENCES public.email_subscribers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('queued','sent','failed','skipped','bounced')),
  provider_message_id text,
  subject text,
  error text,
  sent_at timestamptz DEFAULT now(),
  opened_at timestamptz,
  clicked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nurture_sends_user_idx ON public.nurture_sends(user_id, sent_at DESC);
CREATE INDEX nurture_sends_enrol_idx ON public.nurture_sends(enrollment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nurture_sends TO authenticated;
GRANT ALL ON public.nurture_sends TO service_role;
ALTER TABLE public.nurture_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sends" ON public.nurture_sends FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "service sends" ON public.nurture_sends FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ Public unsubscribe (security definer) ============
CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(_token text, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE sub record;
BEGIN
  SELECT id, user_id, email, status INTO sub
    FROM public.email_subscribers WHERE unsubscribe_token = _token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  UPDATE public.email_subscribers
    SET status = 'unsubscribed',
        unsubscribed_at = COALESCE(unsubscribed_at, now()),
        unsubscribe_reason = COALESCE(_reason, unsubscribe_reason),
        updated_at = now()
    WHERE id = sub.id;

  UPDATE public.nurture_enrollments
    SET status = 'unsubscribed', updated_at = now()
    WHERE subscriber_id = sub.id AND status = 'active';

  RETURN jsonb_build_object('ok', true, 'email', sub.email);
END;
$$;

REVOKE ALL ON FUNCTION public.unsubscribe_by_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_by_token(text, text) TO anon, authenticated, service_role;

-- ============ Auto-enroll on lead capture ============
CREATE OR REPLACE FUNCTION public.on_lead_captured_enroll()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq record;
  first_step record;
  sub_id uuid;
BEGIN
  IF NEW.email IS NULL OR length(trim(NEW.email)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Find an active welcome sequence for this user (prefer app-matched)
  SELECT * INTO seq FROM public.nurture_sequences
    WHERE user_id = NEW.user_id
      AND is_active = true
      AND trigger_type = 'lead_captured'
      AND (app_id IS NULL OR app_id = NEW.app_id)
    ORDER BY (app_id = NEW.app_id) DESC NULLS LAST, created_at ASC
    LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Upsert subscriber
  INSERT INTO public.email_subscribers (user_id, app_id, email, name, lead_id, consent_source, status)
  VALUES (NEW.user_id, NEW.app_id, lower(NEW.email), NEW.name, NEW.id, 'lead_capture', 'subscribed')
  ON CONFLICT (user_id, email) DO UPDATE
    SET lead_id = COALESCE(public.email_subscribers.lead_id, EXCLUDED.lead_id),
        app_id = COALESCE(public.email_subscribers.app_id, EXCLUDED.app_id),
        name = COALESCE(public.email_subscribers.name, EXCLUDED.name),
        updated_at = now()
  RETURNING id INTO sub_id;

  -- Only enroll if subscriber is still subscribed
  IF (SELECT status FROM public.email_subscribers WHERE id = sub_id) <> 'subscribed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO first_step FROM public.nurture_steps
    WHERE sequence_id = seq.id AND is_active = true
    ORDER BY step_order ASC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.nurture_enrollments (user_id, sequence_id, subscriber_id, status, current_step_order, next_send_at, source)
  VALUES (NEW.user_id, seq.id, sub_id, 'active', 0, now() + make_interval(hours => COALESCE(first_step.delay_hours,0)), 'lead_capture')
  ON CONFLICT (sequence_id, subscriber_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_enroll_nurture
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.on_lead_captured_enroll();

-- ============ Mark converted on conversion ============
CREATE OR REPLACE FUNCTION public.on_conversion_mark_nurture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE sub_id uuid;
BEGIN
  IF NEW.email IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO sub_id FROM public.email_subscribers
    WHERE user_id = NEW.user_id AND email = lower(NEW.email) LIMIT 1;
  IF sub_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.nurture_enrollments
    SET status = 'converted', completed_at = now(), updated_at = now()
    WHERE subscriber_id = sub_id AND status = 'active';
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversions_mark_nurture
  AFTER INSERT ON public.conversions
  FOR EACH ROW EXECUTE FUNCTION public.on_conversion_mark_nurture();
