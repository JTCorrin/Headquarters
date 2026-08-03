-- Audit log foundation: append-only audit_events, Owner/Admin RLS,
-- private.append_audit_event, and base writers on org config + tax rates.
-- Plan: PLANS/AUDIT_LOG_FOUNDATION_SLICE.md (Buzz nest).
-- Membership/invite mutation APIs do not exist yet — deferred with those surfaces.

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organisations (id) on delete cascade,
  actor_type text not null
    check (actor_type in ('user', 'agent', 'api_key', 'system')),
  actor_id uuid,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  request_id uuid,
  ip_address inet,
  user_agent text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_action_nonempty check (char_length(btrim(action)) > 0),
  constraint audit_events_resource_type_nonempty check (char_length(btrim(resource_type)) > 0),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_org_created_id_idx
  on public.audit_events (org_id, created_at desc, id desc);

create index audit_events_org_action_idx
  on public.audit_events (org_id, action);

create index audit_events_org_actor_idx
  on public.audit_events (org_id, actor_id)
  where actor_id is not null;

comment on table public.audit_events is
  'Append-only security/compliance trail; distinct from timeline_events and notifications.';

alter table public.audit_events enable row level security;

create policy audit_events_select_admin
on public.audit_events
for select
to authenticated
using (
  org_id is not null
  and private.has_org_role(org_id, array['owner', 'admin'])
);

revoke all on table public.audit_events from public, anon, authenticated;
grant select on table public.audit_events to authenticated;

