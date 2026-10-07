# Scroll Marketer → ChatGPT

An authenticated Streamable HTTP MCP service that wraps the maintained Scroll Marketer data model.
This is implementation-ready source, not a deployed or publicly listed plugin.

The confirmed app origin is `https://app-automarketer.lovable.app`. Its consent page will be
`https://app-automarketer.lovable.app/chatgpt-connect` after this change is released.
This app URL is not the separate connector service's `/mcp` endpoint.

## Tools

| Tool | Scope | Existing data/action |
| --- | --- | --- |
| `list_offerings` | `marketing:read` | Offering audience, tone and platforms from `apps` |
| `list_campaigns` | `marketing:read` | Campaign strategy and activity |
| `list_content` | `marketing:read` | Content and scheduled calendar entries |
| `get_post_performance` | `marketing:read` | Stored published-post metrics; null remains unknown |
| `list_prospects` | `marketing:read` | Recorded prospect fit/status; no contact emails |
| `create_content_draft` | `drafts:write` | Idempotent, pending draft for an owned offering/platform |

Every list supports `limit` (1–100) and `offset`; `next_offset` indicates more results. Performance results are
per-post records, never falsely described as complete account totals. Generation happens in ChatGPT; saving a draft
does not call a paid AI gateway or send outreach. There are no send, publish, scheduling-write, spend or autopilot tools.

## Architecture and security

- Node 22+; official MCP SDK; JSON responses over stateless Streamable HTTP at `/mcp`.
- OAuth authorization code with mandatory S256 PKCE, exact callback matching, exact resource audience,
  scopes, single-use two-minute codes, one-hour access tokens, rotating refresh tokens and a 30-day consent limit.
- This deployment uses a predefined **public** OAuth client with `token_endpoint_auth_methods_supported: ["none"]`.
  Configure the client ID in ChatGPT; no shared client secret, DCR or CIMD is implemented.
- Consent uses an existing verified Scroll Marketer Supabase login on the app's trusted origin. Passwords are never
  collected by the connector. JWT verification uses Supabase `auth.getUser`, not a client-supplied user ID.
- Opaque connector credentials are persisted as SHA-256 hashes. Private tables have RLS and no anon/authenticated grants.
  Service RPCs use SECURITY INVOKER and are executable only by service_role.
- Lovable Cloud mode uses one server-to-server Edge Function that keeps the privileged key inside its managed runtime.
  Render verifies app login with the public Supabase key and calls the bridge using a separate secret.
  The bridge accepts only fixed Store methods and exact projections, with bounded input and no arbitrary SQL/RPC/table access.
  A compromised connector or bridge secret can access connector users' data: this remains a privileged boundary.
  Use distinct staging/production secrets, gateway rate limits and secret rotation; never expose it in a browser.
- The canonical database Store uses a server-side service-role credential. Since this bypasses RLS, every read carries an explicit
  user predicate; draft RPCs recheck offering ownership and configured platforms. Test coverage includes a second tenant.
  This is a privileged backend: keep this key exclusively in the hosting provider's server secret store.
- Revoking a grant invalidates all its tokens. Replaying an already consumed refresh token revokes its family.
  A deleted Supabase user removes grants via cascade. Original Supabase session logout does not revoke separate consent;
  use Settings → ChatGPT to revoke it.
- Drafts set `connector_requires_review=true`. The database blocks service/cron attempts to auto-approve them or clear
  that marker. The authenticated owner can approve using the existing app; publishing may then follow existing policies.
- Retries reuse a UUID `idempotency_key`; different payloads with that key fail. The mapping lasts as long as its draft.
- No token-bearing URL/request logging; the app auth bootstrap log records pathname only. Configure host/proxy logs to
  redact `/oauth/authorize` query strings and authorization headers too.
- OAuth throttling is IP-based; MCP throttling is user-based, in memory per instance. Configure gateway rate limits for
  replicated production deployments. Do not enable arbitrary proxy trust. Backend failures fail closed.

## Deploy through the existing Lovable control plane

1. Review and merge the PR. In Lovable, apply the new `*_chatgpt_connector.sql` migration to a test environment first.
   Do not assume this repository grants direct access to the Lovable-managed Supabase project.
2. Run your usual database advisors in the authorized Lovable/backend environment and regenerate Supabase types.
   Confirm the private tables/RPCs are inaccessible to anon and authenticated users.
3. Deploy as a separate Node HTTPS service. Docker context is the **repository root** to include the
   canonical Store shared with the Edge Function. In Render use `connector/Dockerfile`, root build context,
   and leave Root Directory unset:

   ```sh
   docker build -f connector/Dockerfile -t scrollmarketer-connector .
   # Supply values through the hosting provider's server secret store.
   docker run --env-file /secure/path/connector.env -p 8787:8787 scrollmarketer-connector
   ```

