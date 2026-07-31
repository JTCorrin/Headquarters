# Headquarters Supabase backend

The stable product contract is `/api/v1`. Supabase exposes the router natively under
`/functions/v1/api-v1`; production can map a custom domain to the cleaner product path.

## Foundation included

- Supabase Auth-backed `profiles`
- `organisations` and active `memberships`
- transactional `create_organisation(...)` onboarding RPC
- organisation-scoped `contacts` with soft deletion and optimistic concurrency
- RLS role gates that exclude `billing` users from contact data
- authenticated `api-v1` Edge Function with Contacts CRUD

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

`PATCH` and `DELETE` require the latest numeric ETag in `If-Match`. Deletes are soft deletes.
Clients must never send or trust an `org_id` in a JSON body; the router derives it from the validated
header and RLS membership.
