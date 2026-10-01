# Contributing to Headquarters

Thanks for your interest. Headquarters is source-available under the [Elastic License 2.0](LICENSE); by submitting a contribution you agree it is licensed under the same terms.

## Development setup

Follow [Getting started](README.md#getting-started) in the README. In short: install Docker, Node.js 22+, the Supabase CLI, run `corepack enable`, then `./scripts/dev-up.sh`.

## Branches and pull requests

- Branch from `dev` and open pull requests against `dev`. Maintainers promote `dev` to `main`.
- Keep pull requests focused on one change, and describe what changed and how you tested it.
- For larger features or behaviour changes, open an issue first to agree on the approach.
- CI (`.github/workflows/ci.yml`) must pass before merge.

## Checks to run before pushing

```sh
pnpm format                         # prettier --write
pnpm lint                           # prettier --check + eslint
pnpm check                          # svelte-check
pnpm exec vitest run                # unit + component tests
supabase test db                    # pgTAP (local stack running)
```

If you touched Edge Functions, also run from `supabase/functions/api-v1`:

```sh
deno fmt --check . ../_shared && deno lint . ../_shared
deno check index.ts http.test.ts && deno test --no-check
```

See [Testing](README.md#testing) for end-to-end tests and Storybook.

## Database migrations

- Every schema change is a new file in `supabase/migrations/` (`supabase migration new <name>`). Never edit or rename a migration that has been merged; write a follow-up migration instead.
- Migrations must replay cleanly from zero: run `supabase db reset --local` and `supabase test db` before pushing.
- New tables need RLS enabled with organisation-scoped policies, plus pgTAP coverage in `supabase/tests/`.
- Never change a hosted database through Studio without a matching committed migration.

## Secrets

Never commit `.env` files, API keys, or the Supabase service-role key. Add new configuration to `.env.example` with a short description of where it is read.

## Reporting security issues

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
