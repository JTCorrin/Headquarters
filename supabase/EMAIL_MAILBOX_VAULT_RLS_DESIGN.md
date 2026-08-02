# Wave A deliverable #0 — Vault / `secret_ref` + ownership RLS

**Tip base:** `d6c7f2b4f387063e0b791090bfb15b01fe22393e`  
**Challenge:** Buzz nest `RESEARCH/EMAIL_AI_BE_VAULT_RLS_CHALLENGE.md`  
**Migration:** `migrations/20260802140000_email_mailbox_org_ai_foundation.sql`

## Secret store (chosen path)

Supabase Vault (`[db.vault]` / `vault.secrets`) is **not enabled** in `config.toml` on this tip. Wave A ships the documented fallback:

| Piece | Location | Notes |
|-------|----------|-------|
| Ciphertext rows | `private.integration_secrets` | `id`, `ciphertext` (pgp), `key_id`, timestamps |
| Symmetric key | `private.encryption_keys` | Seeded once as `v1` via `gen_random_bytes(32)` |
| Encrypt / decrypt / delete | `private.store_secret` / `private.read_secret` / `private.delete_secret` | `SECURITY DEFINER`, `search_path = ''`; **no** `GRANT` to `authenticated` / `anon` |
| Opaque pointer | `mailbox_accounts.secret_ref` / `integrations.secret_ref` | UUID of `private.integration_secrets.id` |

Public API and authenticated PostgREST **never** select `secret_ref` or secret plaintext. Column grants on mailbox/integrations omit `secret_ref`. Edge handlers call security-definer RPCs that accept write-only password/API key parameters and return status-only shapes (`credentials_configured`, never the ref or secret).

Rotate: new `store_secret` → update ref → `delete_secret` on the previous id. Disconnect: delete secret then clear ref / soft-delete row.

`integrations.config` is non-secret jsonb only (provider display metadata). Connect/test request bodies are not logged.

## RLS / ownership

| Table | SELECT model |
|-------|----------------|
| `mailbox_accounts` | **Owner membership only** (`membership_id = private.current_membership_id(org_id)`). Not contacts-style org SELECT. Billing blocked at API. |
| `email_threads` / `email_messages` | Owner membership by default (`owner_membership_id`). |
| `email_message_links` | Owners see their links; teammates see rows only when `link_reason = 'timeline_share'` (and org role allows entity read). |
| Teammate message body | Granted only via `timeline_share` (full body per Joe lock). `address_match` does **not** grant body. |
| `integrations` | Status-visible to owner/admin/member/readonly; connect/disconnect **owner only** (Wave B tighten; API + security-definer RPC). |
| `ai_suggestions` | Org member SELECT (non-billing); generate/use/discard via security-definer RPCs for owner/admin/member. Use never sends mail. |

## Sync bounds (Wave B live)

Defaults on `mailbox_accounts`: lookback **14d**, max **100** msgs/run, body **256 KiB**, attachments metadata-only (flag), exact-address match (ingest rule), one sync lease (`claim_mailbox_sync_lease` / `release_mailbox_sync_lease`), auth circuit-breaker after **3** consecutive failures → `status = error`. Cron entry: `mailbox-sync` Edge Function (service role).

## API surface (`X-Org-Id` required)

- `GET/PUT/DELETE /api/v1/me/mailbox` + `POST /api/v1/me/mailbox/test` + `POST /api/v1/me/mailbox/sync`
- `GET /api/v1/integrations` + `PUT/DELETE /api/v1/integrations/ai/{provider}` (`openai` \| `anthropic` \| `google` \| `openrouter`) — writes **owner only**
- `GET /api/v1/organisation/configuration` + `PATCH` — **owner only** (Wave B)
- `GET /api/v1/{contacts\|leads\|clients}/{id}/email-messages` — owner body + `timeline_share` teammate full body
- `POST /api/v1/email-messages/{id}/share` → `timeline_share` + timeline email card (full body)
- `POST /api/v1/ai-suggestions/email-reply` + `…/{id}/use` + `…/{id}/discard` — never send on use

Wave A/B verify does **not** open live IMAP/SMTP or provider HTTP for MVP; Wave B sync skeleton ingests synthetic mail for `*.example.test` hosts. Draft response uses a local draft when an org AI integration is connected (provider HTTP follow-on).
