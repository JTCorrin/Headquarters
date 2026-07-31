-- Headquarters backend foundation:
-- Supabase Auth profiles, organisation tenancy, memberships, and contacts.

create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_path text,
  locale text not null default 'en-GB',
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  legal_name text,
  slug extensions.citext not null unique,
  logo_path text,
  billing_email extensions.citext,
  phone text,
  website_url text,
  tax_identifier text,
  registration_number text,
  default_currency char(3) not null default 'GBP',
  timezone text not null default 'UTC',
  locale text not null default 'en-GB',
  country_code char(2) not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint organisations_slug_format_check
    check (
      slug::text = lower(slug::text)
      and slug::text ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    ),
  constraint organisations_currency_format_check
    check (default_currency ~ '^[A-Z]{3}$'),
  constraint organisations_country_format_check
    check (country_code ~ '^[A-Z]{2}$'),
  constraint organisations_settings_object_check
    check (jsonb_typeof(settings) = 'object')
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null,
  status text not null default 'active',
  job_title text,
  joined_at timestamptz not null default now(),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_org_user_key unique (org_id, user_id),
  constraint memberships_org_id_id_key unique (org_id, id),
  constraint memberships_role_check
    check (role in ('owner', 'admin', 'member', 'billing', 'readonly')),
  constraint memberships_status_check
    check (status in ('active', 'suspended')),
  constraint memberships_suspension_check
    check (
      (status = 'active' and suspended_at is null)
      or (status = 'suspended' and suspended_at is not null)
    )
);

create unique index memberships_one_active_owner_per_org_idx
  on public.memberships (org_id)
  where role = 'owner' and status = 'active';

create index memberships_user_status_idx
  on public.memberships (user_id, status, org_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete restrict,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  first_name text,
  last_name text,
  display_name text not null check (char_length(display_name) between 1 and 200),
  primary_email extensions.citext,
  primary_phone text,
  job_title text,
  company_name text,
  owner_membership_id uuid,
  lifecycle_status text not null default 'active',
  source text,
  notes text,
  last_contacted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint contacts_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete set null (owner_membership_id),
  constraint contacts_lifecycle_status_check
    check (lifecycle_status in ('active', 'inactive', 'archived')),
  constraint contacts_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index contacts_org_created_idx
  on public.contacts (org_id, created_at desc, id desc)
  where deleted_at is null;

create index contacts_org_email_idx
  on public.contacts (org_id, primary_email)
  where deleted_at is null and primary_email is not null;

create index contacts_org_owner_idx
  on public.contacts (org_id, owner_membership_id)
  where deleted_at is null and owner_membership_id is not null;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.stamp_business_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor_id, new.created_by);
    new.updated_by := coalesce(actor_id, new.updated_by);
    return new;
  end if;

  new.id := old.id;
  new.org_id := old.org_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.updated_at := now();
  new.updated_by := coalesce(actor_id, new.updated_by);
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger organisations_set_updated_at
before update on public.organisations
for each row execute function private.set_updated_at();

create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function private.set_updated_at();

create trigger contacts_stamp_business_row
before insert or update on public.contacts
for each row execute function private.stamp_business_row();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
begin
  profile_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'User'
  );

  insert into public.profiles (id, display_name)
  values (new.id, left(profile_name, 120))
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name, created_at, updated_at)
select
  users.id,
  left(
    coalesce(
      nullif(trim(users.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
      'User'
    ),
    120
  ),
  users.created_at,
  users.created_at
from auth.users as users
on conflict (id) do nothing;

create or replace function private.has_org_role(
  target_org_id uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships
    where memberships.org_id = target_org_id
      and memberships.user_id = auth.uid()
      and memberships.status = 'active'
      and (
        allowed_roles is null
        or memberships.role = any (allowed_roles)
      )
  );
$$;

create or replace function public.create_organisation(
  p_name text,
  p_slug text,
  p_country_code text,
  p_default_currency text default 'GBP',
  p_timezone text default 'UTC',
  p_locale text default 'en-GB'
)
returns public.organisations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  created_org public.organisations;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Organisation name is required'
      using errcode = '22023';
  end if;

  if p_slug is null or lower(trim(p_slug)) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Organisation slug is invalid'
      using errcode = '22023';
  end if;

  insert into public.organisations (
    name,
    slug,
    country_code,
    default_currency,
    timezone,
    locale
  )
  values (
    trim(p_name),
    lower(trim(p_slug)),
    upper(trim(p_country_code)),
    upper(trim(p_default_currency)),
    coalesce(nullif(trim(p_timezone), ''), 'UTC'),
    coalesce(nullif(trim(p_locale), ''), 'en-GB')
  )
  returning * into created_org;

  insert into public.memberships (org_id, user_id, role, status)
  values (created_org.id, actor_id, 'owner', 'active');

  return created_org;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.stamp_business_row() from public, anon, authenticated;
revoke all on function private.has_org_role(uuid, text[]) from public, anon;
revoke all on function public.create_organisation(text, text, text, text, text, text)
  from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.has_org_role(uuid, text[]) to authenticated;
grant execute on function public.create_organisation(text, text, text, text, text, text)
  to authenticated;

alter table public.profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.memberships enable row level security;
alter table public.contacts enable row level security;

create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy organisations_select_member
on public.organisations
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(id)
);

create policy memberships_select_member
on public.memberships
for select
to authenticated
using (private.has_org_role(org_id));

create policy contacts_select_member
on public.contacts
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy contacts_insert_member
on public.contacts
for insert
to authenticated
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy contacts_update_member
on public.contacts
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
)
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and updated_by = auth.uid()
);

revoke all on table public.profiles from anon;
revoke all on table public.organisations from anon;
revoke all on table public.memberships from anon;
revoke all on table public.contacts from anon;
revoke all on table public.profiles from authenticated;
revoke all on table public.organisations from authenticated;
revoke all on table public.memberships from authenticated;
revoke all on table public.contacts from authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name, avatar_path, locale, timezone)
  on table public.profiles to authenticated;
grant select on table public.organisations to authenticated;
grant select on table public.memberships to authenticated;
grant select on table public.contacts to authenticated;
grant insert (
  org_id,
  first_name,
  last_name,
  display_name,
  primary_email,
  primary_phone,
  job_title,
  company_name,
  owner_membership_id,
  lifecycle_status,
  source,
  notes,
  metadata
) on table public.contacts to authenticated;
grant update (
  first_name,
  last_name,
  display_name,
  primary_email,
  primary_phone,
  job_title,
  company_name,
  owner_membership_id,
  lifecycle_status,
  source,
  notes,
  metadata,
  deleted_at
) on table public.contacts to authenticated;
