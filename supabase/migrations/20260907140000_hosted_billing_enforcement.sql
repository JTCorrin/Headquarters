-- Self-hosting stays unrestricted. The hosted billing service enables this private switch.
create table private.hosted_billing_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into private.hosted_billing_config values (true, false);
revoke all on private.hosted_billing_config from public, anon, authenticated;

alter table public.hosted_subscriptions add column stripe_observed_at timestamptz;
create unique index hosted_subscriptions_one_org on public.hosted_subscriptions(org_id)
  where org_id is not null;

create function private.hosted_billing_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select enabled from private.hosted_billing_config where singleton;
$$;
create function public.configure_hosted_billing(p_enabled boolean) returns void
language sql security definer set search_path = '' as $$
  update private.hosted_billing_config set enabled = p_enabled where singleton;
$$;
revoke all on function public.configure_hosted_billing(boolean) from public, anon, authenticated;
grant execute on function public.configure_hosted_billing(boolean) to service_role;

create function private.hosted_org_access(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.hosted_billing_enabled() or exists (
    select 1 from public.hosted_subscriptions
    where org_id = p_org_id and status in ('active', 'trialing', 'past_due') and claimed_at is not null
  );
$$;
create function public.hosted_org_access(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.hosted_org_access(p_org_id);
$$;
revoke all on function public.hosted_org_access(uuid) from public, anon;
grant execute on function public.hosted_org_access(uuid) to authenticated, service_role;
revoke all on function private.hosted_billing_enabled() from public, anon, authenticated;
revoke all on function private.hosted_org_access(uuid) from public, anon;
grant execute on function private.hosted_org_access(uuid) to authenticated;

create or replace function private.has_org_role(target_org_id uuid, allowed_roles text[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.hosted_org_access(target_org_id) and exists (
    select 1 from public.memberships m join public.organisations o on o.id = m.org_id
    where m.org_id = target_org_id and m.user_id = auth.uid() and m.status = 'active'
      and o.deleted_at is null and (allowed_roles is null or m.role = any(allowed_roles))
  );
$$;
create or replace function private.current_membership_id(target_org_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.memberships where org_id = target_org_id and user_id = auth.uid()
    and status = 'active' and private.hosted_org_access(target_org_id) limit 1;
$$;

-- Guard direct Data API access as well as application routes. Existing membership/role policies
-- still apply; this additional restrictive policy cannot grant access to any tenant.
-- Triggers also cover security-definer write RPCs, which bypass RLS but retain auth.uid().
create function private.guard_hosted_tenant_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not private.hosted_billing_enabled() or auth.role() is distinct from 'authenticated' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then target := old.org_id; else target := new.org_id; end if;
  if not private.hosted_org_access(target) then
    raise exception 'An active hosted subscription is required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.org_id is distinct from new.org_id
    and not private.hosted_org_access(old.org_id) then
    raise exception 'An active hosted subscription is required' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.guard_hosted_tenant_write() from public, anon, authenticated;
do $$
declare t record;
begin
  for t in select c.table_name from information_schema.columns c
    join pg_class p on p.relname = c.table_name and p.relnamespace = 'public'::regnamespace
    where c.table_schema = 'public' and c.column_name = 'org_id' and p.relkind = 'r'
      and c.table_name <> 'hosted_subscriptions'
  loop
    execute format('create policy hosted_subscription_required on public.%I as restrictive for all to authenticated using (private.hosted_org_access(org_id)) with check (private.hosted_org_access(org_id))',t.table_name);
    execute format('create trigger hosted_subscription_required before insert or update or delete on public.%I for each row execute function private.guard_hosted_tenant_write()',t.table_name);
  end loop;
end;
$$;
create policy hosted_subscription_required on public.organisations as restrictive for all to authenticated
  using (private.hosted_org_access(id)) with check (private.hosted_org_access(id));

-- One paid subscription creates one organisation. Locking the subscription prevents parallel
-- create_organisation RPC calls from consuming the same entitlement twice.
create function private.bind_new_hosted_organisation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare subscription_id uuid;
begin
  if not private.hosted_billing_enabled() then return new; end if;
  if auth.role() is distinct from 'authenticated' then return new; end if;
  select id into subscription_id from public.hosted_subscriptions
    where user_id = auth.uid() and org_id is null and status in ('active','trialing','past_due')
    order by claimed_at limit 1 for update;
  if subscription_id is null then
    raise exception 'Claim an active hosted subscription before creating an organisation' using errcode = '42501';
  end if;
  update public.hosted_subscriptions set org_id = new.id where id = subscription_id;
  return new;
end;
$$;
create trigger bind_hosted_subscription after insert on public.organisations
  for each row execute function private.bind_new_hosted_organisation();
revoke all on function private.bind_new_hosted_organisation() from public, anon, authenticated;

-- The initial hosted plan supports three seats. Reserve capacity for pending invitations too.
create function private.guard_hosted_seats() returns trigger
language plpgsql security definer set search_path = '' as $$
declare capacity integer; occupied integer; reserved integer; joining_email text;
begin
  if not private.hosted_billing_enabled() then return new; end if;
  perform 1 from public.organisations where id = new.org_id for update;
  select seats_included into capacity from public.hosted_subscriptions
    where org_id = new.org_id and status in ('active','trialing','past_due');
  if tg_table_name = 'memberships' then
    if new.status <> 'active' then return new; end if;
    if tg_op = 'UPDATE' and old.status = 'active' and old.org_id = new.org_id then return new; end if;
    select email into joining_email from auth.users where id = new.user_id;
    select count(*) into occupied from public.memberships where org_id = new.org_id and status = 'active' and id <> new.id;
    select count(*) into reserved from public.organisation_invitations
      where org_id = new.org_id and accepted_at is null and revoked_at is null and expires_at > now()
        and lower(email::text) <> lower(coalesce(joining_email,''));
  else
    if new.accepted_at is not null or new.revoked_at is not null or new.expires_at <= now() then return new; end if;
    select count(*) into occupied from public.memberships where org_id = new.org_id and status = 'active';
    select count(*) into reserved from public.organisation_invitations
      where org_id = new.org_id and id <> new.id and accepted_at is null and revoked_at is null and expires_at > now();
  end if;
  if capacity is null or occupied + reserved >= capacity then
    raise exception 'Hosted seat limit reached (three seats, including pending invitations)' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger hosted_seat_limit before insert or update on public.memberships
  for each row execute function private.guard_hosted_seats();
create trigger hosted_seat_limit before insert or update on public.organisation_invitations
  for each row execute function private.guard_hosted_seats();
revoke all on function private.guard_hosted_seats() from public, anon, authenticated;

create function public.sync_hosted_subscription(
 p_hosted_id uuid, p_subscription_id text, p_customer_id text, p_status text,
 p_observed_at timestamptz, p_checkout_id text default null, p_email text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare sub public.hosted_subscriptions;
begin
 select * into sub from public.hosted_subscriptions where id = p_hosted_id for update;
 if not found then return; end if;
 if sub.stripe_subscription_id is not null and sub.stripe_subscription_id <> p_subscription_id then
   raise exception 'Subscription identity mismatch';
 end if;
 if p_checkout_id is not null and sub.stripe_checkout_session_id is not null and sub.stripe_checkout_session_id <> p_checkout_id then
   raise exception 'Checkout identity mismatch';
 end if;
 if p_observed_at is null or p_status not in ('active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired','paused') then
   raise exception 'Invalid subscription state';
 end if;
 if sub.stripe_observed_at > p_observed_at then return; end if;
 if sub.status in ('canceled','incomplete_expired') and sub.stripe_subscription_id = p_subscription_id and p_status <> sub.status then return; end if;
 update public.hosted_subscriptions set status = p_status, stripe_subscription_id = p_subscription_id,
   stripe_customer_id = p_customer_id, stripe_observed_at = p_observed_at,
   stripe_checkout_session_id = coalesce(p_checkout_id,stripe_checkout_session_id),
   email = coalesce(lower(trim(p_email)),email) where id = p_hosted_id;
end;
$$;
revoke all on function public.sync_hosted_subscription(uuid,text,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.sync_hosted_subscription(uuid,text,text,text,timestamptz,text,text) to service_role;

create or replace function public.lookup_hosted_claim(p_claim_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',id,'email',email,'status',status,'claim_expires_at',claim_expires_at,
   'claimed_at',claimed_at,'user_id',user_id,'seats_included',seats_included,'stripe_checkout_session_id',stripe_checkout_session_id)
 from public.hosted_subscriptions where claim_token_hash = p_claim_token_hash;
$$;

create function private.claim_hosted_subscription(p_id uuid,p_user_id uuid,p_email text,p_recovery boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sub public.hosted_subscriptions;
begin
 select * into sub from public.hosted_subscriptions where id = p_id for update;
 if not found then return jsonb_build_object('ok',false,'status',404,'error','Payment not found'); end if;
 if sub.user_id is not null then
   if sub.user_id = p_user_id then return jsonb_build_object('ok',true,'id',sub.id); end if;
   return jsonb_build_object('ok',false,'status',409,'error','Payment is already linked to another account');
 end if;
 if sub.email is null or lower(sub.email) <> lower(trim(p_email)) or not exists (
   select 1 from auth.users where id = p_user_id and lower(email) = lower(trim(p_email))
 ) then return jsonb_build_object('ok',false,'status',403,'error','Sign in with the email used at checkout'); end if;
 if not p_recovery and sub.claim_expires_at < now() then
   return jsonb_build_object('ok',false,'status',410,'error','Recover this payment using its checkout reference; do not purchase again');
 end if;
 if sub.status not in ('active','trialing','past_due') then
   return jsonb_build_object('ok',false,'status',402,'error','Subscription is not active yet');
 end if;
 update public.hosted_subscriptions set user_id = p_user_id,claimed_at = now() where id = sub.id;
 return jsonb_build_object('ok',true,'id',sub.id);
end;
$$;
create function public.claim_hosted_subscription(p_claim_token_hash text,p_user_id uuid,p_email text)
returns jsonb language sql security definer set search_path = '' as $$
 select private.claim_hosted_subscription((select id from public.hosted_subscriptions where claim_token_hash = p_claim_token_hash),p_user_id,p_email,false);
$$;
create function public.recover_hosted_subscription(p_checkout_id text,p_user_id uuid,p_email text)
returns jsonb language sql security definer set search_path = '' as $$
 select private.claim_hosted_subscription((select id from public.hosted_subscriptions where stripe_checkout_session_id = p_checkout_id),p_user_id,p_email,true);
$$;
revoke all on function private.claim_hosted_subscription(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.claim_hosted_subscription(text,uuid,text) from public,anon,authenticated;
revoke all on function public.recover_hosted_subscription(text,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_hosted_subscription(text,uuid,text) to service_role;
grant execute on function public.recover_hosted_subscription(text,uuid,text) to service_role;

-- Members inherit their organisation's subscription; only an unbound payer may create a new org.
create or replace function public.hosted_entitlement_for_user(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',s.id,'status',s.status,'org_id',s.org_id,'seats_included',s.seats_included)
 from public.hosted_subscriptions s where s.status in ('active','trialing','past_due') and (
   (s.user_id = p_user_id and s.org_id is null) or exists (
     select 1 from public.memberships m where m.org_id = s.org_id and m.user_id = p_user_id and m.status = 'active'
   )
 ) order by s.claimed_at desc limit 1;
$$;

-- Billing recovery must remain reachable when CRM data is gated. Expose only the caller's
-- organisation names for selecting where to attach an unbound payment.
create function public.hosted_owned_organisations() returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name)),'[]'::jsonb)
 from public.organisations o join public.memberships m on m.org_id=o.id
 where m.user_id=auth.uid() and m.role='owner' and m.status='active' and o.deleted_at is null;
$$;
create function public.attach_hosted_subscription(p_org_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare sub_id uuid; capacity integer; used integer;
begin
 perform 1 from public.organisations o join public.memberships m on m.org_id=o.id
 where o.id=p_org_id and o.deleted_at is null and m.user_id=auth.uid() and m.role='owner' and m.status='active'
 for update of o;
 if not found then raise exception 'Only the organisation owner can attach billing' using errcode='42501'; end if;
 if private.hosted_org_access(p_org_id) then raise exception 'Organisation already has access'; end if;
 select id,seats_included into sub_id,capacity from public.hosted_subscriptions
 where user_id=auth.uid() and org_id is null and status in ('active','trialing','past_due')
 order by claimed_at limit 1 for update;
 if sub_id is null then raise exception 'No unassigned active subscription' using errcode='42501'; end if;
 select (select count(*) from public.memberships where org_id=p_org_id and status='active') +
   (select count(*) from public.organisation_invitations where org_id=p_org_id and accepted_at is null and revoked_at is null and expires_at>now()) into used;
 if used>capacity then raise exception 'Reduce active members and pending invitations to three before attaching this plan' using errcode='23514'; end if;
 update public.hosted_subscriptions set org_id=null where org_id=p_org_id and status not in ('active','trialing','past_due');
 update public.hosted_subscriptions set org_id=p_org_id where id=sub_id;
end;
$$;
revoke all on function public.hosted_owned_organisations() from public,anon;
revoke all on function public.attach_hosted_subscription(uuid) from public,anon;
grant execute on function public.hosted_owned_organisations() to authenticated;
grant execute on function public.attach_hosted_subscription(uuid) to authenticated;

-- Invitation manager read RPCs use this helper rather than has_org_role.
create or replace function private.assert_org_member_manager(p_org_id uuid,p_allow_admin boolean default true)
returns text language plpgsql stable security definer set search_path = '' as $$
declare actor_role text;
begin
 if not private.hosted_org_access(p_org_id) then raise exception 'An active hosted subscription is required' using errcode='42501'; end if;
 select m.role into actor_role from public.memberships m join public.organisations o on o.id=m.org_id
 where m.org_id=p_org_id and m.user_id=auth.uid() and m.status='active' and o.deleted_at is null;
 if actor_role is null or (actor_role<>'owner' and (not p_allow_admin or actor_role<>'admin')) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 return actor_role;
end;
$$;

create function public.hosted_billing_accounts() returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',coalesce(o.name,'Unassigned subscription'),'status',s.status) order by s.claimed_at desc),'[]'::jsonb)
 from public.hosted_subscriptions s left join public.organisations o on o.id=s.org_id
 where s.user_id=auth.uid() and s.stripe_customer_id is not null;
$$;
revoke all on function public.hosted_billing_accounts() from public,anon;
grant execute on function public.hosted_billing_accounts() to authenticated;