4. Set variables shown in `.env.example`. Use exact public **origins** for `CONNECTOR_PUBLIC_URL` and
   `SCROLLMARKETER_APP_URL`. Lovable Cloud cannot export its service-role key. Deploy `chatgpt-connector-bridge` through its authorized
   control plane after staging validation. Set `CONNECTOR_BRIDGE_SECRET` in Lovable backend secrets and Render
   to the same random 32-byte base64url value; never copy it into chat, Git or frontend variables.
   In Render set `SUPABASE_PUBLISHABLE_KEY`, `CONNECTOR_BRIDGE_URL` and `CONNECTOR_BRIDGE_SECRET`,
   leaving `SUPABASE_SERVICE_ROLE_KEY` empty. The bridge URL must belong to `SUPABASE_URL`.
   The Edge Function reads its runtime-injected service-role key. `verify_jwt=false` allows its own server secret
   to authenticate calls; it fails closed for missing/invalid credentials. Verify this boundary in staging.
   Copy exact redirect URI(s) from ChatGPT's OAuth configuration into `CONNECTOR_REDIRECT_URIS`; never use wildcards.
   The example callback is deliberately a placeholder.
5. In Lovable set `VITE_SCROLLMARKETER_CONNECTOR_URL` to the connector's HTTPS origin and publish the app.
   The frontend variable is public and contains only a URL. Never put a service key in a `VITE_*` variable.
6. In ChatGPT **on the web**, add a custom MCP server using `https://YOUR-CONNECTOR/mcp`, choose OAuth,
   and configure the predefined client ID (`CONNECTOR_CLIENT_ID`). If the UI requires a secret for public-client OAuth,
   stop and adapt the provider to a supported auth method; do not invent credentials or disable auth.
7. Install the resulting personal plugin, invoke it in a new chat, sign in to Scroll Marketer and approve the displayed
   scopes. A public directory listing is a separate review/publication process.

## Release checks

### Render staging Blueprint

The repository-root `render.yaml` prepares a free Frankfurt Docker web service
from `feat/chatgpt-mcp-connector`, with manual deployments and `/health` checks.
In Render select **jimp's workspace (jimpcompany@gmail.com)**, the feature branch,
and this Blueprint file. Do not merge the feature into production just to load
the staging Blueprint. Set the connector URL to the HTTPS address assigned by
Render and use the exact callback from the ChatGPT staging client configuration.

This Blueprint does not provision a backend or apply migrations. Before applying
it, supply an isolated Supabase-compatible backend with the app schema, test Auth
users, the connector migration and deployed bridge. `SCROLLMARKETER_APP_URL` must
point to a separately hosted consent app using that same staging backend; the
existing Lovable preview shares production and is unsuitable. Generate a distinct
32-byte base64url bridge credential and save it in both staging server secret stores.
All backend and origin values are prompted rather than defaulted to production.
No service-role key belongs in this Render service. `/health` confirms the process
is running; it does not establish database or OAuth readiness. Verify the full
sign-in, consent, tool, tenant-isolation and revoke flow before production release.

### Commands

```sh
cd connector
npm ci --ignore-scripts
npm test
npm audit --omit=dev --audit-level=high
```

Tests run the actual migration and privileged Store queries in local PostgreSQL via PGlite, and an official MCP client
against a local HTTP server. Supabase JWT verification is mocked only at the identity-provider boundary. The schema
fixture reproduces the relevant existing table contracts; it does not replay every historical migration or prove a live
deployment. Root lint, tests, TypeScript check and production build remain separate checks.

Before calling the deployment live, test:

- Discovery: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`.
- `/mcp` without a token returns 401 with the metadata challenge; arbitrary app JWTs are not connector tokens.
- Real ChatGPT OAuth consent works both for an already signed-in user and a user signing in from the consent page.
- List data for two accounts; verify no cross-account results and a read-only consent cannot save drafts.
- Save the same draft twice with one idempotency key; confirm a single pending content row with no scheduled time.
- Invoke the existing quality gate on that draft; verify it stays pending. Approve in Scroll Marketer as its owner.
- Revoke in Settings and verify the next MCP call fails. Test token refresh with the real ChatGPT client.
- Validate all six tools against the live schema; confirm stored metrics and missing values match the app.

Maintenance: periodically delete expired request rows and expired/revoked grants via the authorized backend control plane;
deleting grants cascades their token families. Preserve drafts and their retry mappings while the content exists.

Rollback: stop the connector service, remove the frontend connector URL, and revoke active grants through the authorized
backend. Keep the manual-review column and guard in place for existing drafts. Dropping that guard could allow the normal
quality gate to auto-approve still-pending drafts.

## Lovable handoff

Use the code on the PR branch; do not recreate an alternative connector implementation. Validate the migration and
bridge in an isolated backend first. After release gates pass, deploy through the authorized Lovable control plane,
configure only the public frontend connector URL, regenerate types, and publish the consent/settings screens. The
service-role credential stays exclusively inside the managed backend function. Do not enable automatic sending for Quantivis EXIST LOI Outreach. Report migration,
advisor and live consent/revocation results before claiming activation.

References: [OpenAI MCP tools](https://developers.openai.com/plugins/build/mcp-server),
[OpenAI authentication](https://developers.openai.com/plugins/build/auth),
[Supabase identity verification](https://supabase.com/docs/reference/javascript/auth-getuser).

## Current deployment status

Lovable inspection on 2026-10-07 confirmed preview and production share one backend, without isolated staging.
A draft does not isolate the database. Create a separate staging backend before applying this migration.
Neither the bridge nor the migration has been deployed. Local PostgreSQL and HTTP tests do not prove a
managed Deno deployment or real ChatGPT OAuth. Lovable remains the control plane for this backend.
