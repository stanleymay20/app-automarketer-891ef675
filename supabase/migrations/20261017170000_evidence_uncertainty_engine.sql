-- ScrollMarketer Evidence & Uncertainty Engine
-- Additive, owner-scoped foundation for separating observed facts from
-- inferences/assumptions/unknowns and prioritising the next question to answer.

CREATE TABLE IF NOT EXISTS public.strategic_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.growth_goals(id) ON DELETE SET NULL,
  decision_id uuid REFERENCES public.strategic_decisions(id) ON DELETE SET NULL,
  item_type text NOT NULL
    CHECK (item_type = ANY (ARRAY['observation','inference','assumption','unknown'])),
  claim text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type = ANY (ARRAY[
      'manual','analytics','customer','market','competitor','experiment',
      'document','model','other'
    ])),
  source_reference text,
  confidence integer CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  evidence_strength integer CHECK (evidence_strength IS NULL OR evidence_strength BETWEEN 0 AND 100),
  impact_if_wrong integer NOT NULL DEFAULT 50 CHECK (impact_if_wrong BETWEEN 0 AND 100),
  decision_relevance integer NOT NULL DEFAULT 50 CHECK (decision_relevance BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'active'
    CHECK (status = ANY (ARRAY['active','validated','invalidated','resolved','superseded'])),
  verification_method text,
  observed_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_evidence_user_created_idx
  ON public.strategic_evidence_items (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_evidence_app_type_idx
  ON public.strategic_evidence_items (app_id, item_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_evidence_goal_idx
  ON public.strategic_evidence_items (goal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_evidence_decision_idx
  ON public.strategic_evidence_items (decision_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_evidence_items TO authenticated;
GRANT ALL ON public.strategic_evidence_items TO service_role;

ALTER TABLE public.strategic_evidence_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic evidence" ON public.strategic_evidence_items;
CREATE POLICY "Users manage own strategic evidence" ON public.strategic_evidence_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS strategic_evidence_set_updated_at ON public.strategic_evidence_items;
CREATE TRIGGER strategic_evidence_set_updated_at
  BEFORE UPDATE ON public.strategic_evidence_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.strategic_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.growth_goals(id) ON DELETE SET NULL,
  decision_id uuid REFERENCES public.strategic_decisions(id) ON DELETE SET NULL,
  question text NOT NULL,
  current_confidence integer NOT NULL DEFAULT 50 CHECK (current_confidence BETWEEN 0 AND 100),
  decision_impact integer NOT NULL DEFAULT 50 CHECK (decision_impact BETWEEN 0 AND 100),
  answerability integer NOT NULL DEFAULT 50 CHECK (answerability BETWEEN 0 AND 100),
  urgency integer NOT NULL DEFAULT 50 CHECK (urgency BETWEEN 0 AND 100),
  effort text NOT NULL DEFAULT 'medium'
    CHECK (effort = ANY (ARRAY['low','medium','high'])),
  information_value_score integer GENERATED ALWAYS AS (
    round((((100 - current_confidence)::numeric * decision_impact * answerability) / 10000.0))::integer
  ) STORED,
  status text NOT NULL DEFAULT 'open'
    CHECK (status = ANY (ARRAY['open','answered','dismissed'])),
  answer text,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategic_questions_user_open_idx
  ON public.strategic_questions (user_id, status, information_value_score DESC, urgency DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_questions_app_open_idx
  ON public.strategic_questions (app_id, status, information_value_score DESC, urgency DESC);
CREATE UNIQUE INDEX IF NOT EXISTS strategic_questions_decision_question_uidx
  ON public.strategic_questions (decision_id, question)
  WHERE decision_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategic_questions TO authenticated;
GRANT ALL ON public.strategic_questions TO service_role;

ALTER TABLE public.strategic_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own strategic questions" ON public.strategic_questions;
CREATE POLICY "Users manage own strategic questions" ON public.strategic_questions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS strategic_questions_set_updated_at ON public.strategic_questions;
CREATE TRIGGER strategic_questions_set_updated_at
  BEFORE UPDATE ON public.strategic_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A decision's explicit "next information needed" becomes a tracked question.
-- The scoring inputs are conservative defaults and remain editable by the user.
CREATE OR REPLACE FUNCTION public.track_strategic_next_question()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  impact_score integer;
BEGIN
  IF NEW.next_information_needed IS NULL OR btrim(NEW.next_information_needed) = '' THEN
    RETURN NEW;
  END IF;

  impact_score := CASE NEW.reversibility
    WHEN 'hard_to_reverse' THEN 90
    WHEN 'partly_reversible' THEN 70
    ELSE 50
  END;

  INSERT INTO public.strategic_questions (
    user_id,
    app_id,
    goal_id,
    decision_id,
    question,
    current_confidence,
    decision_impact,
    answerability,
    urgency,
    effort
  )
  VALUES (
    NEW.user_id,
    NEW.app_id,
    NEW.goal_id,
    NEW.id,
    NEW.next_information_needed,
    COALESCE(NEW.confidence, 50),
    impact_score,
    60,
    CASE WHEN NEW.reversibility = 'hard_to_reverse' THEN 80 ELSE 50 END,
    'medium'
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS strategic_decisions_track_next_question ON public.strategic_decisions;
CREATE TRIGGER strategic_decisions_track_next_question
  AFTER INSERT OR UPDATE OF next_information_needed ON public.strategic_decisions
  FOR EACH ROW EXECUTE FUNCTION public.track_strategic_next_question();

COMMENT ON TABLE public.strategic_evidence_items IS
  'Evidence register that preserves the distinction between observation, inference, assumption and unknown.';
COMMENT ON COLUMN public.strategic_evidence_items.evidence_strength IS
  'User-supplied strength of support, 0-100. It is not an AI certainty claim.';
COMMENT ON TABLE public.strategic_questions IS
  'Questions that can reduce decision uncertainty; ranked by a deterministic information-value proxy.';
COMMENT ON COLUMN public.strategic_questions.information_value_score IS
  '0-100 proxy = uncertainty x decision impact x answerability. It is not expected monetary value.';
