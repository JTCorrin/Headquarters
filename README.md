# Headquarters

Multi-tenant CRM for contacts, leads, clients, quotes, invoices, bills, payments, products, projects, meetings, email, campaigns, and playbooks.

Built with **SvelteKit** and **Supabase** (Auth, Postgres, Storage, Edge Functions). The product API is `/api/v1`, served by the `api-v1` Edge Function and proxied same-origin by the SvelteKit app.

## Stack

- SvelteKit 2 + Svelte 5 + Vite + Tailwind 4, built with `@sveltejs/adapter-node`
- Supabase local stack via the [Supabase CLI](https://supabase.com/docs/guides/cli) (Docker)
- Edge Functions (Deno) in `supabase/functions`: `api-v1` (router) plus cron workers `mailbox-sync`, `jobs-recurring-invoices`, `jobs-playbooks`, `jobs-campaigns`
- Postgres schema and RLS in `supabase/migrations`, pgTAP tests in `supabase/tests`

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with the daemon running
- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10 — the exact version is pinned in `package.json` (`packageManager`). Run `corepack enable` once and Corepack picks it up automatically instead of whatever pnpm is installed globally.
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) 2.111 or newer (CI pins 2.111.0)
- Optional: [Deno](https://deno.com/) 2.x, only for linting/testing Edge Functions (CI uses 2.9.4)

## Getting started

```sh
git clone https://github.com/JTCorrin/Headquarters.git
cd Headquarters
corepack enable
./scripts/dev-up.sh
```

`dev-up.sh` is idempotent. It:

1. checks prerequisites and runs `pnpm install` if `node_modules` is missing;
2. runs `supabase start`, and `supabase db reset --local` (migrations + `supabase/seed.sql`) on the first run or with `--reset`;
3. creates `.env` from `.env.example` if needed and writes `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` from `supabase status` (no hand-copying; the service-role key is never written);
4. runs `supabase functions serve` in the background (log in `.local/api-v1.log`);
5. starts the app with `pnpm dev --host 127.0.0.1`.

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and sign up. Local Auth requires email confirmation: open the local mail inbox at [http://127.0.0.1:54324](http://127.0.0.1:54324), click the confirmation link, then create an organisation in onboarding.

Useful commands:

```sh
pnpm dev:stack                  # same as ./scripts/dev-up.sh
pnpm dev:stack:reset            # wipe local DB (migrations + seed), then start
./scripts/dev-up.sh --no-app    # backend only; run `pnpm dev --host 127.0.0.1` yourself
./scripts/dev-status.sh         # URLs and a truncated anon key
./scripts/dev-down.sh           # stop functions serve + `supabase stop` (data volumes kept)
```

### Local URLs

| Service      | URL                    |
| ------------ | ---------------------- |
| App          | http://127.0.0.1:5173  |
| Supabase API | http://127.0.0.1:54321 |
| Studio       | http://127.0.0.1:54323 |
| Mail inbox   | http://127.0.0.1:54324 |
| Postgres     | 127.0.0.1:54322        |

### Configuration and optional integrations

Core CRM works with the defaults written by `dev-up.sh`. [`.env.example`](.env.example) documents every environment variable the app and functions read, grouped by where it belongs:

- **Root `.env`** — SvelteKit app settings (`PUBLIC_*`, `API_V1_UPSTREAM`, hosted-billing keys) and Supabase CLI `env()` values such as Google/Azure login credentials. `dev-up.sh` never overwrites values you set.
- **`supabase/functions/.env`** — Edge Function secrets (mailbox and calendar OAuth, cron secrets, `API_CORS_ORIGIN`, `APP_BASE_URL`). The CLI loads this file on `supabase start` / `supabase functions serve`; the root `.env` is not visible to functions. Restart `dev-up.sh` after editing it.

Social login also needs `enabled = true` for the provider in `supabase/config.toml` and the provider listed in `PUBLIC_AUTH_PROVIDERS`.

## Testing

```sh
pnpm check                      # svelte-check (type checking)
pnpm lint                       # prettier --check + eslint
pnpm exec playwright install chromium   # once; Vitest browser projects use it
pnpm test:unit                  # Vitest (watch); add --run for a single pass
pnpm exec vitest run --project server   # or: client, storybook
pnpm test:e2e                   # Playwright (see below)
pnpm test                       # unit (single run) + e2e
```

Database and Edge Function tests (local stack must be running):

```sh
supabase db reset --local       # fresh schema + seed
supabase test db                # pgTAP suite in supabase/tests
supabase db lint --local --schema public,private --level warning
./scripts/quote_document_lock_interleave.sh supabase_db_headquarters
./scripts/contact_primary_takeover_concurrency.sh supabase_db_headquarters

cd supabase/functions/api-v1
deno fmt --check . ../_shared && deno lint . ../_shared
deno check index.ts http.test.ts
deno test --no-check
```

The two concurrency scripts take the local Postgres container name (`supabase_db_<project_id>`, where `project_id` comes from `supabase/config.toml`); they create and clean up their own throwaway users and organisations.

**End-to-end tests.** `pnpm test:e2e` builds the app and serves it with `vite preview` on port 4173. Without extra configuration only the self-contained smoke specs run; the CRM journey specs skip. To run the journeys, point Playwright at a running deployment whose Supabase Auth has email confirmations **disabled** (each run signs up fresh users):

```sh
E2E_BASE_URL=https://staging.example.com \
E2E_SUPABASE_URL=https://<project>.supabase.co \
E2E_SUPABASE_ANON_KEY=<anon key> \
pnpm exec playwright test
```

**Storybook.** `pnpm storybook` serves on [http://localhost:6006](http://localhost:6006); `pnpm build-storybook` writes `storybook-static/`.

## Deployment (self-hosting)

The app is a Node server (adapter-node) in front of a Supabase project. Hosted Supabase and self-hosted Supabase both work; the steps below use the Supabase CLI against a hosted project.

### 1. Database

```sh
supabase login
supabase link --project-ref <project-ref>
supabase db push                # apply supabase/migrations to the linked project
```

Never run `supabase db reset` against a hosted project, and never edit a hosted schema by hand without a matching migration. Migrations enable `pg_cron`, `pg_net`, and Vault use where needed.

In the Supabase dashboard, set Auth **Site URL** to your app origin and add `<app origin>/auth/callback` to the redirect URLs. Copy the email templates from `supabase/templates/` into Auth → Email Templates if you want the branded versions. Avoid `supabase config push` with the committed `config.toml`: it carries local-only values such as the `127.0.0.1` site URL.

### 2. Edge Functions and secrets

```sh
supabase functions deploy       # deploys every function; verify_jwt settings come from config.toml
supabase secrets set --env-file ./supabase/functions/.env.production
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. Set at least `API_CORS_ORIGIN` and `APP_BASE_URL` to your app origin, plus any OAuth and cron secrets you use (see section 3 of `.env.example`). Never enable the `*_STAGING_STUB` / `AI_COMPLETION_STUB` flags in production.

### 3. Scheduled jobs

The cron workers have `verify_jwt = false` and authenticate with a shared-secret header instead:

- **`mailbox-sync`** — a migration schedules it every minute with `pg_cron` + `pg_net`. It needs a Vault secret named `project_url` holding your project URL, e.g. `select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');`. The header secret (`mailbox_sync_secret`) is generated in Vault by the migration.
- **`jobs-campaigns`** — run `SUPABASE_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<token> node scripts/configure-campaign-scheduler.mjs` once. It stores a generated secret in Vault and as the `CAMPAIGNS_CRON_SECRET` function secret, and schedules a per-minute `pg_cron` job. Re-running reuses the existing secret.
- **`jobs-recurring-invoices`** — a migration schedules it every 5 minutes with `pg_cron` + `pg_net`. It needs a Vault secret named `project_url` holding your project URL (same as mailbox-sync). The header secret (`recurring_invoices_cron_secret`) is generated in Vault by the migration; the Edge Function accepts that vault secret via `verify_recurring_invoices_cron_secret`, or `RECURRING_INVOICES_CRON_SECRET` / service-role bearer for self-hosted wrappers.
- **`jobs-playbooks`** — schedule yourself (every 1–5 minutes), e.g. with `pg_cron` + `pg_net` or any external scheduler:

  ```sh
  curl -fsS -X POST https://<project-ref>.supabase.co/functions/v1/jobs-playbooks \
    -H "x-playbooks-cron-secret: $PLAYBOOKS_CRON_SECRET"
  ```

### 4. App server

```sh
pnpm install --frozen-lockfile
pnpm build
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
PUBLIC_SUPABASE_ANON_KEY=<anon key> \
ORIGIN=https://crm.example.com \
PORT=3000 \
pnpm start                      # node build/index.js
```

Public settings are read at runtime (`$env/dynamic/*`), so the same build can be promoted between environments. `ORIGIN` is required for SvelteKit's form-action CSRF check; behind a reverse proxy you can use `PROTOCOL_HEADER` / `HOST_HEADER` instead (see the [adapter-node docs](https://svelte.dev/docs/kit/adapter-node)). `node build/index.js` does not load `.env` itself; use your process manager's environment or `node --env-file=.env build/index.js`.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Headquarters is **source-available** under the [Elastic License 2.0](LICENSE) (SPDX: `Elastic-2.0`). It is not an OSI-approved open source license.

**Allowed:** using, copying, modifying, and self-hosting the software, including for a business's own internal operations, as long as you keep the license and copyright notices.

**Not allowed:** providing the software to third parties as a hosted or managed service that gives them access to a substantial set of its features, circumventing license-key functionality, or removing licensing notices.

For hosted offerings or partner/reseller arrangements, contact the copyright holder.

## More docs

- Backend, API contract, and campaign scheduling: [`supabase/README.md`](supabase/README.md)
