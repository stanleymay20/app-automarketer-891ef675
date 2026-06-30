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

## Quantivis EXIST LOI Outreach campaign

AutoMarketer includes a draft-only campaign template for Quantivis:

- Campaign: `Quantivis EXIST LOI Outreach`
- App route: `/campaigns/quantivis-loi`
- Purpose: prepare reviewable LinkedIn/email/LOI drafts for EXIST letter-of-intent outreach.

This campaign is intentionally manual. It must not auto-send LinkedIn or email messages.

### Target audience

Use the campaign for:

- German manufacturing companies
- logistics companies
- retail/distribution companies
- AI governance/compliance consultancies

### Manual workflow for Stanley

1. Open AutoMarketer and go to `Quantivis LOI` in the Campaigns section.
2. Build a target-company sheet with the CSV columns below.
3. Draft or copy outreach from the page.
4. Review every message manually before sending.
5. Send only between `09:00` and `17:00` Germany time.
6. Keep daily draft volume under:
   - 20 LinkedIn drafts/day
   - 10 email drafts/day
7. Update `outreach_status` after each manual contact.
8. Update `loi_status` only after explicit prospect feedback.

### CSV import/export format

Use this exact header order:

```csv
company_name,sector,decision_maker_role,linkedin_url,email,reason_they_fit_quantivis,outreach_status,loi_status
```

Example:

```csv
company_name,sector,decision_maker_role,linkedin_url,email,reason_they_fit_quantivis,outreach_status,loi_status
Muster Maschinenbau GmbH,German manufacturing,COO / Head of Operations / AI Transformation Lead,https://www.linkedin.com/company/example,first.last@example.de,"Manufacturing operator likely evaluating AI governance, operational risk, and evidence-backed transformation decisions.",drafted,not_requested
```

Recommended status values:

- `outreach_status`: `not_started`, `drafted`, `reviewed`, `sent_manually`, `replied`, `declined`
- `loi_status`: `not_requested`, `requested`, `draft_sent`, `signed`, `declined`

### Campaign goals

- 30 companies contacted
- 10 replies
- 5 discovery calls
- 2 pilot discussions
- 1 signed LOI

### Safety rule

No automatic sending is approved for this campaign. The page is a preparation and review surface only.

## Bulk LOI Outreach (up to 200)

For broader outreach beyond the manual Quantivis flow, AutoMarketer ships a draft-only bulk
generator that scales personalization to up to 200 prospects per run.

- App route: `/campaigns/bulk-loi`
- Edge function: `supabase/functions/bulk-loi-outreach`
- Channel: email (Resend), customer-category prospects only by default.

### What it does

1. Step 1 (in the UI) — runs `discover-prospects` against your offering to grow the customer
   prospect pool. You may run this several times until the eligible count reaches your target.
2. Step 2 — calls `bulk-loi-outreach`, which pulls eligible prospects (have `contact_email`,
   no prior `prospect_messages` row, not dismissed) and, for each, asks the Lovable AI gateway
   to draft a personalized cold email + non-binding LOI ask.
3. Drafts are inserted into `prospect_messages` with `status = 'pending_approval'`. **Nothing is
   sent.** The existing `send-outreach` function still enforces a hard per-message approval gate
   (`approved: true` required); the UI exposes an *Approve & send* button per draft.

### Safety rules (do not bypass)

- No bulk auto-send. Every email requires a per-row click. The `send-outreach` hard gate refuses
  to call Resend without `approved: true`.
- The bulk function is rate-limited to 2 runs / 10 minutes per user to stop accidental loops.
- LinkedIn auto-messaging is not exposed by this campaign — it violates LinkedIn ToS.
- Outbound email volume should still respect your sending domain warm-up and Resend daily limits.
  Spacing approvals over several days reduces spam-folder risk and stays inside CAN-SPAM / GDPR
  expectations for cold B2B email (include sender identity and an unsubscribe path in the draft
  body when sending to EU recipients).
- The campaign is for prospects whose pain your offering plausibly solves. Do not generate drafts
  for unrelated companies just to hit the 200 number.

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
