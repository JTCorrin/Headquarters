-- Hosted SaaS billing entitlements (Stripe). Unused when PUBLIC_HOSTED_BILLING is off.
-- Written only by the Railway billing service via the service_role key.

create table public.hosted_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text,
  status text not null default 'pending_checkout',
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  claim_token_hash text not null,
  claim_expires_at timestamptz not null,
  claimed_at timestamptz,
  user_id uuid references public.profiles (id) on delete set null,
  org_id uuid references public.organisations (id) on delete set null,
  seats_included integer not null default 3 check (seats_included > 0),
  constraint hosted_subscriptions_status_check
    check (
      status in (
        'pending_checkout',
        'active',
        'past_due',
        'canceled',
        'unpaid',
        'incomplete',
        'incomplete_expired',
        'trialing',
        'paused'
      )
    ),
  constraint hosted_subscriptions_email_format
    check (
      email is null
      or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    ),
  constraint hosted_subscriptions_claim_token_hash_sha256
    check (claim_token_hash ~ '^[0-9a-f]{64}$'),
  constraint hosted_subscriptions_claim_token_hash_key unique (claim_token_hash),
  constraint hosted_subscriptions_stripe_checkout_session_id_key
    unique (stripe_checkout_session_id),
  constraint hosted_subscriptions_stripe_subscription_id_key
    unique (stripe_subscription_id),
  constraint hosted_subscriptions_claimed_user_check
    check (
      (claimed_at is null and user_id is null)
      or (claimed_at is not null and user_id is not null)
    )
);

create index hosted_subscriptions_email_idx
  on public.hosted_subscriptions (lower(email));

create index hosted_subscriptions_user_id_idx
  on public.hosted_subscriptions (user_id)
  where user_id is not null;

create index hosted_subscriptions_status_idx
  on public.hosted_subscriptions (status);

create index hosted_subscriptions_stripe_customer_id_idx
  on public.hosted_subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

comment on table public.hosted_subscriptions is
  'Stripe-backed hosted plan entitlements + one-time signup claim tokens. Service-role only.';

create trigger hosted_subscriptions_set_updated_at
before update on public.hosted_subscriptions
for each row execute function private.set_updated_at();

alter table public.hosted_subscriptions enable row level security;

-- No policies for anon/authenticated: clients never touch this table directly.
revoke all on table public.hosted_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.hosted_subscriptions to service_role;

-- Lookup for CRM claim-aware signup (service_role / billing service).
create or replace function public.lookup_hosted_claim(p_claim_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  row public.hosted_subscriptions;
begin
  if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into row
  from public.hosted_subscriptions
  where hosted_subscriptions.claim_token_hash = p_claim_token_hash;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', row.id,
    'email', row.email,
    'status', row.status,
    'claim_expires_at', row.claim_expires_at,
    'claimed_at', row.claimed_at,
    'user_id', row.user_id,
    'seats_included', row.seats_included
  );
end;
$$;

revoke all on function public.lookup_hosted_claim(text)
  from public, anon, authenticated;
grant execute on function public.lookup_hosted_claim(text) to service_role;

-- Active entitlement for a user (hosted gate).
create or replace function public.hosted_entitlement_for_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  row public.hosted_subscriptions;
begin
  if p_user_id is null then
    return null;
  end if;

  select * into row
  from public.hosted_subscriptions
  where hosted_subscriptions.user_id = p_user_id
    and hosted_subscriptions.status in ('active', 'trialing', 'past_due')
  order by hosted_subscriptions.claimed_at desc nulls last
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', row.id,
    'status', row.status,
    'email', row.email,
    'seats_included', row.seats_included,
    'org_id', row.org_id
  );
end;
$$;

revoke all on function public.hosted_entitlement_for_user(uuid)
  from public, anon, authenticated;
grant execute on function public.hosted_entitlement_for_user(uuid) to service_role;
