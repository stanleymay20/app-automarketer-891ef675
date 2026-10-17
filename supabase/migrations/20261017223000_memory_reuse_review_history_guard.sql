-- ScrollMarketer Phase 7 final history guard.
-- Approval rationale/reviewer identity are historical facts. Revocation changes
-- permission state; it must not rewrite who approved the original grant.

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
       OR NEW.review_notes IS DISTINCT FROM OLD.review_notes
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

-- The Phase 7 validator records the actor for pending -> approved/rejected.
-- On approved -> revoked it would otherwise replace the original approver with
-- the revoking actor. This trigger runs after the validator (zz_ prefix) and
-- restores the original approval identity while keeping status=revoked.
CREATE OR REPLACE FUNCTION public.preserve_memory_reuse_original_approver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status = 'revoked' THEN
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_strategic_memory_reuse_preserve_approver ON public.strategic_memory_reuse_reviews;
CREATE TRIGGER zz_strategic_memory_reuse_preserve_approver
  BEFORE UPDATE ON public.strategic_memory_reuse_reviews
  FOR EACH ROW EXECUTE FUNCTION public.preserve_memory_reuse_original_approver();

COMMENT ON FUNCTION public.protect_approved_memory_reuse_history() IS
  'Freezes material approval history, including rationale, review notes and reviewer identity. Approved grants may be revoked but not rewritten; rejected/revoked reviews are closed history.';
COMMENT ON FUNCTION public.preserve_memory_reuse_original_approver() IS
  'Preserves the original approver identity when an approved reuse grant is later revoked.';
