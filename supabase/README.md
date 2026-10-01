# Headquarters Supabase backend

The stable product contract is `/api/v1`. Supabase exposes the router natively under
`/functions/v1/api-v1`; production can map a custom domain to the cleaner product path.

For setting up the local stack, running tests, and deploying, see the
[root README](../README.md).

## Core foundation

The schema has grown well beyond this list (invoices, bills, payments, email, meetings,
projects, campaigns, playbooks, …); these are the building blocks everything else follows.

- Supabase Auth-backed `profiles`
- `organisations` and active `memberships`
- transactional `create_organisation(...)` onboarding RPC
- organisation-scoped `contacts` with soft deletion and optimistic concurrency
- organisation-scoped `leads`, `clients`, and `client_contacts`
- thin append-only `timeline_events` for domain activity cards
- transactional `convert_lead(...)` RPC (idempotent; emits conversion timeline events)
- RLS role gates that exclude `billing` users from contacts/leads and write access to clients
- authenticated `api-v1` Edge Function with Contacts, Leads, Clients, Products, Quotes draft CRUD
- concurrency-safe `document_sequences` and transactional quote draft RPCs

Migrations are the source of truth. Do not edit a linked database in Studio and leave the change
uncommitted, and never edit a migration that has already been applied anywhere — add a new one.

## Local workflow

```sh
supabase start
supabase db reset --local
supabase test db
supabase functions serve        # serves every function; secrets from supabase/functions/.env

cd supabase/functions/api-v1
deno fmt --check . ../_shared
deno lint . ../_shared
deno check index.ts http.test.ts
deno test --no-check
```

Generate database types after a successful reset (CI checks that generation succeeds):

```sh
supabase gen types typescript --local > /tmp/database.generated.ts
```

The Edge Functions currently use a hand-maintained subset of these types in
`functions/_shared/database.ts`.

## Personal mailbox OAuth

Outlook / Microsoft 365 and Gmail connect via OAuth in **My settings → Mail**.
See [`MAILBOX_OAUTH_CONNECT_PLAN.md`](./MAILBOX_OAUTH_CONNECT_PLAN.md).

Edge secrets (separate from Supabase Auth social login and calendar OAuth):

- `MICROSOFT_MAILBOX_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`
- `GOOGLE_MAILBOX_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`
- `MAILBOX_OAUTH_STAGING_STUB` (optional; stub code exchange for CI)

Redirect URIs must match the app route `/settings/mailbox-oauth/callback`.
Azure app needs delegated `IMAP.AccessAsUser.All` + `SMTP.Send`; Google needs
`https://mail.google.com/` scope.

## Request contract

Every business request requires:

```http
Authorization: Bearer <supabase-user-jwt>
apikey: <supabase-publishable-key>
X-Org-Id: <organisation-uuid>
```

The routes below illustrate the conventions; they are not exhaustive. The router in
`functions/api-v1/index.ts` is the source of truth.

Contacts routes:

- `GET /api/v1/contacts?limit=50&cursor=...`
- `POST /api/v1/contacts`
- `GET /api/v1/contacts/{contact_id}`
- `PATCH /api/v1/contacts/{contact_id}`
- `DELETE /api/v1/contacts/{contact_id}`

Leads routes:

- `GET /api/v1/leads?limit=50&cursor=...&stage=...`
- `POST /api/v1/leads`
- `GET /api/v1/leads/{lead_id}`
- `PATCH /api/v1/leads/{lead_id}`
- `DELETE /api/v1/leads/{lead_id}`
- `POST /api/v1/leads/{lead_id}/convert` — optional JSON `{ "client_name", "client_status" }`

Clients routes:

- `GET /api/v1/clients?limit=50&cursor=...&status=...`
- `POST /api/v1/clients`
- `GET /api/v1/clients/{client_id}`
- `PATCH /api/v1/clients/{client_id}`
- `DELETE /api/v1/clients/{client_id}`

Product catalog routes:

- `GET /api/v1/product-categories?limit=50&cursor=...`
- `POST /api/v1/product-categories`
- `GET /api/v1/product-categories/{category_id}`
- `PATCH /api/v1/product-categories/{category_id}`
- `DELETE /api/v1/product-categories/{category_id}`
- `GET /api/v1/products?limit=50&cursor=...&status=...`
- `POST /api/v1/products`
- `GET /api/v1/products/{product_id}`
- `PATCH /api/v1/products/{product_id}`
- `DELETE /api/v1/products/{product_id}`
- `POST /api/v1/products/{product_id}/adjust-stock` — requires `Idempotency-Key`; JSON `{ "quantity_delta", "reason?", "note?", "occurred_at?" }`

Quotes draft routes:

- `GET /api/v1/quotes?limit=50&cursor=...&status=draft`
- `POST /api/v1/quotes` — JSON header fields + `lines[]`; allocates `Q-####` number; server totals
- `GET /api/v1/quotes/{quote_id}` — quote + nested `lines`
- `PATCH /api/v1/quotes/{quote_id}` — `If-Match` required; optional atomic `lines` replacement
- `DELETE /api/v1/quotes/{quote_id}` — soft delete draft; `If-Match` required

`PATCH` and `DELETE` require the latest strong numeric ETag (for example, `If-Match: "3"`).
Stale versions return `412 Precondition Failed`. Deletes are soft deletes. Marking a lead as `won`
must go through `/convert`. Stock quantity changes only through `/adjust-stock`; clients must never
send or trust an `org_id` in a JSON body.

## Campaign sending

Deploy `api-v1` and `jobs-campaigns` after applying the campaign migrations. Deploying the
worker alone does not schedule it. With Supabase Cron, pg_net and Vault enabled, run
`node scripts/configure-campaign-scheduler.mjs` from the repository root with
`SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` in the environment. It configures a
minute-by-minute job and stores the worker secret in Vault; rerunning reuses that secret.
Self-hosted deployments may instead call `jobs-campaigns` from their own scheduler with
`x-campaigns-cron-secret` matching `CAMPAIGNS_CRON_SECRET`.

`GET /api/v1/campaigns/{id}/activity` returns the latest 100 campaign events. The page
refreshes active campaigns automatically. `POST /api/v1/campaigns/{id}/resend` requires
`If-Match` and creates an editable draft from a finished/cancelled campaign; launching
the new draft resolves its audience afresh. It never clears earlier delivery history.
Interrupted SMTP attempts are marked as having an unknown outcome instead of automatically
being sent twice. Check the sending mailbox before deliberately resending those messages.
