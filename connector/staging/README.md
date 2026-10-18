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

## Connector deployment checkpoint — 2026-10-18

This connector-specific Supabase staging project was restored from INACTIVE and
verified ACTIVE_HEALTHY. Its migration history lists
`20261007061712_connector_staging_bootstrap` and
`20261007061715_chatgpt_connector`. The public schema contains apps, content,
strategic prerequisites (growth_goals), campaigns, prospects and four private
`mcp_connector_*` tables. All listed tables have RLS enabled. Supabase's
informational `rls_enabled_no_policy` notices for the four private connector
tables are intentional: anon/authenticated roles have no table grants or policies.
This is not proof of a complete two-user runtime regression pass.

The existing `chatgpt-connector-bridge` Edge Function is ACTIVE (version 2),
but whether `CONNECTOR_BRIDGE_SECRET` is configured and a real authenticated
request succeeds remains **unverified**. No privileged credentials were
exported or copied to the frontend.

A separate Render **static** staging consent frontend has been created:

- URL: https://scrollmarketer-chatgpt-consent-staging.onrender.com
- Render service: `srv-dba0dcvbtjjs73da6vr0`
- Exact code head built: `6667eefdb83686e1cea4d9f87fcf8497480d332d`
- Deploy `dep-dba0ddfbtjjs73da73og`: `live`
- Build-time settings: `VITE_SUPABASE_URL` points **only** to
  `https://hdpakzkguumyocopvplt.supabase.co`; a staging publishable key is
  configured. No service-role key is used.
- `VITE_SCROLLMARKETER_CONNECTOR_URL` is deliberately unset because no real
  staging MCP server exists yet. Browser navigation/login, direct deep-link
  fallback for `/chatgpt-connect`, and real OAuth consent remain **unverified**.

Render workspace `tea-db2u2he7bikc73b0nm8g` currently has **no**
`scrollmarketer-connector-staging` Node/Docker web service. Its pre-existing
WhatsApp service is unrelated and must not be repurposed. The next controlled
steps are to configure the matching bridge credential **through secure backend
secret stores**, create the Render MCP service from this branch with
`connector/Dockerfile` and repository-root context, configure the exact
callback URI provided by the eligible ChatGPT plugin-creation UI, and set the
static site's public `VITE_SCROLLMARKETER_CONNECTOR_URL` to that MCP service
origin. The frontend must be rebuilt for the public URL change. Validate
Render deep-link rewrite to `/index.html` before OAuth testing.

**Stop conditions:** Never deploy with a placeholder/shared secret; never
fall back to a production Supabase project or bypass the bridge; never call a
`/health` PASS equivalent to OAuth, RLS or MCP authorization PASS; never
merge PR #8 or enable write scope before two-user isolation, grant
revocation, PKCE/refresh and manual draft-review checks pass. No connector
is yet connected inside ChatGPT.

ChatGPT custom MCP server creation is subject to account/workspace permission;
current OpenAI documentation identifies Business/Enterprise/Edu workspace
controls. Check the actual ChatGPT Plugins UI before promising that a personal
Plus account can add a private custom MCP server. Public plugin review is a
separate distribution gate.
