-- Multi-contact billing recipients v1
-- Multi-contact billing recipients v1
-- Junction tables + replace helpers + snapshot contacts[] + convert/recurring copy.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

create table public.quote_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1 check (version > 0),
  quote_id uuid not null,
  contact_id uuid not null,
  position integer not null check (position >= 0),
  is_billing boolean not null default false,
  constraint quote_recipients_org_id_id_key unique (org_id, id),
  constraint quote_recipients_quote_fk
    foreign key (org_id, quote_id)
    references public.quotes (org_id, id)
    on delete cascade,
  constraint quote_recipients_contact_fk
    foreign key (org_id, contact_id)
    references public.contacts (org_id, id)
    on delete restrict,
  constraint quote_recipients_quote_contact_key unique (quote_id, contact_id)
);

create unique index quote_recipients_one_billing_uidx
  on public.quote_recipients (quote_id)
  where is_billing;

create index quote_recipients_quote_idx
  on public.quote_recipients (org_id, quote_id, position, id);

create trigger quote_recipients_stamp_business_row
before insert or update on public.quote_recipients
for each row
execute function private.stamp_business_row();

create table public.invoice_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1 check (version > 0),
  invoice_id uuid not null,
  contact_id uuid not null,
  position integer not null check (position >= 0),
  is_billing boolean not null default false,
  constraint invoice_recipients_org_id_id_key unique (org_id, id),
  constraint invoice_recipients_invoice_fk
    foreign key (org_id, invoice_id)
    references public.invoices (org_id, id)
    on delete cascade,
  constraint invoice_recipients_contact_fk
    foreign key (org_id, contact_id)
    references public.contacts (org_id, id)
    on delete restrict,
  constraint invoice_recipients_invoice_contact_key unique (invoice_id, contact_id)
);

create unique index invoice_recipients_one_billing_uidx
  on public.invoice_recipients (invoice_id)
  where is_billing;

create index invoice_recipients_invoice_idx
  on public.invoice_recipients (org_id, invoice_id, position, id);

create trigger invoice_recipients_stamp_business_row
before insert or update on public.invoice_recipients
for each row
execute function private.stamp_business_row();

create table public.recurring_invoice_schedule_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1 check (version > 0),
  schedule_id uuid not null,
  contact_id uuid not null,
  position integer not null check (position >= 0),
  is_billing boolean not null default false,
  constraint recurring_schedule_recipients_org_id_id_key unique (org_id, id),
  constraint recurring_schedule_recipients_schedule_fk
    foreign key (org_id, schedule_id)
    references public.recurring_invoice_schedules (org_id, id)
    on delete cascade,
  constraint recurring_schedule_recipients_contact_fk
    foreign key (org_id, contact_id)
    references public.contacts (org_id, id)
    on delete restrict,
  constraint recurring_schedule_recipients_schedule_contact_key unique (schedule_id, contact_id)
);

create unique index recurring_schedule_recipients_one_billing_uidx
  on public.recurring_invoice_schedule_recipients (schedule_id)
  where is_billing;

create index recurring_schedule_recipients_schedule_idx
  on public.recurring_invoice_schedule_recipients (org_id, schedule_id, position, id);

create trigger recurring_schedule_recipients_stamp_business_row
before insert or update on public.recurring_invoice_schedule_recipients
for each row
execute function private.stamp_business_row();

alter table public.quote_recipients enable row level security;
alter table public.invoice_recipients enable row level security;
alter table public.recurring_invoice_schedule_recipients enable row level security;

create policy quote_recipients_select_member
on public.quote_recipients
for select
to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
  and exists (
    select 1 from public.quotes
    where quotes.id = quote_recipients.quote_id
      and quotes.org_id = quote_recipients.org_id
      and quotes.deleted_at is null
  )
);

create policy invoice_recipients_select_member
on public.invoice_recipients
for select
to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly', 'billing'])
  and exists (
    select 1 from public.invoices
    where invoices.id = invoice_recipients.invoice_id
      and invoices.org_id = invoice_recipients.org_id
      and invoices.deleted_at is null
  )
);

create policy recurring_schedule_recipients_select_member
on public.recurring_invoice_schedule_recipients
for select
to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly', 'billing'])
  and exists (
    select 1 from public.recurring_invoice_schedules
    where recurring_invoice_schedules.id = recurring_invoice_schedule_recipients.schedule_id
      and recurring_invoice_schedules.org_id = recurring_invoice_schedule_recipients.org_id
      and recurring_invoice_schedules.deleted_at is null
  )
);

revoke all on table public.quote_recipients from public, anon, authenticated;
revoke all on table public.invoice_recipients from public, anon, authenticated;
revoke all on table public.recurring_invoice_schedule_recipients from public, anon, authenticated;

grant select on table public.quote_recipients to authenticated;
grant select on table public.invoice_recipients to authenticated;
grant select on table public.recurring_invoice_schedule_recipients to authenticated;

-- Backfill scalar contact_id → one billing recipient
insert into public.quote_recipients (org_id, quote_id, contact_id, position, is_billing, created_by, updated_by)
select q.org_id, q.id, q.contact_id, 0, true, q.created_by, q.updated_by
from public.quotes q
where q.contact_id is not null
  and q.deleted_at is null
  and not exists (
    select 1 from public.quote_recipients r where r.quote_id = q.id
  );

insert into public.invoice_recipients (org_id, invoice_id, contact_id, position, is_billing, created_by, updated_by)
select i.org_id, i.id, i.contact_id, 0, true, i.created_by, i.updated_by
from public.invoices i
where i.contact_id is not null
  and i.deleted_at is null
  and not exists (
    select 1 from public.invoice_recipients r where r.invoice_id = i.id
  );

