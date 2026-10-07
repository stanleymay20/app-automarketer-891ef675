# Isolated connector staging

Project: `scrollmarketer-connector-staging` (`hdpakzkguumyocopvplt`), Frankfurt,
organization `jimpcompany@gmail.com's Org`. Created 2026-10-07; cost confirmation
reported $0/month. This is separate from Lovable-managed production.

Applied migrations: `connector_staging_bootstrap`, then the unchanged
`20261006214627_chatgpt_connector.sql` from this branch. `bootstrap.sql` is a
connector-only subset based on repository table definitions. It is intentionally
outside `supabase/migrations/` and must never be applied to production. It does
not establish complete schema parity, import users/content, install jobs, or
connect publishing/outreach integrations. Only owner-scoped authenticated RLS
policies are installed on its prerequisite tables.

Managed Postgres checks passed: credential-table RLS and denied anon/authenticated
reads; draft retry idempotency; offering ownership; privileged automatic approval
blocked; matching owner approval allowed. Synthetic users and drafts were created
inside a transaction and rolled back. These are database checks, not real Auth
sign-in or end-to-end ChatGPT validation.

Still required: configure a random 32-byte base64url `CONNECTOR_BRIDGE_SECRET` in
Supabase Edge Function secrets and the matching Render service, deploy the bridge,
host a staging consent frontend against this backend, configure the exact ChatGPT
OAuth callback, then deploy and validate the connector. Keep credentials out of
this repository and chat. Production migration and release remain held.
