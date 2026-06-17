
REVOKE ALL ON FUNCTION public.on_prospect_reply_inbound() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.on_prospect_reply_inbound() TO service_role;