insert into public.recurring_invoice_schedule_recipients (
  org_id, schedule_id, contact_id, position, is_billing, created_by, updated_by
)
select s.org_id, s.id, s.contact_id, 0, true, s.created_by, s.updated_by
from public.recurring_invoice_schedules s
where s.contact_id is not null
  and s.deleted_at is null
  and not exists (
    select 1 from public.recurring_invoice_schedule_recipients r where r.schedule_id = s.id
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.normalize_recipients_array(
  p_org_id uuid,
  p_recipients jsonb
)
returns table (
  contact_id uuid,
  sort_position integer,
  is_billing boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  elem jsonb;
  ord integer := 0;
  cid uuid;
  billing_flags boolean[] := array[]::boolean[];
  contact_ids uuid[] := array[]::uuid[];
  billing_count integer := 0;
  i integer;
  flag boolean;
begin
  if p_recipients is null or jsonb_typeof(p_recipients) <> 'array' then
    raise exception 'Recipients must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_recipients) > 25 then
    raise exception 'Documents cannot exceed 25 recipients'
      using errcode = '22023';
  end if;

  for elem in
    select value
    from jsonb_array_elements(p_recipients) with ordinality as t(value, o)
    order by o
  loop
    if jsonb_typeof(elem) <> 'object' then
      raise exception 'Recipient must be an object'
        using errcode = '22023';
    end if;

    cid := nullif(elem ->> 'contact_id', '')::uuid;
    if cid is null then
      raise exception 'Recipient contact_id is required'
        using errcode = '22023';
    end if;

    if cid = any (contact_ids) then
      raise exception 'Recipient contact_id is duplicated'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.contacts
      where contacts.id = cid
        and contacts.org_id = p_org_id
        and contacts.deleted_at is null
    ) then
      raise exception 'Recipient contact not found or inactive in organisation'
        using errcode = '22023';
    end if;

    contact_ids := array_append(contact_ids, cid);
    if elem ? 'is_billing' and elem ->> 'is_billing' is not null then
      flag := (elem ->> 'is_billing')::boolean;
    else
      flag := false;
    end if;
    billing_flags := array_append(billing_flags, flag);
    ord := ord + 1;
  end loop;

  if coalesce(array_length(contact_ids, 1), 0) = 0 then
    return;
  end if;

  billing_count := 0;
  for i in 1..array_length(billing_flags, 1) loop
    if billing_flags[i] then
      billing_count := billing_count + 1;
    end if;
  end loop;

  if billing_count = 0 then
    billing_flags[1] := true;
    billing_count := 1;
  elsif billing_count > 1 then
    raise exception 'Exactly one recipient must be marked is_billing when recipients are set'
      using errcode = '22023';
  end if;

  for i in 1..array_length(contact_ids, 1) loop
    contact_id := contact_ids[i];
    sort_position := i - 1;
    is_billing := billing_flags[i];
    return next;
  end loop;
end;
$$;

revoke all on function private.normalize_recipients_array(uuid, jsonb)
  from public, anon, authenticated;

-- Resolve payload → recipients array to apply, or null = leave unchanged (save only).
create or replace function private.resolve_recipients_input(
  p_payload jsonb,
  p_for_create boolean
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  cid text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload must be an object'
      using errcode = '22023';
  end if;

  if p_payload ? 'recipients' then
    return coalesce(p_payload -> 'recipients', '[]'::jsonb);
  end if;

  if p_payload ? 'contact_id' then
    cid := nullif(p_payload ->> 'contact_id', '');
    if cid is null then
      return '[]'::jsonb;
    end if;
    return jsonb_build_array(
      jsonb_build_object('contact_id', cid, 'is_billing', true)
    );
  end if;

  if p_for_create then
    return '[]'::jsonb;
  end if;

  return null;
end;
$$;

revoke all on function private.resolve_recipients_input(jsonb, boolean)
  from public, anon, authenticated;

create or replace function private.contact_snapshot_json(p_contact public.contacts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when p_contact.id is null then null
    else jsonb_build_object(
      'id', p_contact.id,
      'display_name', p_contact.display_name,
      'primary_email', p_contact.primary_email,
      'primary_phone', p_contact.primary_phone
    )
  end;
$$;

revoke all on function private.contact_snapshot_json(public.contacts)
  from public, anon, authenticated;

create or replace function private.build_receivable_party_snapshot(
  p_org_id uuid,
  p_client_id uuid,
  p_billing_contact_id uuid,
  p_recipient_contact_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  client_row public.clients;
  contact_row public.contacts;
  contacts_json jsonb := '[]'::jsonb;
  cid uuid;
  billing_json jsonb := null;
begin
  if p_client_id is null then
    return '{}'::jsonb;
  end if;

  select * into client_row
  from public.clients
  where clients.id = p_client_id
    and clients.org_id = p_org_id;

  if not found then
    raise exception 'Client not found'
      using errcode = 'P0002';
  end if;

  if p_recipient_contact_ids is not null then
    foreach cid in array p_recipient_contact_ids loop
      select * into contact_row
      from public.contacts
      where contacts.id = cid
        and contacts.org_id = p_org_id;
      if found then
        contacts_json := contacts_json || jsonb_build_array(
          private.contact_snapshot_json(contact_row)
        );
      end if;
    end loop;
  end if;

  if p_billing_contact_id is not null then
    select * into contact_row
    from public.contacts
    where contacts.id = p_billing_contact_id
      and contacts.org_id = p_org_id;
    if found then
      billing_json := private.contact_snapshot_json(contact_row);
    end if;
  end if;

  return jsonb_build_object(
    'client', jsonb_build_object(
      'id', client_row.id,
      'name', client_row.name,
      'primary_email', client_row.primary_email,
      'phone', client_row.phone,
      'tax_identifier', client_row.tax_identifier,
      'registration_number', client_row.registration_number
    ),
    'contact', billing_json,
    'contacts', contacts_json
  );
end;
$$;

revoke all on function private.build_receivable_party_snapshot(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;

create or replace function private.quote_recipient_contact_ids(
  p_org_id uuid,
  p_quote_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    array_agg(contact_id order by position, id),
    array[]::uuid[]
  )
  from public.quote_recipients
  where org_id = p_org_id
    and quote_id = p_quote_id;
$$;

create or replace function private.invoice_recipient_contact_ids(
  p_org_id uuid,
  p_invoice_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    array_agg(contact_id order by position, id),
    array[]::uuid[]
  )
  from public.invoice_recipients
  where org_id = p_org_id
    and invoice_id = p_invoice_id;
$$;

create or replace function private.quote_recipients_json(
  p_org_id uuid,
  p_quote_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'org_id', org_id,
        'quote_id', quote_id,
        'contact_id', contact_id,
        'position', position,
        'is_billing', is_billing,
        'created_at', created_at,
        'updated_at', updated_at,
        'created_by', created_by,
        'updated_by', updated_by
      )
      order by position, id
    ),
    '[]'::jsonb
  )
  from public.quote_recipients
  where org_id = p_org_id
    and quote_id = p_quote_id;
$$;

create or replace function private.invoice_recipients_json(
  p_org_id uuid,
  p_invoice_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'org_id', org_id,
        'invoice_id', invoice_id,
        'contact_id', contact_id,
        'position', position,
        'is_billing', is_billing,
        'created_at', created_at,
        'updated_at', updated_at,
        'created_by', created_by,
        'updated_by', updated_by
      )
      order by position, id
    ),
    '[]'::jsonb
  )
  from public.invoice_recipients
  where org_id = p_org_id
    and invoice_id = p_invoice_id;
$$;

create or replace function private.schedule_recipients_json(
  p_org_id uuid,
  p_schedule_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'org_id', org_id,
        'schedule_id', schedule_id,
        'contact_id', contact_id,
        'position', position,
        'is_billing', is_billing,
        'created_at', created_at,
        'updated_at', updated_at,
        'created_by', created_by,
        'updated_by', updated_by
      )
      order by position, id
    ),
    '[]'::jsonb
  )
  from public.recurring_invoice_schedule_recipients
  where org_id = p_org_id
    and schedule_id = p_schedule_id;
$$;