create or replace function private.append_audit_event(
  p_org_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id uuid,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null,
  p_before_data jsonb default null,
  p_after_data jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
begin
  if p_actor_type is null or p_actor_type not in ('user', 'agent', 'api_key', 'system') then
    raise exception 'Invalid audit actor_type'
      using errcode = '22023';
  end if;

  if p_action is null or char_length(btrim(p_action)) < 1 then
    raise exception 'Invalid audit action'
      using errcode = '22023';
  end if;

  if p_resource_type is null or char_length(btrim(p_resource_type)) < 1 then
    raise exception 'Invalid audit resource_type'
      using errcode = '22023';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Invalid audit metadata'
      using errcode = '22023';
  end if;

  insert into public.audit_events (
    org_id,
    actor_type,
    actor_id,
    action,
    resource_type,
    resource_id,
    request_id,
    ip_address,
    user_agent,
    before_data,
    after_data,
    metadata
  )
  values (
    p_org_id,
    p_actor_type,
    p_actor_id,
    btrim(p_action),
    btrim(p_resource_type),
    p_resource_id,
    p_request_id,
    p_ip_address,
    p_user_agent,
    p_before_data,
    p_after_data,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function private.append_audit_event(
  uuid, text, uuid, text, text, uuid, uuid, inet, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writers: organisation create / config patch (same txn as mutation)
-- ---------------------------------------------------------------------------

create or replace function private.audit_organisation_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.append_audit_event(
    new.id,
    'user',
    auth.uid(),
    'org.created',
    'organisation',
    new.id,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'name', new.name,
      'slug', new.slug,
      'default_currency', new.default_currency,
      'country_code', new.country_code
    ),
    '{}'::jsonb
  );
  return new;
end;
$$;

create trigger organisations_audit_insert
after insert on public.organisations
for each row execute function private.audit_organisation_insert();

create or replace function private.audit_organisation_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_cfg jsonb;
  after_cfg jsonb;
  name_changed boolean;
  config_changed boolean;
begin
  name_changed := new.name is distinct from old.name;

  config_changed :=
    new.legal_name is distinct from old.legal_name
    or new.logo_path is distinct from old.logo_path
    or new.billing_email is distinct from old.billing_email
    or new.phone is distinct from old.phone
    or new.website_url is distinct from old.website_url
    or new.tax_identifier is distinct from old.tax_identifier
    or new.registration_number is distinct from old.registration_number
    or new.default_currency is distinct from old.default_currency
    or new.timezone is distinct from old.timezone
    or new.locale is distinct from old.locale
    or new.country_code is distinct from old.country_code
    or new.theme_default is distinct from old.theme_default
    or new.settings is distinct from old.settings
    or new.slug is distinct from old.slug;

  if not name_changed and not config_changed then
    return new;
  end if;

  before_cfg := jsonb_strip_nulls(jsonb_build_object(
    'name', old.name,
    'legal_name', old.legal_name,
    'logo_path', old.logo_path,
    'billing_email', old.billing_email,
    'phone', old.phone,
    'website_url', old.website_url,
    'tax_identifier', old.tax_identifier,
    'registration_number', old.registration_number,
    'default_currency', old.default_currency,
    'timezone', old.timezone,
    'locale', old.locale,
    'country_code', old.country_code,
    'theme_default', old.theme_default,
    'settings', old.settings,
    'slug', old.slug
  ));
  after_cfg := jsonb_strip_nulls(jsonb_build_object(
    'name', new.name,
    'legal_name', new.legal_name,
    'logo_path', new.logo_path,
    'billing_email', new.billing_email,
    'phone', new.phone,
    'website_url', new.website_url,
    'tax_identifier', new.tax_identifier,
    'registration_number', new.registration_number,
    'default_currency', new.default_currency,
    'timezone', new.timezone,
    'locale', new.locale,
    'country_code', new.country_code,
    'theme_default', new.theme_default,
    'settings', new.settings,
    'slug', new.slug
  ));

  if name_changed then
    perform private.append_audit_event(
      new.id,
      'user',
      auth.uid(),
      'org.name_changed',
      'organisation',
      new.id,
      null,
      null,
      null,
      jsonb_build_object('name', old.name),
      jsonb_build_object('name', new.name),
      '{}'::jsonb
    );
  end if;

  if config_changed then
    perform private.append_audit_event(
      new.id,
      'user',
      auth.uid(),
      'org.config_updated',
      'organisation',
      new.id,
      null,
      null,
      null,
      before_cfg,
      after_cfg,
      '{}'::jsonb
    );
  end if;

  return new;
end;
$$;

create trigger organisations_audit_update
after update on public.organisations
for each row execute function private.audit_organisation_update();

-- ---------------------------------------------------------------------------
-- Writers: tax rate create / update / archive / default
-- ---------------------------------------------------------------------------

create or replace function private.audit_tax_rate_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_code text;
  before_row jsonb;
  after_row jsonb;
begin
  if tg_op = 'INSERT' then
    action_code := 'org.tax_rate_created';
    before_row := null;
    after_row := jsonb_build_object(
      'name', new.name,
      'rate_percent', new.rate_percent,
      'is_default', new.is_default,
      'active', new.active
    );
  else
    if old.deleted_at is null and new.deleted_at is not null then
      action_code := 'org.tax_rate_archived';
    elsif old.active is distinct from new.active and new.active = false then
      action_code := 'org.tax_rate_archived';
    elsif old.is_default is distinct from new.is_default and new.is_default = true then
      action_code := 'org.tax_rate_default_set';
    elsif
      new.name is distinct from old.name
      or new.rate_percent is distinct from old.rate_percent
      or new.active is distinct from old.active
    then
      action_code := 'org.tax_rate_updated';
    else
      -- Ignore collateral default clears / stamp-only updates.
      return new;
    end if;

    before_row := jsonb_build_object(
      'name', old.name,
      'rate_percent', old.rate_percent,
      'is_default', old.is_default,
      'active', old.active,
      'deleted_at', old.deleted_at
    );
    after_row := jsonb_build_object(
      'name', new.name,
      'rate_percent', new.rate_percent,
      'is_default', new.is_default,
      'active', new.active,
      'deleted_at', new.deleted_at
    );
  end if;

  perform private.append_audit_event(
    new.org_id,
    'user',
    auth.uid(),
    action_code,
    'tax_rate',
    new.id,
    null,
    null,
    null,
    before_row,
    after_row,
    '{}'::jsonb
  );

  return new;
end;
$$;

create trigger tax_rates_audit_insert
after insert on public.tax_rates
for each row execute function private.audit_tax_rate_write();

create trigger tax_rates_audit_update
after update on public.tax_rates
for each row execute function private.audit_tax_rate_write();

revoke all on function private.audit_organisation_insert() from public, anon, authenticated;
revoke all on function private.audit_organisation_update() from public, anon, authenticated;
revoke all on function private.audit_tax_rate_write() from public, anon, authenticated;
