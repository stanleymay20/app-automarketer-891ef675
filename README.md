# app-automarketer

**Universal AI Growth OS.** Define your offering, discover prospects, generate outreach, publish content, capture leads, and learn from conversions — for any product, service, book, agency, or SaaS.

## What it does

- **Offering setup.** Paste a URL; the AI extracts what you sell, who it's for, and the brand tone.
- **Prospect discovery.** AI + web research surfaces real customers, partners, investors, communities, and grants.
- **Outreach generation.** Persona-aware drafts you can copy, send by email, or open on LinkedIn.
- **Content + publishing.** Generate platform-native posts and publish to LinkedIn and X on schedule.
- **Landing pages + lead capture.** Premium per-offering landing pages with attribution.
- **Distribution intelligence.** Channels, communities, influencers, and events ranked by audience fit.
- **Conversion learning loop.** Revenue and lead signals feed back into the recommendation engine.

## Stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui
- **Backend:** Lovable Cloud (Supabase) — Postgres, Auth, Edge Functions (Deno), Storage
- **AI:** Lovable AI Gateway (Google Gemini) for content, scoring, and insights
- **Web data:** Firecrawl (scrape/map), Perplexity (live research)
- **Email:** Resend (transactional + weekly reports)
- **Social:** LinkedIn API, X API (OAuth 2.0 PKCE)

## Local development

```sh
npm install
npm run dev
```

App runs on `http://localhost:8080`. Environment is auto-populated from Lovable Cloud — no `.env` editing required.

## Tests

```sh
npx vitest run
```

## Project layout

- `src/pages/` — route components (Dashboard, Prospects, Distribution, Content, Settings, …)
- `src/hooks/` — React Query data hooks
- `src/components/` — UI and feature components
- `supabase/functions/` — Edge Functions (Deno)
- `supabase/migrations/` — schema, RLS, triggers, cron

## Security

- RLS enabled on every user-data table; policies scoped to `auth.uid()`.
- Third-party OAuth tokens stored server-side only.
- Public edge functions (`track-click`, `capture-lead`, `conversion-webhook`) validate input; `conversion-webhook` requires HMAC-SHA256 (`X-Signature: sha256=<hex>`) against `CONVERSION_WEBHOOK_SECRET`.
- Service role key is never shipped to the client.

## Deploying / publishing

This project deploys via Lovable. Open the project in Lovable and click **Publish**, or connect a custom domain in **Project Settings → Domains**.

## License

Proprietary — all rights reserved.
