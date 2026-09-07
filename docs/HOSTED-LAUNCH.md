# Hosted launch changes

The database remains in self-host mode by default. The Headquarters billing service enables hosted
mode through `configure_hosted_billing(true)` at startup. This RPC is service-role-only; users cannot
disable enforcement. Deploy the new migration before the billing/API changes.

Hosted mode requires a claimed active/trialing/past-due subscription for one organisation. The original
payer may use one unassigned subscription to create an organisation or attach it to an existing
organisation they own. Included active members inherit the subscription. Tenant RLS, role helpers,
write triggers and the Edge API gate enforce access; API keys do not bypass it. Canceled/unpaid/paused
subscriptions lose access. `past_due` currently remains accessible while Stripe retries collection;
configure a finite retry policy that transitions to unpaid or canceled after exhaustion.

The initial plan supports three active members, including capacity reserved for pending invitations.
No additional-seat charges are offered. Ownership transfer inside CRM does not transfer Stripe billing
ownership; the original payer manages subscription payments in `/billing`.

## Release sequence

1. CI must replay all migrations and pass pgTAP, Deno, frontend, and browser checks.
2. Apply `20260907140000_hosted_billing_enforcement.sql` to the intended hosted database.
3. Configure a dedicated Stripe portal with invoice history, card updates and cancellation at period
   end. Set billing `STRIPE_PORTAL_CONFIGURATION` to its ID; billing intentionally refuses to start
   without that configuration or its database migration.
4. Deploy billing with public `CRM_URL=https://app.headquarters-crm.com` and
   `LANDING_URL=https://headquarters-crm.com`, allowing both in CORS. Existing Headquarters Railway
   URLs are recognized as aliases by billing.
5. Deploy CRM/API. Set `PUBLIC_HOSTED_BILLING=true`, `PUBLIC_BILLING_API_URL` and
   `BILLING_CLAIM_SECRET`. Set **`ORIGIN=https://app.headquarters-crm.com`** for Node-adapter server
   actions behind Railway's proxy, and align `APP_BASE_URL` and `PUBLIC_LANDING_URL` with the public
   app and marketing origins. Register the public auth callback in Supabase.
6. Deploy marketing. It advertises £10/month for one organisation with up to three seats.
7. Complete the real Stripe test-mode journey on an isolated database before accepting customers.

The billing service's `/v1/claim`, `/v1/recover` and `/v1/portal` now require the authenticated user's
bearer token as well as the shared secret. CRM supplies both; the service resolves the actual user.
Account confirmation/sign-in links retain a billing return path with the claim and checkout reference.
Expired paid claims can create an account and recover an existing purchase without another checkout.
The portal remains reachable when a subscription has ended.

If existing customers have paid but their subscription has no organisation binding, the payer can
attach it under `/billing`. Do not enable the hosted database gate before planning that transition
for existing users. A plan cannot be attached to an organisation with more than three active members
and pending invitations.

## Still required before marketing

- Confirm legal operator/address, public support/privacy contact, refund policy and retention/deletion
  periods, then replace the marketing Privacy/Terms placeholders with the actual policies.
- Supply a Stripe test key and matching test price and configure a test webhook against an isolated
  database. The committed unit/browser tests never submit live payments.
- Configure a Headquarters-specific Stripe portal and complete the environment steps above.
- Verify backup restoration and scheduled mailbox/playbook/invoice jobs in the target environment.

`PUBLIC_AUTH_PROVIDERS` is a comma-separated list (`google,azure,sso`). Leave it empty unless those
providers are enabled in Supabase. This prevents showing nonfunctional login options.

Existing broad formatting/ESLint debt remains a report-only CI check; the launch changes are formatted
and checked separately. Do not mass-format Deno sources with the frontend Prettier configuration.
