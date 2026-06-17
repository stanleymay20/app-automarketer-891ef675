ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_autopilot_state_check;
ALTER TABLE public.prospects ADD CONSTRAINT prospects_autopilot_state_check
  CHECK (autopilot_state IS NULL OR autopilot_state = ANY (ARRAY[
    'auto_sent'::text, 'review_required'::text, 'queued'::text, 'blocked'::text, 'sending'::text
  ]));