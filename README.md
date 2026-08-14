# Headquarters

Multi-tenant CRM for contacts, leads, clients, quotes, invoices, bills, payments, products, projects, meetings, email, and playbooks.

Built with **SvelteKit** and **Supabase** (Auth, Postgres, Edge Functions). The product API is `/api/v1`.

## Stack

- SvelteKit + Vite + Tailwind
- Supabase local stack via the [Supabase CLI](https://supabase.com/docs/guides/cli) (Docker)
- Edge Function router: `supabase/functions/api-v1`

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (daemon running)
- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10 (`corepack enable && corepack prepare pnpm@10 --activate`)
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) ~2.111

## Getting started

```sh
git clone <repo-url> crm-project
cd crm-project
./scripts/dev-up.sh
```

The script starts Supabase (Docker), applies migrations on first run, writes `.env` from `supabase status` (no hand-copying of keys), serves `api-v1`, and runs the app.

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173), sign up, and create an organisation via onboarding.

Useful commands:

```sh
pnpm dev:stack          # same as ./scripts/dev-up.sh
pnpm dev:stack:reset    # reset DB (migrations + seed), then start
./scripts/dev-status.sh # URLs and public key summary
./scripts/dev-down.sh   # stop api-v1 serve + supabase stop
```

Backend only (no Vite): `./scripts/dev-up.sh --no-app`, then `pnpm dev` in another terminal.

## Local URLs

| Service        | URL                          |
| -------------- | ---------------------------- |
| App            | http://127.0.0.1:5173        |
| Supabase API   | http://127.0.0.1:54321       |
| Studio         | http://127.0.0.1:54323       |

## Optional integrations

Core CRM works with the defaults written by `dev-up.sh`. For Google/Azure login, mailbox OAuth, calendar, or cron jobs, copy values into `.env` using [`.env.example`](.env.example) as the guide. Those secrets are never overwritten by the bootstrap script once set.

## License

This project is **source-available** under the [Elastic License 2.0](LICENSE) (not OSI “open source”).

**Allowed:** use, modify, and self-host — including for a business’s own internal operations — as long as you keep copyright and license notices.

**Not allowed:** offering Headquarters (or a substantial set of its features) to third parties as a hosted or managed service without a separate license.

Hosted offerings and partner/reseller arrangements: contact the copyright holder.

## Deeper docs

- Backend, API contract, and local Supabase workflow: [`supabase/README.md`](supabase/README.md)
