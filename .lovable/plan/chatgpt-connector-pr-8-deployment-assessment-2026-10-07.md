# ChatGPT connector (PR #8): deployment assessment

Read-only. Nothing was edited, migrated, merged or published.

## Findings

1. **Can this project reach PR #8?** No. The Git remote here only shows `main` (a70ba3e). Fetching `feat/chatgpt-mcp-connector` fails with "couldn't find remote ref", so commit 3dc4afe can't be inspected or staged from this project. The local repo has no connector folder, and migration `20261006214627_chatgpt_connector.sql` isn't here either (the newest is `20260927110000`).
2. **Test/live separation:** There is none. One Lovable Cloud backend serves both the preview and https://app-automarketer.lovable.app. Any migration applied from here goes to production data right away. Migrations aren't held until the frontend is published.
3. **Can the Node 24 Express MCP service be hosted here?** No. Lovable hosting serves the built Vite frontend as static files. It doesn't run a long-lived Node process, so it can't serve Express, Streamable HTTP sessions, or dynamic `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` at the app origin's root. Backend functions run on Deno at `/functions/v1/<name>`, not at the origin root. Hosting the service there would mean rewriting it, which you've ruled out.
4. **Staging without merging:** Lovable drafts are parallel versions of the main project, but they start from main. They can't check out an outside branch, so a draft wouldn't contain PR #8 unless the code were merged or copied in. Drafts also share the same single backend, so they don't isolate the migration.
5. **Secrets:** Project secrets (Project Settings → Secrets) are only injected into Lovable Cloud backend functions. They can't reach an external Node host. The service-role key and database password aren't available on Lovable Cloud, so an external service can't get them from here.

## Blockers

- PR branch not visible to this project's Git sync.
- No Node/Express runtime and no control over root `/.well-known` on the Lovable origin.
- No separate test backend, so "stage the migration first" means applying it to production.
- No service-role key for an external server.

## Recommended path (once you approve)

1. Host the existing Node 24 service unchanged on an external Node host (for example Fly, Render or Cloud Run) under its own origin, such as `mcp.<your-domain>`. Serve `/.well-known/*` from the root of that origin. The ChatGPT connector URL points there, not at app-automarketer.lovable.app.
2. Set the service's secrets in that host's secret manager. Instead of the service-role key, the service should either check the user's Lovable Cloud login token (signed-in user + RLS), or call a Lovable Cloud backend function that holds privileged access. Secrets for that function go in Project Settings → Secrets.
3. Migration order: review the SQL from the PR, then apply only `20261006214627_chatgpt_connector.sql` here before the service goes live. It goes straight to production, so it must be additive and pass the backend checks. This needs the file contents pasted in or the branch pushed where this project can see it.
4. Keep the CI gates as they are. The root Dependency Audit stays failing on the known braces / tailwindcss / postcss-selector-parser / source-map-js findings. Nothing gets suppressed.
5. Merge PR #8 only after the external service and migration are confirmed working. Publishing the frontend is a separate step.

## Questions to settle before execution

- Which external Node host and domain should the MCP service use?
- Is applying the connector migration straight to the shared production backend acceptable? There's no isolated test backend.
