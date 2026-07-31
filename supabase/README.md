# Headquarters Supabase backend

The stable product contract is `/api/v1`. Supabase exposes the router natively under
`/functions/v1/api-v1`; production can map a custom domain to the cleaner product path.

## Foundation included

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

The migration is the source of truth. Do not edit a linked database in Studio and leave the change
uncommitted.

## Local workflow

```sh
supabase start
supabase db reset
supabase test db supabase/tests --local
deno fmt --check supabase/functions/api-v1
deno lint supabase/functions/api-v1
deno check supabase/functions/api-v1/index.ts
deno test supabase/functions/api-v1
supabase functions serve api-v1
```

Generate database types after a successful reset:

```sh
supabase gen types typescript --local > src/lib/types/database.generated.ts
```

The Edge Function currently carries a bootstrap subset in `functions/_shared/database.ts`. Replace
that subset with generated types in the first Docker-capable follow-up and verify generation in CI.

## Request contract

Every business request requires:

```http
Authorization: Bearer <supabase-user-jwt>
apikey: <supabase-publishable-key>
X-Org-Id: <organisation-uuid>
```

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

Send/accept/create-invoice commands are intentionally omitted from this foundation slice.

`PATCH` and `DELETE` require the latest strong numeric ETag (for example, `If-Match: "3"`).
Stale versions return `412 Precondition Failed`. Deletes are soft deletes. Marking a lead as `won`
must go through `/convert`. Stock quantity changes only through `/adjust-stock`; clients must never
send or trust an `org_id` in a JSON body.
