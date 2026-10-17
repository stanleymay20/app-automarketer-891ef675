-- ScrollMarketer Phase 7 final history guard.
-- Approval rationale is part of the historical basis for a reuse grant and must
-- not be rewritten after approval. To change it, revoke and create a new review.

CREATE OR REPLACE FUNCTION public.protect_approved_memory_reuse_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    IF NEW.learning_event_id IS DISTINCT FROM OLD.learning_event_id
       OR NEW.reuse_scope IS DISTINCT FROM OLD.reuse_scope
       OR NEW.target_app_id IS DISTINCT FROM OLD.target_app_id
       OR NEW.allowed_purposes IS DISTINCT FROM OLD.allowed_purposes
       OR NEW.rationale IS DISTINCT FROM OLD.rationale
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.learning_fingerprint IS DISTINCT FROM OLD.learning_fingerprint
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
      RAISE EXCEPTION 'Approved memory reuse history is immutable; revoke it and create a fresh review';
    END IF;
  END IF;

  IF OLD.status IN ('rejected','revoked') AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    RAISE EXCEPTION 'Closed memory reuse review is immutable; create a fresh review';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strategic_memory_reuse_protect_history ON public.strategic_memory_reuse_reviews;
CREATE TRIGGER strategic_memory_reuse_protect_history
  BEFORE UPDATE ON public.strategic_memory_reuse_reviews
  FOR EACH ROW EXECUTE FUNCTION public.protect_approved_memory_reuse_history();

COMMENT ON FUNCTION public.protect_approved_memory_reuse_history() IS
  'Freezes material approval history, including rationale and reviewer identity. Approved grants may be revoked but not rewritten; rejected/revoked reviews are closed history.';