create or replace function private.replace_quote_recipients(
  p_org_id uuid,
  p_quote_id uuid,
  p_actor_id uuid,
  p_recipients jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  billing_id uuid := null;
  rec record;
begin
  delete from public.quote_recipients
  where org_id = p_org_id
    and quote_id = p_quote_id;

  for rec in
    select * from private.normalize_recipients_array(p_org_id, p_recipients)
  loop
    insert into public.quote_recipients (
      org_id, quote_id, contact_id, position, is_billing, created_by, updated_by
    ) values (
      p_org_id, p_quote_id, rec.contact_id, rec.sort_position, rec.is_billing, p_actor_id, p_actor_id
    );
    if rec.is_billing then
      billing_id := rec.contact_id;
    end if;
  end loop;

  return billing_id;
end;
$$;

revoke all on function private.replace_quote_recipients(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function private.replace_invoice_recipients(
  p_org_id uuid,
  p_invoice_id uuid,
  p_actor_id uuid,
  p_recipients jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  billing_id uuid := null;
  rec record;
begin
  delete from public.invoice_recipients
  where org_id = p_org_id
    and invoice_id = p_invoice_id;

  for rec in
    select * from private.normalize_recipients_array(p_org_id, p_recipients)
  loop
    insert into public.invoice_recipients (
      org_id, invoice_id, contact_id, position, is_billing, created_by, updated_by
    ) values (
      p_org_id, p_invoice_id, rec.contact_id, rec.sort_position, rec.is_billing, p_actor_id, p_actor_id
    );
    if rec.is_billing then
      billing_id := rec.contact_id;
    end if;
  end loop;

  return billing_id;
end;
$$;

revoke all on function private.replace_invoice_recipients(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function private.replace_schedule_recipients(
  p_org_id uuid,
  p_schedule_id uuid,
  p_actor_id uuid,
  p_recipients jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  billing_id uuid := null;
  rec record;
begin
  delete from public.recurring_invoice_schedule_recipients
  where org_id = p_org_id
    and schedule_id = p_schedule_id;

  for rec in
    select * from private.normalize_recipients_array(p_org_id, p_recipients)
  loop
    insert into public.recurring_invoice_schedule_recipients (
      org_id, schedule_id, contact_id, position, is_billing, created_by, updated_by
    ) values (
      p_org_id, p_schedule_id, rec.contact_id, rec.sort_position, rec.is_billing, p_actor_id, p_actor_id
    );
    if rec.is_billing then
      billing_id := rec.contact_id;
    end if;
  end loop;

  return billing_id;
end;
$$;

revoke all on function private.replace_schedule_recipients(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function private.copy_quote_recipients_to_invoice(
  p_org_id uuid,
  p_quote_id uuid,
  p_invoice_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.invoice_recipients (
    org_id, invoice_id, contact_id, position, is_billing, created_by, updated_by
  )
  select
    p_org_id, p_invoice_id, contact_id, position, is_billing, p_actor_id, p_actor_id
  from public.quote_recipients
  where org_id = p_org_id
    and quote_id = p_quote_id
  order by position, id;
end;
$$;

revoke all on function private.copy_quote_recipients_to_invoice(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function private.copy_schedule_recipients_to_invoice(
  p_org_id uuid,
  p_schedule_id uuid,
  p_invoice_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.invoice_recipients (
    org_id, invoice_id, contact_id, position, is_billing, created_by, updated_by
  )
  select
    p_org_id, p_invoice_id, contact_id, position, is_billing, p_actor_id, p_actor_id
  from public.recurring_invoice_schedule_recipients
  where org_id = p_org_id
    and schedule_id = p_schedule_id
  order by position, id;
end;
$$;

revoke all on function private.copy_schedule_recipients_to_invoice(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Patched RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_quote_draft(
  p_org_id uuid,
  p_payload jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  quote_row public.quotes;
  org_currency char(3);
  title text;
  currency text;
  issue_on date;
  valid_until date;
  v_discount_cents bigint;
  client_id uuid;
  lead_id uuid;
  contact_id uuid;
  owner_membership_id uuid;
  terms text;
  notes text;
  internal_notes text;
  allocated_number text;
  lines_json jsonb;
  recipients_json jsonb;
  line_totals record;
  recipients_input jsonb;
  billing_contact_id uuid;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Quote payload must be an object'
      using errcode = '22023';
  end if;

  select organisations.default_currency into org_currency
  from public.organisations
  where organisations.id = p_org_id
    and organisations.deleted_at is null;

  if not found then
    raise exception 'Organisation not found'
      using errcode = 'P0002';
  end if;

  title := nullif(trim(coalesce(p_payload ->> 'title', '')), '');
  if title is null or char_length(title) > 160 then
    raise exception 'Quote title must be between 1 and 160 characters'
      using errcode = '22023';
  end if;

  currency := upper(coalesce(nullif(trim(p_payload ->> 'currency'), ''), org_currency));
  if currency !~ '^[A-Z]{3}$' then
    raise exception 'Quote currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  issue_on := coalesce((p_payload ->> 'issue_on')::date, (timezone('utc', now()))::date);
  valid_until := nullif(p_payload ->> 'valid_until', '')::date;
  v_discount_cents := coalesce((p_payload ->> 'discount_cents')::bigint, 0);
  client_id := nullif(p_payload ->> 'client_id', '')::uuid;
  lead_id := nullif(p_payload ->> 'lead_id', '')::uuid;
  contact_id := nullif(p_payload ->> 'contact_id', '')::uuid;
  recipients_input := private.resolve_recipients_input(p_payload, true);
  -- Prefetch billing contact for header insert (junction written after insert).
  billing_contact_id := null;
  if jsonb_array_length(recipients_input) > 0 then
    select n.contact_id into billing_contact_id
    from private.normalize_recipients_array(p_org_id, recipients_input) n
    where n.is_billing
    limit 1;
    contact_id := billing_contact_id;
  else
    contact_id := null;
  end if;
  owner_membership_id := nullif(p_payload ->> 'owner_membership_id', '')::uuid;
  terms := nullif(trim(coalesce(p_payload ->> 'terms', '')), '');
  notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  internal_notes := nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '');

  if client_id is null and lead_id is null then
    raise exception 'Quote requires client_id or lead_id'
      using errcode = '22023';
  end if;

  if v_discount_cents < 0 then
    raise exception 'Quote discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  allocated_number := private.allocate_document_number(p_org_id, 'quote');

  perform set_config('app.allow_quote_totals', 'on', true);

  insert into public.quotes (
    org_id,
    number,
    title,
    client_id,
    lead_id,
    contact_id,
    owner_membership_id,
    status,
    currency,
    issue_on,
    valid_until,
    subtotal_cents,
    discount_cents,
    tax_cents,
    total_cents,
    party_snapshot,
    terms,
    notes,
    internal_notes,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    allocated_number,
    title,
    client_id,
    lead_id,
    contact_id,
    owner_membership_id,
    'draft',
    currency,
    issue_on,
    valid_until,
    0,
    0,
    0,
    0,
    '{}'::jsonb,
    terms,
    notes,
    internal_notes,
    actor_id,
    actor_id
  )
  returning * into quote_row;

  select * into line_totals
  from private.replace_quote_lines(
    p_org_id,
    quote_row.id,
    actor_id,
    coalesce(p_lines, '[]'::jsonb),
    currency::char(3)
  );

  if v_discount_cents > line_totals.subtotal_cents then
    raise exception 'Quote discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    'Quote total_cents'
  );

  update public.quotes
  set
    discount_cents = v_discount_cents,
    subtotal_cents = line_totals.subtotal_cents,
    tax_cents = line_totals.tax_cents,
    total_cents = line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    updated_by = actor_id
  where quotes.id = quote_row.id
  returning * into quote_row;

  select coalesce(
    jsonb_agg(to_jsonb(quote_lines) order by quote_lines.position, quote_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id;

  perform set_config('app.allow_quote_totals', 'off', true);


  -- Timeline: quote created (primary + client/lead fan-out)
  perform private.append_timeline_event(
    quote_row.org_id,
    'quote',
    quote_row.id,
    'status',
    'Quote created',
    null,
    actor_id,
    'quote',
    quote_row.id,
    jsonb_build_object(
      'action', 'quote.created',
      'quote_id', quote_row.id,
      'number', quote_row.number,
      'client_id', quote_row.client_id,
      'lead_id', quote_row.lead_id
    )
  );

  if quote_row.client_id is not null then
    perform private.append_timeline_event(
      quote_row.org_id,
      'client',
      quote_row.client_id,
      'status',
      'Quote created',
      format('Quote %s', quote_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.created',
        'quote_id', quote_row.id,
        'number', quote_row.number,
        'client_id', quote_row.client_id,
        'lead_id', quote_row.lead_id
      )
    );
  end if;

  if quote_row.lead_id is not null then
    perform private.append_timeline_event(
      quote_row.org_id,
      'lead',
      quote_row.lead_id,
      'status',
      'Quote created',
      format('Quote %s', quote_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.created',
        'quote_id', quote_row.id,
        'number', quote_row.number,
        'client_id', quote_row.client_id,
        'lead_id', quote_row.lead_id
      )
    );
  end if;

  perform private.replace_quote_recipients(
    p_org_id, quote_row.id, actor_id, recipients_input
  );
  select * into quote_row from public.quotes where quotes.id = quote_row.id;
  recipients_json := private.quote_recipients_json(p_org_id, quote_row.id);

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json,
    'recipients', recipients_json
  );
end;
$$;

create or replace function public.save_quote_draft(
  p_quote_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_lines jsonb default null,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  quote_row public.quotes;
  lines_json jsonb;
  next_title text;
  next_client_id uuid;
  next_lead_id uuid;
  next_contact_id uuid;
  next_owner_membership_id uuid;
  next_currency char(3);
  next_issue_on date;
  next_valid_until date;
  next_discount_cents bigint;
  next_terms text;
  next_notes text;
  next_internal_notes text;
  line_totals record;
  next_subtotal bigint;
  next_tax bigint;
  recipients_json jsonb;
  recipients_input jsonb;
  billing_contact_id uuid;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Quote payload must be an object'
      using errcode = '22023';
  end if;

  select * into quote_row
  from public.quotes
  where quotes.id = p_quote_id
    and quotes.org_id = p_org_id
    and quotes.deleted_at is null
  for update;

  if not found then
    raise exception 'Quote not found'
      using errcode = 'P0002';
  end if;

  if quote_row.version is distinct from p_expected_version then
    raise exception 'Quote version conflict'
      using errcode = 'P0001';
  end if;

  if quote_row.status <> 'draft' then
    raise exception 'Only draft quotes can be edited in this release'
      using errcode = '22023';
  end if;

  next_title := case
    when p_payload ? 'title' then nullif(trim(p_payload ->> 'title'), '')
    else quote_row.title
  end;
  next_client_id := case
    when p_payload ? 'client_id' then nullif(p_payload ->> 'client_id', '')::uuid
    else quote_row.client_id
  end;
  next_lead_id := case
    when p_payload ? 'lead_id' then nullif(p_payload ->> 'lead_id', '')::uuid
    else quote_row.lead_id
  end;
  next_contact_id := case
    when p_payload ? 'contact_id' then nullif(p_payload ->> 'contact_id', '')::uuid
    else quote_row.contact_id
  end;
  recipients_input := private.resolve_recipients_input(p_payload, false);
  if recipients_input is not null then
    billing_contact_id := null;
    if jsonb_array_length(recipients_input) > 0 then
      select n.contact_id into billing_contact_id
      from private.normalize_recipients_array(p_org_id, recipients_input) n
      where n.is_billing
      limit 1;
    end if;
    next_contact_id := billing_contact_id;
  end if;
  next_owner_membership_id := case
    when p_payload ? 'owner_membership_id'
      then nullif(p_payload ->> 'owner_membership_id', '')::uuid
    else quote_row.owner_membership_id
  end;
  next_currency := case
    when p_payload ? 'currency' then upper(trim(p_payload ->> 'currency'))
    else quote_row.currency
  end;
  next_issue_on := case
    when p_payload ? 'issue_on' then (p_payload ->> 'issue_on')::date
    else quote_row.issue_on
  end;
  next_valid_until := case
    when p_payload ? 'valid_until' then nullif(p_payload ->> 'valid_until', '')::date
    else quote_row.valid_until
  end;
  next_discount_cents := case
    when p_payload ? 'discount_cents' then (p_payload ->> 'discount_cents')::bigint
    else quote_row.discount_cents
  end;
  next_terms := case
    when p_payload ? 'terms' then nullif(trim(coalesce(p_payload ->> 'terms', '')), '')
    else quote_row.terms
  end;
  next_notes := case
    when p_payload ? 'notes' then nullif(trim(coalesce(p_payload ->> 'notes', '')), '')
    else quote_row.notes
  end;
  next_internal_notes := case
    when p_payload ? 'internal_notes'
      then nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '')
    else quote_row.internal_notes
  end;

  if next_title is null or char_length(next_title) > 160 then
    raise exception 'Quote title must be between 1 and 160 characters'
      using errcode = '22023';
  end if;

  if next_currency !~ '^[A-Z]{3}$' then
    raise exception 'Quote currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  if next_client_id is null and next_lead_id is null then
    raise exception 'Quote requires client_id or lead_id'
      using errcode = '22023';
  end if;

  if next_discount_cents < 0 then
    raise exception 'Quote discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  if next_currency is distinct from quote_row.currency and p_lines is null then
    raise exception 'Changing quote currency requires replacing lines'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_quote_totals', 'on', true);

  if p_lines is not null then
    select * into line_totals
    from private.replace_quote_lines(
      p_org_id,
      quote_row.id,
      actor_id,
      p_lines,
      next_currency
    );
    next_subtotal := line_totals.subtotal_cents;
    next_tax := line_totals.tax_cents;
  else
    select
      coalesce(sum(quote_lines.subtotal_cents), 0),
      coalesce(sum(quote_lines.tax_cents), 0)
    into next_subtotal, next_tax
    from public.quote_lines
    where quote_lines.quote_id = quote_row.id;
  end if;

  if next_discount_cents > next_subtotal then
    raise exception 'Quote discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    next_subtotal - next_discount_cents + next_tax,
    'Quote total_cents'
  );

  update public.quotes
  set
    title = next_title,
    client_id = next_client_id,
    lead_id = next_lead_id,
    contact_id = next_contact_id,
    owner_membership_id = next_owner_membership_id,
    currency = next_currency,
    issue_on = next_issue_on,
    valid_until = next_valid_until,
    discount_cents = next_discount_cents,
    subtotal_cents = next_subtotal,
    tax_cents = next_tax,
    total_cents = next_subtotal - next_discount_cents + next_tax,
    terms = next_terms,
    notes = next_notes,
    internal_notes = next_internal_notes,
    updated_by = actor_id
  where quotes.id = quote_row.id
  returning * into quote_row;

  if recipients_input is not null then
    perform private.replace_quote_recipients(
      p_org_id, quote_row.id, actor_id, recipients_input
    );
    select * into quote_row from public.quotes where quotes.id = quote_row.id;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(quote_lines) order by quote_lines.position, quote_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id;

  recipients_json := private.quote_recipients_json(p_org_id, quote_row.id);

  perform set_config('app.allow_quote_totals', 'off', true);

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json,
    'recipients', recipients_json
  );
end;
$$;

create or replace function public.get_quote_document(
  p_quote_id uuid,
  p_org_id uuid,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  quote_row public.quotes;
  lines_json jsonb;
  recipients_json jsonb;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member', 'readonly']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member', 'readonly'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  -- Lock the header for the duration of this transaction so a concurrent save
  -- cannot replace lines between header and line reads.
  select * into quote_row
  from public.quotes
  where quotes.id = p_quote_id
    and quotes.org_id = p_org_id
    and quotes.deleted_at is null
  for share;

  if not found then
    raise exception 'Quote not found'
      using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(quote_lines) order by quote_lines.position, quote_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id
    and quote_lines.org_id = quote_row.org_id;

  recipients_json := private.quote_recipients_json(p_org_id, quote_row.id);

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json,
    'recipients', recipients_json
  );
end;
$$;

create or replace function public.create_invoice_draft(
  p_org_id uuid,
  p_payload jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  invoice_row public.invoices;
  org_currency char(3);
  currency text;
  issue_on date;
  due_on date;
  v_discount_cents bigint;
  client_id uuid;
  contact_id uuid;
  owner_membership_id uuid;
  purchase_order_number text;
  payment_terms text;
  notes text;
  internal_notes text;
  allocated_number text;
  lines_json jsonb;
  recipients_json jsonb;
  line_totals record;
  recipients_input jsonb;
  billing_contact_id uuid;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invoice payload must be an object'
      using errcode = '22023';
  end if;

  select organisations.default_currency into org_currency
  from public.organisations
  where organisations.id = p_org_id
    and organisations.deleted_at is null;

  if not found then
    raise exception 'Organisation not found'
      using errcode = 'P0002';
  end if;

  client_id := nullif(p_payload ->> 'client_id', '')::uuid;
  if client_id is null then
    raise exception 'Invoice requires client_id'
      using errcode = '22023';
  end if;

  contact_id := nullif(p_payload ->> 'contact_id', '')::uuid;
  recipients_input := private.resolve_recipients_input(p_payload, true);
  billing_contact_id := null;
  if jsonb_array_length(recipients_input) > 0 then
    select n.contact_id into billing_contact_id
    from private.normalize_recipients_array(p_org_id, recipients_input) n
    where n.is_billing
    limit 1;
    contact_id := billing_contact_id;
  else
    contact_id := null;
  end if;
  owner_membership_id := nullif(p_payload ->> 'owner_membership_id', '')::uuid;

  currency := upper(coalesce(nullif(trim(p_payload ->> 'currency'), ''), org_currency));
  if currency !~ '^[A-Z]{3}$' then
    raise exception 'Invoice currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  issue_on := coalesce((p_payload ->> 'issue_on')::date, (timezone('utc', now()))::date);
  due_on := coalesce((p_payload ->> 'due_on')::date, issue_on + 30);

  if due_on < issue_on then
    raise exception 'Invoice due_on cannot be before issue_on'
      using errcode = '22023';
  end if;

  v_discount_cents := coalesce((p_payload ->> 'discount_cents')::bigint, 0);
  if v_discount_cents < 0 then
    raise exception 'Invoice discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  purchase_order_number := nullif(trim(coalesce(p_payload ->> 'purchase_order_number', '')), '');
  payment_terms := nullif(trim(coalesce(p_payload ->> 'payment_terms', '')), '');
  notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  internal_notes := nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '');

  allocated_number := private.allocate_document_number(p_org_id, 'invoice');

  perform set_config('app.allow_invoice_totals', 'on', true);

  insert into public.invoices (
    org_id,
    number,
    client_id,
    contact_id,
    owner_membership_id,
    source,
    status,
    currency,
    issue_on,
    due_on,
    purchase_order_number,
    subtotal_cents,
    discount_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_due_cents,
    party_snapshot,
    payment_terms,
    notes,
    internal_notes,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    allocated_number,
    client_id,
    contact_id,
    owner_membership_id,
    'manual',
    'draft',
    currency,
    issue_on,
    due_on,
    purchase_order_number,
    0,
    0,
    0,
    0,
    0,
    0,
    '{}'::jsonb,
    payment_terms,
    notes,
    internal_notes,
    actor_id,
    actor_id
  )
  returning * into invoice_row;

  select * into line_totals
  from private.replace_invoice_lines(
    p_org_id,
    invoice_row.id,
    actor_id,
    coalesce(p_lines, '[]'::jsonb),
    currency::char(3)
  );

  if v_discount_cents > line_totals.subtotal_cents then
    raise exception 'Invoice discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    'Invoice total_cents'
  );

  update public.invoices
  set
    discount_cents = v_discount_cents,
    subtotal_cents = line_totals.subtotal_cents,
    tax_cents = line_totals.tax_cents,
    total_cents = line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    balance_due_cents = line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    updated_by = actor_id
  where invoices.id = invoice_row.id
  returning * into invoice_row;

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_lines.invoice_id = invoice_row.id;

  perform set_config('app.allow_invoice_totals', 'off', true);


  -- Timeline: invoice created (primary + client fan-out)
  perform private.append_timeline_event(
    invoice_row.org_id,
    'invoice',
    invoice_row.id,
    'status',
    'Invoice created',
    null,
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.created',
      'invoice_id', invoice_row.id,
      'number', invoice_row.number,
      'client_id', invoice_row.client_id
    )
  );

  perform private.append_timeline_event(
    invoice_row.org_id,
    'client',
    invoice_row.client_id,
    'status',
    'Invoice created',
    format('Invoice %s', invoice_row.number),
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.created',
      'invoice_id', invoice_row.id,
      'number', invoice_row.number,
      'client_id', invoice_row.client_id
    )
  );

  perform private.replace_invoice_recipients(
    p_org_id, invoice_row.id, actor_id, recipients_input
  );
  select * into invoice_row from public.invoices where invoices.id = invoice_row.id;
  recipients_json := private.invoice_recipients_json(p_org_id, invoice_row.id);

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'recipients', recipients_json
  );
end;
$$;

create or replace function public.save_invoice_draft(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_lines jsonb default null,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  invoice_row public.invoices;
  client_row public.clients;
  contact_row public.contacts;
  lines_json jsonb;
  next_client_id uuid;
  next_contact_id uuid;
  next_owner_membership_id uuid;
  next_currency char(3);
  next_issue_on date;
  next_due_on date;
  next_discount_cents bigint;
  next_purchase_order_number text;
  next_payment_terms text;
  next_notes text;
  next_internal_notes text;
  next_party_snapshot jsonb;
  line_totals record;
  next_subtotal bigint;
  next_tax bigint;
  recipients_json jsonb;
  recipients_input jsonb;
  billing_contact_id uuid;
  recipient_ids uuid[];
  recipients_changed boolean := false;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invoice payload must be an object'
      using errcode = '22023';
  end if;

  select * into invoice_row
  from public.invoices
  where invoices.id = p_invoice_id
    and invoices.org_id = p_org_id
    and invoices.deleted_at is null
  for update;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  if invoice_row.version is distinct from p_expected_version then
    raise exception 'Invoice version conflict'
      using errcode = 'P0001';
  end if;

  if invoice_row.status <> 'draft' then
    raise exception 'Only draft invoices can be edited in this release'
      using errcode = '22023';
  end if;

  next_client_id := case
    when p_payload ? 'client_id' then nullif(p_payload ->> 'client_id', '')::uuid
    else invoice_row.client_id
  end;
  if next_client_id is null then
    raise exception 'Invoice requires client_id'
      using errcode = '22023';
  end if;

  next_contact_id := case
    when p_payload ? 'contact_id' then nullif(p_payload ->> 'contact_id', '')::uuid
    else invoice_row.contact_id
  end;
  recipients_input := private.resolve_recipients_input(p_payload, false);
  if recipients_input is not null then
    billing_contact_id := null;
    if jsonb_array_length(recipients_input) > 0 then
      select n.contact_id into billing_contact_id
      from private.normalize_recipients_array(p_org_id, recipients_input) n
      where n.is_billing
      limit 1;
    end if;
    next_contact_id := billing_contact_id;
    recipients_changed := true;
  end if;
  next_owner_membership_id := case
    when p_payload ? 'owner_membership_id'
      then nullif(p_payload ->> 'owner_membership_id', '')::uuid
    else invoice_row.owner_membership_id
  end;
  next_currency := case
    when p_payload ? 'currency' then upper(trim(p_payload ->> 'currency'))
    else invoice_row.currency
  end;
  next_issue_on := case
    when p_payload ? 'issue_on' then (p_payload ->> 'issue_on')::date
    else invoice_row.issue_on
  end;
  next_due_on := case
    when p_payload ? 'due_on' then (p_payload ->> 'due_on')::date
    else invoice_row.due_on
  end;
  next_discount_cents := case
    when p_payload ? 'discount_cents' then (p_payload ->> 'discount_cents')::bigint
    else invoice_row.discount_cents
  end;
  next_purchase_order_number := case
    when p_payload ? 'purchase_order_number'
      then nullif(trim(coalesce(p_payload ->> 'purchase_order_number', '')), '')
    else invoice_row.purchase_order_number
  end;
  next_payment_terms := case
    when p_payload ? 'payment_terms'
      then nullif(trim(coalesce(p_payload ->> 'payment_terms', '')), '')
    else invoice_row.payment_terms
  end;
  next_notes := case
    when p_payload ? 'notes' then nullif(trim(coalesce(p_payload ->> 'notes', '')), '')
    else invoice_row.notes
  end;
  next_internal_notes := case
    when p_payload ? 'internal_notes'
      then nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '')
    else invoice_row.internal_notes
  end;

  if next_currency !~ '^[A-Z]{3}$' then
    raise exception 'Invoice currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  if next_discount_cents < 0 then
    raise exception 'Invoice discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  if next_due_on < next_issue_on then
    raise exception 'Invoice due_on cannot be before issue_on'
      using errcode = '22023';
  end if;

  if next_currency is distinct from invoice_row.currency and p_lines is null then
    raise exception 'Changing invoice currency requires replacing lines'
      using errcode = '22023';
  end if;

  -- Draft party/recipient changes rebuild the snapshot immediately (incl contacts[]).
  next_party_snapshot := invoice_row.party_snapshot;
  if next_client_id is distinct from invoice_row.client_id
    or next_contact_id is distinct from invoice_row.contact_id
    or recipients_changed
  then
    if recipients_input is not null then
      select coalesce(array_agg(n.contact_id order by n.sort_position), array[]::uuid[])
      into recipient_ids
      from private.normalize_recipients_array(p_org_id, recipients_input) n;
    else
      recipient_ids := private.invoice_recipient_contact_ids(p_org_id, invoice_row.id);
      -- If billing contact changed without recipients payload, keep list but ensure billing present.
      if next_contact_id is not null
        and not (next_contact_id = any (recipient_ids))
      then
        recipient_ids := array[next_contact_id] || recipient_ids;
      elsif next_contact_id is null then
        recipient_ids := array[]::uuid[];
      end if;
    end if;

    next_party_snapshot := private.build_receivable_party_snapshot(
      p_org_id,
      next_client_id,
      next_contact_id,
      recipient_ids
    );
  end if;

  perform set_config('app.allow_invoice_totals', 'on', true);

  if p_lines is not null then
    select * into line_totals
    from private.replace_invoice_lines(
      p_org_id,
      invoice_row.id,
      actor_id,
      p_lines,
      next_currency
    );
    next_subtotal := line_totals.subtotal_cents;
    next_tax := line_totals.tax_cents;
  else
    select
      coalesce(sum(invoice_lines.subtotal_cents), 0),
      coalesce(sum(invoice_lines.tax_cents), 0)
    into next_subtotal, next_tax
    from public.invoice_lines
    where invoice_lines.invoice_id = invoice_row.id;
  end if;

  if next_discount_cents > next_subtotal then
    raise exception 'Invoice discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    next_subtotal - next_discount_cents + next_tax,
    'Invoice total_cents'
  );

  update public.invoices
  set
    client_id = next_client_id,
    contact_id = next_contact_id,
    owner_membership_id = next_owner_membership_id,
    currency = next_currency,
    issue_on = next_issue_on,
    due_on = next_due_on,
    purchase_order_number = next_purchase_order_number,
    discount_cents = next_discount_cents,
    subtotal_cents = next_subtotal,
    tax_cents = next_tax,
    total_cents = next_subtotal - next_discount_cents + next_tax,
    balance_due_cents = next_subtotal - next_discount_cents + next_tax,
    party_snapshot = next_party_snapshot,
    payment_terms = next_payment_terms,
    notes = next_notes,
    internal_notes = next_internal_notes,
    updated_by = actor_id
  where invoices.id = invoice_row.id
  returning * into invoice_row;

  if recipients_input is not null then
    perform private.replace_invoice_recipients(
      p_org_id, invoice_row.id, actor_id, recipients_input
    );
    select * into invoice_row from public.invoices where invoices.id = invoice_row.id;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_lines.invoice_id = invoice_row.id;

  recipients_json := private.invoice_recipients_json(p_org_id, invoice_row.id);

  perform set_config('app.allow_invoice_totals', 'off', true);

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'recipients', recipients_json
  );
end;
$$;

create or replace function public.get_invoice_document(
  p_invoice_id uuid,
  p_org_id uuid,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  invoice_row public.invoices;
  lines_json jsonb;
  recipients_json jsonb;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member', 'billing', 'readonly']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member', 'billing', 'readonly'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  -- Lock the header for the duration of this transaction so a concurrent
  -- save cannot replace lines between header and line reads.
  select * into invoice_row
  from public.invoices
  where invoices.id = p_invoice_id
    and invoices.org_id = p_org_id
    and invoices.deleted_at is null
  for share;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_lines.invoice_id = invoice_row.id
    and invoice_lines.org_id = invoice_row.org_id;

  recipients_json := private.invoice_recipients_json(p_org_id, invoice_row.id);

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'recipients', recipients_json
  );
end;
$$;

create or replace function public.send_quote(
  p_quote_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  quote_row public.quotes;
  client_row public.clients;
  contact_row public.contacts;
  snapshot jsonb;
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into quote_row
  from public.quotes
  where quotes.id = p_quote_id
    and quotes.org_id = p_org_id
    and quotes.deleted_at is null
  for update;

  if not found then
    raise exception 'Quote not found'
      using errcode = 'P0002';
  end if;

  if quote_row.version is distinct from p_expected_version then
    raise exception 'Quote version conflict'
      using errcode = 'P0001';
  end if;

  if quote_row.status <> 'draft' then
    raise exception 'Only draft quotes can be sent'
      using errcode = '22023';
  end if;

  if quote_row.client_id is not null then
    select * into client_row
    from public.clients
    where clients.id = quote_row.client_id
      and clients.org_id = p_org_id;

    if not found then
      raise exception 'Quote client not found'
        using errcode = 'P0002';
    end if;

    snapshot := private.build_receivable_party_snapshot(
      p_org_id,
      quote_row.client_id,
      quote_row.contact_id,
      private.quote_recipient_contact_ids(p_org_id, quote_row.id)
    );
  else
    snapshot := quote_row.party_snapshot;
  end if;

  perform set_config('app.allow_quote_lifecycle', 'on', true);
  perform set_config('app.allow_quote_totals', 'on', true);

  update public.quotes
  set
    status = 'sent',
    party_snapshot = coalesce(snapshot, party_snapshot),
    sent_at = now(),
    updated_by = actor_id
  where quotes.id = quote_row.id
  returning * into quote_row;

  perform set_config('app.allow_quote_lifecycle', 'off', true);
  perform set_config('app.allow_quote_totals', 'off', true);

  select coalesce(
    jsonb_agg(to_jsonb(quote_lines) order by quote_lines.position, quote_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id;

  perform private.append_timeline_event(
    quote_row.org_id,
    'quote',
    quote_row.id,
    'status',
    'Quote sent',
    null,
    actor_id,
    'quote',
    quote_row.id,
    jsonb_build_object(
      'action', 'quote.sent',
      'quote_id', quote_row.id,
      'number', quote_row.number,
      'client_id', quote_row.client_id
    )
  );

  if quote_row.client_id is not null then
    perform private.append_timeline_event(
      quote_row.org_id,
      'client',
      quote_row.client_id,
      'status',
      'Quote sent',
      format('Quote %s', quote_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.sent',
        'quote_id', quote_row.id,
        'number', quote_row.number,
        'client_id', quote_row.client_id
      )
    );
  end if;

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json,
    'recipients', private.quote_recipients_json(p_org_id, quote_row.id)
  );
end;
$$;

create or replace function public.accept_quote(
  p_quote_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  quote_row public.quotes;
  client_row public.clients;
  contact_row public.contacts;
  snapshot jsonb;
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into quote_row
  from public.quotes
  where quotes.id = p_quote_id
    and quotes.org_id = p_org_id
    and quotes.deleted_at is null
  for update;

  if not found then
    raise exception 'Quote not found'
      using errcode = 'P0002';
  end if;

  if quote_row.version is distinct from p_expected_version then
    raise exception 'Quote version conflict'
      using errcode = 'P0001';
  end if;

  if quote_row.status not in ('draft', 'sent') then
    raise exception 'Only draft or sent quotes can be accepted'
      using errcode = '22023';
  end if;

  if quote_row.client_id is null then
    raise exception 'Only quotes with a client can be accepted for invoicing'
      using errcode = '22023';
  end if;

  select * into client_row
  from public.clients
  where clients.id = quote_row.client_id
    and clients.org_id = p_org_id;

  if not found then
    raise exception 'Quote client not found'
      using errcode = 'P0002';
  end if;

  snapshot := private.build_receivable_party_snapshot(
    p_org_id,
    quote_row.client_id,
    quote_row.contact_id,
    private.quote_recipient_contact_ids(p_org_id, quote_row.id)
  );

  perform set_config('app.allow_quote_lifecycle', 'on', true);
  perform set_config('app.allow_quote_totals', 'on', true);

  update public.quotes
  set
    status = 'accepted',
    party_snapshot = snapshot,
    accepted_at = now(),
    updated_by = actor_id
  where quotes.id = quote_row.id
  returning * into quote_row;

  perform set_config('app.allow_quote_lifecycle', 'off', true);
  perform set_config('app.allow_quote_totals', 'off', true);

  select coalesce(
    jsonb_agg(to_jsonb(quote_lines) order by quote_lines.position, quote_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id;


  -- Timeline: quote accepted (primary + client fan-out)
  perform private.append_timeline_event(
    quote_row.org_id,
    'quote',
    quote_row.id,
    'status',
    'Quote accepted',
    null,
    actor_id,
    'quote',
    quote_row.id,
    jsonb_build_object(
      'action', 'quote.accepted',
      'quote_id', quote_row.id,
      'number', quote_row.number,
      'client_id', quote_row.client_id
    )
  );

  if quote_row.client_id is not null then
    perform private.append_timeline_event(
      quote_row.org_id,
      'client',
      quote_row.client_id,
      'status',
      'Quote accepted',
      format('Quote %s', quote_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.accepted',
        'quote_id', quote_row.id,
        'number', quote_row.number,
        'client_id', quote_row.client_id
      )
    );
  end if;

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json,
    'recipients', private.quote_recipients_json(p_org_id, quote_row.id)
  );
end;
$$;

create or replace function public.send_invoice(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.invoices;
  client_row public.clients;
  contact_row public.contacts;
  snapshot jsonb;
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into invoice_row
  from public.invoices
  where invoices.id = p_invoice_id
    and invoices.org_id = p_org_id
    and invoices.deleted_at is null
  for update;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  if invoice_row.version is distinct from p_expected_version then
    raise exception 'Invoice version conflict'
      using errcode = 'P0001';
  end if;

  if invoice_row.status <> 'draft' then
    raise exception 'Only draft invoices can be sent'
      using errcode = '22023';
  end if;

  -- Quote-derived invoices keep the accepted (or draft-updated) party snapshot.
  -- Manual drafts still freeze live client/contact data at send time.
  if invoice_row.source = 'quote'
    and invoice_row.party_snapshot ? 'client'
  then
    snapshot := invoice_row.party_snapshot;
  else
    snapshot := private.build_receivable_party_snapshot(
      p_org_id,
      invoice_row.client_id,
      invoice_row.contact_id,
      private.invoice_recipient_contact_ids(p_org_id, invoice_row.id)
    );
  end if;

  perform set_config('app.allow_invoice_lifecycle', 'on', true);

  update public.invoices
  set
    status = 'sent',
    party_snapshot = snapshot,
    balance_due_cents = invoices.total_cents - invoices.paid_cents,
    sent_at = now(),
    updated_by = actor_id
  where invoices.id = invoice_row.id
  returning * into invoice_row;

  perform set_config('app.allow_invoice_lifecycle', 'off', true);

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_lines.invoice_id = invoice_row.id;


  -- Timeline: invoice sent (primary + client fan-out)
  perform private.append_timeline_event(
    invoice_row.org_id,
    'invoice',
    invoice_row.id,
    'status',
    'Invoice sent',
    null,
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.sent',
      'invoice_id', invoice_row.id,
      'number', invoice_row.number,
      'client_id', invoice_row.client_id
    )
  );

  perform private.append_timeline_event(
    invoice_row.org_id,
    'client',
    invoice_row.client_id,
    'status',
    'Invoice sent',
    format('Invoice %s', invoice_row.number),
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.sent',
      'invoice_id', invoice_row.id,
      'number', invoice_row.number,
      'client_id', invoice_row.client_id
    )
  );

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'recipients', private.invoice_recipients_json(p_org_id, invoice_row.id)
  );
end;
$$;

create or replace function public.create_invoice_from_quote(
  p_quote_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  quote_row public.quotes;
  invoice_row public.invoices;
  allocated_number text;
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into quote_row
  from public.quotes
  where quotes.id = p_quote_id
    and quotes.org_id = p_org_id
    and quotes.deleted_at is null
  for update;

  if not found then
    raise exception 'Quote not found'
      using errcode = 'P0002';
  end if;

  -- Idempotent reconvert: return the previously converted *live* invoice.
  -- Soft-deleted conversion targets are ignored and the link is cleared so a
  -- fresh draft can be created (soft_delete_invoice_draft also clears the link).
  if quote_row.converted_invoice_id is not null then
    select * into invoice_row
    from public.invoices
    where invoices.id = quote_row.converted_invoice_id
      and invoices.org_id = p_org_id
      and invoices.deleted_at is null;

    if found then
      select coalesce(
        jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
        '[]'::jsonb
      )
      into lines_json
      from public.invoice_lines
      where invoice_lines.invoice_id = invoice_row.id;

      return jsonb_build_object(
        'invoice', to_jsonb(invoice_row),
        'lines', lines_json,
        'recipients', private.invoice_recipients_json(p_org_id, invoice_row.id),
        'created', false
      );
    end if;

    perform set_config('app.allow_quote_lifecycle', 'on', true);
    perform set_config('app.allow_quote_totals', 'on', true);

    update public.quotes
    set
      converted_invoice_id = null,
      updated_by = actor_id
    where quotes.id = quote_row.id;

    quote_row.converted_invoice_id := null;

    perform set_config('app.allow_quote_lifecycle', 'off', true);
    perform set_config('app.allow_quote_totals', 'off', true);
  end if;

  if quote_row.status <> 'accepted' then
    raise exception 'Only accepted quotes can be converted to an invoice'
      using errcode = '22023';
  end if;

  if quote_row.client_id is null then
    raise exception 'Only quotes with a client can be converted to an invoice'
      using errcode = '22023';
  end if;

  allocated_number := private.allocate_document_number(p_org_id, 'invoice');

  perform set_config('app.allow_invoice_totals', 'on', true);

  insert into public.invoices (
    org_id,
    number,
    client_id,
    contact_id,
    quote_id,
    owner_membership_id,
    source,
    status,
    currency,
    issue_on,
    due_on,
    subtotal_cents,
    discount_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_due_cents,
    party_snapshot,
    notes,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    allocated_number,
    quote_row.client_id,
    quote_row.contact_id,
    quote_row.id,
    quote_row.owner_membership_id,
    'quote',
    'draft',
    quote_row.currency,
    (timezone('utc', now()))::date,
    (timezone('utc', now()))::date + 30,
    quote_row.subtotal_cents,
    quote_row.discount_cents,
    quote_row.tax_cents,
    quote_row.total_cents,
    0,
    quote_row.total_cents,
    quote_row.party_snapshot,
    quote_row.notes,
    actor_id,
    actor_id
  )
  returning * into invoice_row;

  -- Copy immutable line snapshots without recalculating or mutating the quote.
  insert into public.invoice_lines (
    org_id,
    invoice_id,
    product_id,
    sku_snapshot,
    description,
    quantity,
    unit_price_cents,
    discount_percent,
    tax_rate_percent,
    subtotal_cents,
    tax_cents,
    total_cents,
    position,
    created_by,
    updated_by
  )
  select
    quote_lines.org_id,
    invoice_row.id,
    quote_lines.product_id,
    quote_lines.sku_snapshot,
    quote_lines.description,
    quote_lines.quantity,
    quote_lines.unit_price_cents,
    quote_lines.discount_percent,
    quote_lines.tax_rate_percent,
    quote_lines.subtotal_cents,
    quote_lines.tax_cents,
    quote_lines.total_cents,
    quote_lines.position,
    actor_id,
    actor_id
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id
    and quote_lines.org_id = p_org_id;

  perform private.copy_quote_recipients_to_invoice(
    p_org_id, quote_row.id, invoice_row.id, actor_id
  );

  perform set_config('app.allow_invoice_totals', 'off', true);

  -- converted_invoice_id is protected by allow_quote_totals, and editing a
  -- non-draft (accepted) quote at all requires allow_quote_lifecycle.
  perform set_config('app.allow_quote_lifecycle', 'on', true);
  perform set_config('app.allow_quote_totals', 'on', true);

  update public.quotes
  set
    converted_invoice_id = invoice_row.id,
    updated_by = actor_id
  where quotes.id = quote_row.id;

  perform set_config('app.allow_quote_lifecycle', 'off', true);
  perform set_config('app.allow_quote_totals', 'off', true);

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_lines.invoice_id = invoice_row.id;


  -- Timeline: quote → invoice conversion (quote + invoice primaries + client fan-out)
  -- Only on fresh create (idempotent reconvert returns earlier).
  perform private.append_timeline_event(
    quote_row.org_id,
    'quote',
    quote_row.id,
    'conversion',
    'Quote converted to invoice',
    format('Created invoice %s', invoice_row.number),
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'quote.converted_to_invoice',
      'quote_id', quote_row.id,
      'invoice_id', invoice_row.id,
      'quote_number', quote_row.number,
      'invoice_number', invoice_row.number,
      'client_id', quote_row.client_id
    )
  );

  perform private.append_timeline_event(
    invoice_row.org_id,
    'invoice',
    invoice_row.id,
    'conversion',
    'Invoice created from quote',
    format('Converted from quote %s', quote_row.number),
    actor_id,
    'quote',
    quote_row.id,
    jsonb_build_object(
      'action', 'quote.converted_to_invoice',
      'quote_id', quote_row.id,
      'invoice_id', invoice_row.id,
      'quote_number', quote_row.number,
      'invoice_number', invoice_row.number,
      'client_id', invoice_row.client_id
    )
  );

  if quote_row.client_id is not null then
    perform private.append_timeline_event(
      quote_row.org_id,
      'client',
      quote_row.client_id,
      'conversion',
      'Quote converted to invoice',
      format('%s → %s', quote_row.number, invoice_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.converted_to_invoice',
        'quote_id', quote_row.id,
        'invoice_id', invoice_row.id,
        'quote_number', quote_row.number,
        'invoice_number', invoice_row.number,
        'client_id', quote_row.client_id
      )
    );
  end if;

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'recipients', private.invoice_recipients_json(p_org_id, invoice_row.id),
    'created', true
  );
end;
$$;

create or replace function private.generate_invoice_from_recurring_run(
  p_org_id uuid,
  p_schedule public.recurring_invoice_schedules,
  p_run public.recurring_invoice_runs,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  allocated_number text;
  lines_json jsonb := '[]'::jsonb;
  invoice_lines_payload jsonb := '[]'::jsonb;
  line_row public.recurring_invoice_lines;
  description text;
  line_totals record;
  issue_on date := p_run.occurrence_local_date;
  due_on date := p_run.occurrence_local_date + p_schedule.due_days;
begin
  for line_row in
    select *
    from public.recurring_invoice_lines
    where schedule_id = p_schedule.id
      and org_id = p_org_id
      and deleted_at is null
      and active
    order by position, id
  loop
    description := line_row.description_template;
    description := replace(description, '{{period_start}}', p_run.period_start::text);
    description := replace(description, '{{period_end}}', p_run.period_end::text);
    description := replace(description, '{{issue_date}}', issue_on::text);
    if char_length(description) > 200 then
      description := left(description, 200);
    end if;

    invoice_lines_payload := invoice_lines_payload || jsonb_build_array(
      jsonb_build_object(
        'product_id', line_row.product_id,
        'description', description,
        'quantity', line_row.quantity,
        'unit_price_cents', line_row.unit_price_cents,
        'discount_percent', line_row.discount_percent,
        'tax_rate_percent', line_row.tax_rate_percent,
        'position', line_row.position
      )
    );
  end loop;

  if jsonb_array_length(invoice_lines_payload) < 1 then
    raise exception 'Recurring run requires at least one active line'
      using errcode = '22023';
  end if;

  allocated_number := private.allocate_document_number(p_org_id, 'invoice');

  perform set_config('app.allow_invoice_totals', 'on', true);

  insert into public.invoices (
    org_id, number, client_id, contact_id, owner_membership_id,
    source, recurring_run_id, status, currency, issue_on, due_on,
    billing_period_start, billing_period_end,
    purchase_order_number, subtotal_cents, discount_cents, tax_cents,
    total_cents, paid_cents, balance_due_cents, party_snapshot,
    payment_terms, notes, internal_notes, created_by, updated_by
  ) values (
    p_org_id, allocated_number, p_schedule.client_id, p_schedule.contact_id,
    p_schedule.owner_membership_id, 'recurring', p_run.id, 'draft',
    p_schedule.currency, issue_on, due_on,
    p_run.period_start, p_run.period_end,
    p_schedule.purchase_order_number, 0, 0, 0, 0, 0, 0, '{}'::jsonb,
    p_schedule.payment_terms, p_schedule.notes, p_schedule.internal_notes,
    p_actor_id, p_actor_id
  )
  returning * into invoice_row;

  perform private.copy_schedule_recipients_to_invoice(
    p_org_id, p_schedule.id, invoice_row.id, p_actor_id
  );

  select * into line_totals
  from private.replace_invoice_lines(
    p_org_id, invoice_row.id, p_actor_id, invoice_lines_payload, p_schedule.currency
  );

  perform private.assert_json_safe_cents(
    line_totals.subtotal_cents + line_totals.tax_cents,
    'Invoice total_cents'
  );

  update public.invoices
  set
    subtotal_cents = line_totals.subtotal_cents,
    tax_cents = line_totals.tax_cents,
    total_cents = line_totals.subtotal_cents + line_totals.tax_cents,
    balance_due_cents = line_totals.subtotal_cents + line_totals.tax_cents,
    updated_by = p_actor_id
  where id = invoice_row.id
  returning * into invoice_row;

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_id = invoice_row.id;

  perform set_config('app.allow_invoice_totals', 'off', true);

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json
  );
end;
$$;

create or replace function private.recurring_schedule_document(
  p_schedule_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  schedule_row public.recurring_invoice_schedules;
  lines_json jsonb;
  recipients_json jsonb;
begin
  select * into schedule_row
  from public.recurring_invoice_schedules
  where recurring_invoice_schedules.id = p_schedule_id
    and recurring_invoice_schedules.org_id = p_org_id
    and recurring_invoice_schedules.deleted_at is null;

  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(recurring_invoice_lines) order by recurring_invoice_lines.position, recurring_invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.recurring_invoice_lines
  where recurring_invoice_lines.schedule_id = schedule_row.id
    and recurring_invoice_lines.org_id = p_org_id
    and recurring_invoice_lines.deleted_at is null;

  recipients_json := private.schedule_recipients_json(p_org_id, schedule_row.id);

  return jsonb_build_object(
    'schedule', to_jsonb(schedule_row),
    'lines', lines_json,
    'recipients', recipients_json
  );
end;
$$;

create or replace function public.create_recurring_schedule_draft(
  p_org_id uuid,
  p_payload jsonb,
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  schedule_row public.recurring_invoice_schedules;
  org_currency char(3);
  org_tz text;
  v_name text;
  v_client_id uuid;
  v_contact_id uuid;
  v_owner_membership_id uuid;
  v_currency char(3);
  v_frequency text;
  v_interval_count smallint;
  v_anchor_on date;
  v_weekdays smallint[];
  v_day_of_month smallint;
  v_month_of_year smallint;
  v_month_end_policy text;
  v_timezone text;
  v_local_run_time time;
  v_start_on date;
  v_end_on date;
  v_max_occurrences integer;
  v_due_days smallint;
  v_delivery_mode text;
  v_pricing_mode text;
  v_catch_up_policy text;
  v_max_catch_up_runs smallint;
  v_purchase_order_number text;
  v_payment_terms text;
  v_notes text;
  v_internal_notes text;
  wd jsonb;
  elem text;
  recipients_input jsonb;
  billing_contact_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Schedule payload must be an object' using errcode = '22023';
  end if;

  select organisations.default_currency, organisations.timezone
  into org_currency, org_tz
  from public.organisations
  where organisations.id = p_org_id and organisations.deleted_at is null;
  if not found then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  v_name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
  if v_name is null or char_length(v_name) > 200 then
    raise exception 'Schedule name must be between 1 and 200 characters' using errcode = '22023';
  end if;

  v_client_id := nullif(p_payload ->> 'client_id', '')::uuid;
  if v_client_id is null then
    raise exception 'Schedule requires client_id' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.clients
    where clients.id = v_client_id and clients.org_id = p_org_id and clients.deleted_at is null
  ) then
    raise exception 'Schedule client not found in organisation' using errcode = '22023';
  end if;

  v_contact_id := nullif(p_payload ->> 'contact_id', '')::uuid;
  recipients_input := private.resolve_recipients_input(p_payload, true);
  billing_contact_id := null;
  if jsonb_array_length(recipients_input) > 0 then
    select n.contact_id into billing_contact_id
    from private.normalize_recipients_array(p_org_id, recipients_input) n
    where n.is_billing
    limit 1;
    v_contact_id := billing_contact_id;
  else
    v_contact_id := null;
  end if;

  v_owner_membership_id := nullif(p_payload ->> 'owner_membership_id', '')::uuid;
  v_currency := upper(coalesce(nullif(trim(p_payload ->> 'currency'), ''), org_currency))::char(3);
  v_frequency := lower(nullif(trim(p_payload ->> 'frequency'), ''));
  if v_frequency is null or v_frequency not in ('daily', 'weekly', 'monthly', 'yearly') then
    raise exception 'Schedule frequency must be daily, weekly, monthly, or yearly' using errcode = '22023';
  end if;
  v_interval_count := coalesce((p_payload ->> 'interval_count')::smallint, 1);
  v_start_on := coalesce((p_payload ->> 'start_on')::date, (timezone('utc', now()))::date);
  v_anchor_on := coalesce((p_payload ->> 'anchor_on')::date, v_start_on);
  v_end_on := nullif(p_payload ->> 'end_on', '')::date;
  v_max_occurrences := nullif(p_payload ->> 'max_occurrences', '')::integer;
  v_timezone := coalesce(nullif(trim(p_payload ->> 'timezone'), ''), org_tz, 'UTC');
  v_local_run_time := coalesce((p_payload ->> 'local_run_time')::time, time '09:00:00');
  v_due_days := coalesce((p_payload ->> 'due_days')::smallint, 14);
  v_month_end_policy := coalesce(nullif(trim(p_payload ->> 'month_end_policy'), ''), 'clamp');
  v_delivery_mode := coalesce(nullif(trim(p_payload ->> 'delivery_mode'), ''), 'draft');
  v_pricing_mode := coalesce(nullif(trim(p_payload ->> 'pricing_mode'), ''), 'fixed');
  v_catch_up_policy := coalesce(nullif(trim(p_payload ->> 'catch_up_policy'), ''), 'latest');
  v_max_catch_up_runs := coalesce((p_payload ->> 'max_catch_up_runs')::smallint, 1);
  v_purchase_order_number := nullif(trim(coalesce(p_payload ->> 'purchase_order_number', '')), '');
  v_payment_terms := nullif(trim(coalesce(p_payload ->> 'payment_terms', '')), '');
  v_notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_internal_notes := nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '');

  if v_frequency = 'weekly' then
    wd := p_payload -> 'weekdays';
    if wd is null or jsonb_typeof(wd) <> 'array' or jsonb_array_length(wd) < 1 then
      raise exception 'Weekly schedules require weekdays' using errcode = '22023';
    end if;
    v_weekdays := array[]::smallint[];
    for elem in select jsonb_array_elements_text(wd) loop
      v_weekdays := array_append(v_weekdays, elem::smallint);
    end loop;
  elsif v_frequency = 'monthly' then
    v_day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      extract(day from v_anchor_on)::smallint
    );
  elsif v_frequency = 'yearly' then
    v_day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      extract(day from v_anchor_on)::smallint
    );
    v_month_of_year := coalesce(
      (p_payload ->> 'month_of_year')::smallint,
      extract(month from v_anchor_on)::smallint
    );
  end if;

  insert into public.recurring_invoice_schedules (
    org_id, name, client_id, contact_id, owner_membership_id, status, currency,
    frequency, interval_count, anchor_on, weekdays, day_of_month, month_of_year,
    month_end_policy, timezone, local_run_time, start_on, end_on, max_occurrences,
    due_days, delivery_mode, pricing_mode, catch_up_policy, max_catch_up_runs,
    purchase_order_number, payment_terms, notes, internal_notes,
    created_by, updated_by
  ) values (
    p_org_id, v_name, v_client_id, v_contact_id, v_owner_membership_id, 'draft', v_currency,
    v_frequency, v_interval_count, v_anchor_on, v_weekdays, v_day_of_month, v_month_of_year,
    v_month_end_policy, v_timezone, v_local_run_time, v_start_on, v_end_on, v_max_occurrences,
    v_due_days, v_delivery_mode, v_pricing_mode, v_catch_up_policy, v_max_catch_up_runs,
    v_purchase_order_number, v_payment_terms, v_notes, v_internal_notes,
    actor_id, actor_id
  )
  returning * into schedule_row;

  perform private.replace_recurring_schedule_lines(
    p_org_id, schedule_row.id, actor_id, coalesce(p_lines, '[]'::jsonb), v_currency
  );

  perform private.replace_schedule_recipients(
    p_org_id, schedule_row.id, actor_id, recipients_input
  );

  return private.recurring_schedule_document(schedule_row.id, p_org_id);
end;
$$;

create or replace function public.save_recurring_schedule_draft(
  p_schedule_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  schedule_row public.recurring_invoice_schedules;
  wd jsonb;
  recipients_input jsonb;
  billing_contact_id uuid;
  elem text;
  v_weekdays smallint[];
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Schedule payload must be an object' using errcode = '22023';
  end if;

  select * into schedule_row
  from public.recurring_invoice_schedules
  where id = p_schedule_id and org_id = p_org_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Recurring schedule not found' using errcode = 'P0002';
  end if;
  if schedule_row.version is distinct from p_expected_version then
    raise exception 'Recurring schedule version conflict' using errcode = 'P0001';
  end if;
  if schedule_row.status <> 'draft' then
    raise exception 'Only draft recurring schedules can be edited'
      using errcode = '22023';
  end if;

  if p_payload ? 'name' then
    schedule_row.name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
    if schedule_row.name is null then
      raise exception 'Schedule name must be between 1 and 200 characters' using errcode = '22023';
    end if;
  end if;
  if p_payload ? 'client_id' then
    schedule_row.client_id := nullif(p_payload ->> 'client_id', '')::uuid;
    if schedule_row.client_id is null or not exists (
      select 1 from public.clients
      where clients.id = schedule_row.client_id and clients.org_id = p_org_id and clients.deleted_at is null
    ) then
      raise exception 'Schedule client not found in organisation' using errcode = '22023';
    end if;
  end if;
  recipients_input := private.resolve_recipients_input(p_payload, false);
  if recipients_input is not null then
    billing_contact_id := null;
    if jsonb_array_length(recipients_input) > 0 then
      select n.contact_id into billing_contact_id
      from private.normalize_recipients_array(p_org_id, recipients_input) n
      where n.is_billing
      limit 1;
    end if;
    schedule_row.contact_id := billing_contact_id;
  end if;
  if p_payload ? 'owner_membership_id' then
    schedule_row.owner_membership_id := nullif(p_payload ->> 'owner_membership_id', '')::uuid;
  end if;
  if p_payload ? 'currency' then
    schedule_row.currency := upper(trim(p_payload ->> 'currency'))::char(3);
  end if;
  if p_payload ? 'frequency' then
    schedule_row.frequency := lower(trim(p_payload ->> 'frequency'));
  end if;
  if p_payload ? 'interval_count' then
    schedule_row.interval_count := (p_payload ->> 'interval_count')::smallint;
  end if;
  if p_payload ? 'start_on' then
    schedule_row.start_on := (p_payload ->> 'start_on')::date;
  end if;
  if p_payload ? 'anchor_on' then
    schedule_row.anchor_on := (p_payload ->> 'anchor_on')::date;
  end if;
  if p_payload ? 'end_on' then
    schedule_row.end_on := nullif(p_payload ->> 'end_on', '')::date;
  end if;
  if p_payload ? 'max_occurrences' then
    schedule_row.max_occurrences := nullif(p_payload ->> 'max_occurrences', '')::integer;
  end if;
  if p_payload ? 'timezone' then
    schedule_row.timezone := coalesce(nullif(trim(p_payload ->> 'timezone'), ''), schedule_row.timezone);
  end if;
  if p_payload ? 'local_run_time' then
    schedule_row.local_run_time := coalesce((p_payload ->> 'local_run_time')::time, schedule_row.local_run_time);
  end if;
  if p_payload ? 'due_days' then
    schedule_row.due_days := (p_payload ->> 'due_days')::smallint;
  end if;
  if p_payload ? 'month_end_policy' then
    schedule_row.month_end_policy := trim(p_payload ->> 'month_end_policy');
  end if;
  if p_payload ? 'delivery_mode' then
    schedule_row.delivery_mode := trim(p_payload ->> 'delivery_mode');
  end if;
  if p_payload ? 'pricing_mode' then
    schedule_row.pricing_mode := trim(p_payload ->> 'pricing_mode');
  end if;
  if p_payload ? 'catch_up_policy' then
    schedule_row.catch_up_policy := trim(p_payload ->> 'catch_up_policy');
  end if;
  if p_payload ? 'max_catch_up_runs' then
    schedule_row.max_catch_up_runs := (p_payload ->> 'max_catch_up_runs')::smallint;
  end if;
  if p_payload ? 'purchase_order_number' then
    schedule_row.purchase_order_number := nullif(trim(coalesce(p_payload ->> 'purchase_order_number', '')), '');
  end if;
  if p_payload ? 'payment_terms' then
    schedule_row.payment_terms := nullif(trim(coalesce(p_payload ->> 'payment_terms', '')), '');
  end if;
  if p_payload ? 'notes' then
    schedule_row.notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  end if;
  if p_payload ? 'internal_notes' then
    schedule_row.internal_notes := nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '');
  end if;

  -- Normalize frequency-specific fields after possible frequency change
  if schedule_row.frequency = 'daily' then
    schedule_row.weekdays := null;
    schedule_row.day_of_month := null;
    schedule_row.month_of_year := null;
  elsif schedule_row.frequency = 'weekly' then
    schedule_row.day_of_month := null;
    schedule_row.month_of_year := null;
    if p_payload ? 'weekdays' or p_payload ? 'frequency' then
      wd := coalesce(p_payload -> 'weekdays', to_jsonb(schedule_row.weekdays));
      if wd is null or jsonb_typeof(wd) <> 'array' or jsonb_array_length(wd) < 1 then
        raise exception 'Weekly schedules require weekdays' using errcode = '22023';
      end if;
      v_weekdays := array[]::smallint[];
      for elem in select jsonb_array_elements_text(wd) loop
        v_weekdays := array_append(v_weekdays, elem::smallint);
      end loop;
      schedule_row.weekdays := v_weekdays;
    end if;
  elsif schedule_row.frequency = 'monthly' then
    schedule_row.weekdays := null;
    schedule_row.month_of_year := null;
    schedule_row.day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      schedule_row.day_of_month,
      extract(day from schedule_row.anchor_on)::smallint
    );
  elsif schedule_row.frequency = 'yearly' then
    schedule_row.weekdays := null;
    schedule_row.day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      schedule_row.day_of_month,
      extract(day from schedule_row.anchor_on)::smallint
    );
    schedule_row.month_of_year := coalesce(
      (p_payload ->> 'month_of_year')::smallint,
      schedule_row.month_of_year,
      extract(month from schedule_row.anchor_on)::smallint
    );
  end if;

  update public.recurring_invoice_schedules
  set
    name = schedule_row.name,
    client_id = schedule_row.client_id,
    contact_id = schedule_row.contact_id,
    owner_membership_id = schedule_row.owner_membership_id,
    currency = schedule_row.currency,
    frequency = schedule_row.frequency,
    interval_count = schedule_row.interval_count,
    anchor_on = schedule_row.anchor_on,
    weekdays = schedule_row.weekdays,
    day_of_month = schedule_row.day_of_month,
    month_of_year = schedule_row.month_of_year,
    month_end_policy = schedule_row.month_end_policy,
    timezone = schedule_row.timezone,
    local_run_time = schedule_row.local_run_time,
    start_on = schedule_row.start_on,
    end_on = schedule_row.end_on,
    max_occurrences = schedule_row.max_occurrences,
    due_days = schedule_row.due_days,
    delivery_mode = schedule_row.delivery_mode,
    pricing_mode = schedule_row.pricing_mode,
    catch_up_policy = schedule_row.catch_up_policy,
    max_catch_up_runs = schedule_row.max_catch_up_runs,
    purchase_order_number = schedule_row.purchase_order_number,
    payment_terms = schedule_row.payment_terms,
    notes = schedule_row.notes,
    internal_notes = schedule_row.internal_notes,
    rule_version = schedule_row.rule_version + 1,
    updated_by = actor_id
  where id = schedule_row.id;

  if p_lines is not null then
    perform private.replace_recurring_schedule_lines(
      p_org_id, schedule_row.id, actor_id, p_lines, schedule_row.currency
    );
  end if;

  if recipients_input is not null then
    perform private.replace_schedule_recipients(
      p_org_id, schedule_row.id, actor_id, recipients_input
    );
  end if;

  return private.recurring_schedule_document(schedule_row.id, p_org_id);
end;
$$;

