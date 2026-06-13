
-- Drop open INSERT policies (service role bypasses RLS)
DROP POLICY IF EXISTS "Service can insert audit logs" ON public.automation_audit_log;
DROP POLICY IF EXISTS "Service inserts campaign assets" ON public.campaign_assets;
DROP POLICY IF EXISTS "Service inserts distribution targets" ON public.distribution_targets;
DROP POLICY IF EXISTS "Service inserts distribution recs" ON public.distribution_recommendations;
DROP POLICY IF EXISTS "Service inserts market signals" ON public.market_signals;
DROP POLICY IF EXISTS "Service inserts competitor signals" ON public.competitor_signals;
DROP POLICY IF EXISTS "Service inserts customer signals" ON public.customer_signals;
DROP POLICY IF EXISTS "Service inserts growth recommendations" ON public.growth_recommendations;
DROP POLICY IF EXISTS "Service inserts opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Service inserts portfolio snapshots" ON public.portfolio_snapshots;
DROP POLICY IF EXISTS "Service inserts prospects" ON public.prospects;

-- content_scores: add owner-scoped write policies
CREATE POLICY "Users insert scores for own content" ON public.content_scores
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.content c WHERE c.id = content_scores.content_id AND c.user_id = auth.uid()));
CREATE POLICY "Users update scores for own content" ON public.content_scores
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.content c WHERE c.id = content_scores.content_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.content c WHERE c.id = content_scores.content_id AND c.user_id = auth.uid()));
CREATE POLICY "Users delete scores for own content" ON public.content_scores
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.content c WHERE c.id = content_scores.content_id AND c.user_id = auth.uid()));

-- performance_signals: add owner-scoped write policies
CREATE POLICY "Users insert signals for own content" ON public.performance_signals
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.content c WHERE c.id = performance_signals.content_id AND c.user_id = auth.uid()));
CREATE POLICY "Users update signals for own content" ON public.performance_signals
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.content c WHERE c.id = performance_signals.content_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.content c WHERE c.id = performance_signals.content_id AND c.user_id = auth.uid()));
CREATE POLICY "Users delete signals for own content" ON public.performance_signals
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.content c WHERE c.id = performance_signals.content_id AND c.user_id = auth.uid()));

-- Revoke EXECUTE on SECURITY DEFINER helpers from public roles (triggers still fire as table owner)
REVOKE EXECUTE ON FUNCTION public.propagate_distribution_lineage() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_distribution_click() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_distribution_lead() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_distribution_conversion() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decay_distribution_recommendations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_original_confidence() FROM PUBLIC, anon, authenticated;

-- Pin search_path on set_original_confidence
ALTER FUNCTION public.set_original_confidence() SET search_path = public;
