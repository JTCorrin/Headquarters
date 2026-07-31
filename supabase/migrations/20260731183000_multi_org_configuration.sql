-- Multi-org configuration: org version/theme, profile theme override, named tax rates.

alter table public.organisations
  add column theme_default text not null default 'system',
  add column version integer not null default 1;

alter table public.organisations
  add constraint organisations_theme_default_check
    check (theme_default in ('system', 'light', 'dark')),
  add constraint organisations_version_positive_check
    check (version > 0);

alter table public.profiles
  add column theme_preference text;

alter table public.profiles
  add constraint profiles_theme_preference_check
    check (
      theme_preference is null
      or theme_preference in ('system', 'light', 'dark')
    );

create or replace function private.stamp_organisation_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

drop trigger if exists organisations_set_updated_at on public.organisations;
create trigger organisations_stamp_row
before update on public.organisations
for each row execute function private.stamp_organisation_row();

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 120),
  rate_percent numeric(7, 4) not null,
  is_default boolean not null default false,
  active boolean not null default true,
  constraint tax_rates_org_id_id_key unique (org_id, id),
  constraint tax_rates_rate_finite_check
    check (
      lower(rate_percent::text) not in ('nan', 'infinity', '-infinity')
      and rate_percent >= 0
      and rate_percent <= 100
    ),
  constraint tax_rates_default_requires_active_check
    check (not is_default or (active and deleted_at is null))
);

create unique index tax_rates_one_active_default_per_org_idx
  on public.tax_rates (org_id)
  where is_default and active and deleted_at is null;

create index tax_rates_org_created_idx
  on public.tax_rates (org_id, created_at desc, id desc)
  where deleted_at is null;

create trigger tax_rates_stamp_business_row
before insert or update on public.tax_rates
for each row execute function private.stamp_business_row();

create or replace function private.ensure_single_default_tax_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_default
    and new.active
    and new.deleted_at is null
  then
    update public.tax_rates
    set is_default = false
    where tax_rates.org_id = new.org_id
      and tax_rates.id is distinct from new.id
      and tax_rates.is_default
      and tax_rates.deleted_at is null;
  end if;
  return new;
end;
$$;

create trigger tax_rates_ensure_single_default
before insert or update of is_default, active, deleted_at on public.tax_rates
for each row execute function private.ensure_single_default_tax_rate();

-- Products may reference an active org tax rate.
alter table public.products
  add constraint products_tax_rate_fk
    foreign key (org_id, tax_rate_id)
    references public.tax_rates (org_id, id)
    on delete set null (tax_rate_id);

create or replace function private.validate_product_tax_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tax_rate_id is null
    or (
      tg_op = 'UPDATE'
      and new.tax_rate_id is not distinct from old.tax_rate_id
    )
  then
    return new;
  end if;

  perform tax_rates.id
  from public.tax_rates
  where tax_rates.id = new.tax_rate_id
    and tax_rates.org_id = new.org_id
    and tax_rates.deleted_at is null
    and tax_rates.active
  for update;

  if not found then
    raise exception 'Product tax rate must be an active rate in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger products_validate_tax_rate
before insert or update of tax_rate_id on public.products
for each row execute function private.validate_product_tax_rate();

revoke all on function private.stamp_organisation_row() from public, anon, authenticated;
revoke all on function private.ensure_single_default_tax_rate() from public, anon, authenticated;
revoke all on function private.validate_product_tax_rate() from public, anon, authenticated;

alter table public.tax_rates enable row level security;

create policy organisations_update_admin
on public.organisations
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(id, array['owner', 'admin'])
)
with check (
  deleted_at is null
  and private.has_org_role(id, array['owner', 'admin'])
);

create policy tax_rates_select_member
on public.tax_rates
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

create policy tax_rates_insert_admin
on public.tax_rates
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin'])
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy tax_rates_update_admin
on public.tax_rates
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin'])
)
with check (
  private.has_org_role(org_id, array['owner', 'admin'])
  and updated_by = auth.uid()
);

revoke all on table public.tax_rates from public, anon, authenticated;

grant update (
  name,
  legal_name,
  logo_path,
  billing_email,
  phone,
  website_url,
  tax_identifier,
  registration_number,
  default_currency,
  timezone,
  locale,
  country_code,
  theme_default,
  settings
) on table public.organisations to authenticated;

grant update (display_name, avatar_path, locale, timezone, theme_preference)
  on table public.profiles to authenticated;

grant select on table public.tax_rates to authenticated;
grant insert (
  org_id,
  name,
  rate_percent,
  is_default,
  active
) on table public.tax_rates to authenticated;
grant update (
  name,
  rate_percent,
  is_default,
  active,
  deleted_at
) on table public.tax_rates to authenticated;
