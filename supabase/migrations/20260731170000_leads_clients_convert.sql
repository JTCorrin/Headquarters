-- Pipeline slice: leads, clients, client_contacts, thin timeline_events, convert_lead RPC.

set search_path = public, extensions, pg_catalog;

-- Composite FKs from pipeline tables need a stable (org_id, id) key on contacts.
alter table public.contacts
  add constraint contacts_org_id_id_key unique (org_id, id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 200),
  company_name text,
  contact_id uuid,
  client_id uuid,
  stage text not null default 'new',
  value_cents bigint check (value_cents is null or value_cents >= 0),
  currency char(3) not null default 'GBP',
  probability_percent numeric(5, 2)
    check (
      probability_percent is null
      or (probability_percent >= 0 and probability_percent <= 100)
    ),
  source text,
  owner_membership_id uuid,
  expected_close_on date,
  lost_reason text,
  won_at timestamptz,
  lost_at timestamptz,
  converted_at timestamptz,
  position numeric(20, 10) not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  constraint leads_org_id_id_key unique (org_id, id),
  constraint leads_contact_fk
    foreign key (org_id, contact_id)
    references public.contacts (org_id, id)
    on delete set null (contact_id),
  constraint leads_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete set null (owner_membership_id),
  constraint leads_stage_check
    check (stage in ('new', 'qualified', 'proposal', 'won', 'lost')),
  constraint leads_currency_format_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint leads_lost_reason_check
    check (
      (stage = 'lost' and nullif(trim(lost_reason), '') is not null)
      or (stage <> 'lost')
    ),
  -- Converted leads are terminal: open/lost stages cannot retain conversion fields,
  -- and won requires a linked client plus conversion timestamps.
  constraint leads_conversion_invariant_check
    check (
      (
        stage <> 'won'
        and client_id is null
        and won_at is null
        and converted_at is null
      )
      or (
        stage = 'won'
        and client_id is not null
        and won_at is not null
        and converted_at is not null
      )
    ),
  constraint leads_lost_timestamps_check
    check (
      (stage = 'lost' and lost_at is not null)
      or (stage <> 'lost' and lost_at is null)
    ),
  constraint leads_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'active',
  website_url text,
  industry text,
  primary_email citext,
  phone text,
  tax_identifier text,
  registration_number text,
  default_currency char(3),
  payment_terms_days smallint check (
    payment_terms_days is null
    or (payment_terms_days >= 0 and payment_terms_days <= 3650)
  ),
  owner_membership_id uuid,
  converted_from_lead_id uuid,
  renewal_on date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  constraint clients_org_id_id_key unique (org_id, id),
  constraint clients_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete set null (owner_membership_id),
  constraint clients_status_check
    check (status in ('prospect', 'active', 'on_hold', 'inactive', 'archived')),
  constraint clients_currency_format_check
    check (default_currency is null or default_currency ~ '^[A-Z]{3}$'),
  constraint clients_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.leads
  add constraint leads_client_fk
  foreign key (org_id, client_id)
  references public.clients (org_id, id)
  on delete set null (client_id)
  deferrable initially deferred;

alter table public.clients
  add constraint clients_converted_from_lead_fk
  foreign key (org_id, converted_from_lead_id)
  references public.leads (org_id, id)
  on delete set null (converted_from_lead_id)
  deferrable initially deferred;

create unique index clients_converted_from_lead_uidx
  on public.clients (org_id, converted_from_lead_id)
  where converted_from_lead_id is not null and deleted_at is null;

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  client_id uuid not null,
  contact_id uuid not null,
  role text not null default 'other',
  is_primary boolean not null default false,
  constraint client_contacts_org_id_id_key unique (org_id, id),
  constraint client_contacts_client_fk
    foreign key (org_id, client_id)
    references public.clients (org_id, id)
    on delete cascade,
  constraint client_contacts_contact_fk
    foreign key (org_id, contact_id)
    references public.contacts (org_id, id)
    on delete cascade,
  constraint client_contacts_role_check
    check (role in ('primary', 'billing', 'decision_maker', 'other'))
);

create unique index client_contacts_client_contact_uidx
  on public.client_contacts (client_id, contact_id)
  where deleted_at is null;

create unique index client_contacts_one_primary_uidx
  on public.client_contacts (client_id)
  where is_primary and deleted_at is null;

-- Thin append-only feed so domain commands (convert) can emit activity cards.
create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  kind text not null,
  title text not null check (char_length(title) between 1 and 200),
  body text,
  actor_type text not null,
  actor_id uuid,
  source_type text,
  source_id uuid,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint timeline_events_entity_type_check
    check (entity_type in ('contact', 'lead', 'client')),
  constraint timeline_events_kind_check
    check (
      kind in (
        'note',
        'email',
        'call',
        'payment',
        'document',
        'status',
        'meeting',
        'task',
        'conversion'
      )
    ),
  constraint timeline_events_actor_type_check
    check (actor_type in ('user', 'agent', 'system', 'integration')),
  constraint timeline_events_payload_object_check
    check (jsonb_typeof(payload) = 'object')
);

create index leads_org_created_idx
  on public.leads (org_id, created_at desc, id desc)
  where deleted_at is null;

create index leads_org_stage_position_idx
  on public.leads (org_id, stage, position, id)
  where deleted_at is null;

create index leads_org_owner_idx
  on public.leads (org_id, owner_membership_id)
  where deleted_at is null and owner_membership_id is not null;

create index clients_org_created_idx
  on public.clients (org_id, created_at desc, id desc)
  where deleted_at is null;

create index clients_org_status_idx
  on public.clients (org_id, status)
  where deleted_at is null;

create index clients_org_owner_idx
  on public.clients (org_id, owner_membership_id)
  where deleted_at is null and owner_membership_id is not null;

create index client_contacts_org_client_idx
  on public.client_contacts (org_id, client_id)
  where deleted_at is null;

create index timeline_events_entity_idx
  on public.timeline_events (org_id, entity_type, entity_id, occurred_at desc, id desc);

create trigger leads_stamp_business_row
before insert or update on public.leads
for each row execute function private.stamp_business_row();

create trigger clients_stamp_business_row
before insert or update on public.clients
for each row execute function private.stamp_business_row();

create trigger client_contacts_stamp_business_row
before insert or update on public.client_contacts
for each row execute function private.stamp_business_row();

create or replace function private.validate_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_membership_id is null
    or (
      tg_op = 'UPDATE'
      and new.owner_membership_id is not distinct from old.owner_membership_id
    )
  then
    return new;
  end if;

  perform memberships.id
    from public.memberships
    where memberships.id = new.owner_membership_id
      and memberships.org_id = new.org_id
      and memberships.status = 'active'
    for no key update;

  if not found then
    raise exception 'Owner must be an active membership in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger leads_validate_owner
before insert or update of owner_membership_id on public.leads
for each row execute function private.validate_owner_membership();

create trigger clients_validate_owner
before insert or update of owner_membership_id on public.clients
for each row execute function private.validate_owner_membership();

create or replace function private.validate_lead_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_id is null
    or (
      tg_op = 'UPDATE'
      and new.contact_id is not distinct from old.contact_id
    )
  then
    return new;
  end if;

  perform contacts.id
    from public.contacts
    where contacts.id = new.contact_id
      and contacts.org_id = new.org_id
      and contacts.deleted_at is null;

  if not found then
    raise exception 'Lead contact must be an active contact in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger leads_validate_contact
before insert or update of contact_id on public.leads
for each row execute function private.validate_lead_contact();

create or replace function private.protect_converted_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.stage = 'won'
    and (
      new.stage is distinct from old.stage
      or new.client_id is distinct from old.client_id
      or new.won_at is distinct from old.won_at
      or new.converted_at is distinct from old.converted_at
    )
  then
    raise exception 'Converted leads cannot change stage or conversion fields'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger leads_protect_converted
before update on public.leads
for each row execute function private.protect_converted_lead();

create or replace function private.prevent_soft_delete_converted_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null
    and new.deleted_at is not null
    and exists (
      select 1
      from public.leads
      where leads.org_id = old.org_id
        and leads.client_id = old.id
        and leads.deleted_at is null
        and leads.stage = 'won'
    )
  then
    raise exception 'Cannot soft-delete a client linked from an active converted lead'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger clients_prevent_soft_delete_converted
before update of deleted_at on public.clients
for each row execute function private.prevent_soft_delete_converted_client();

create or replace function private.prevent_suspending_assigned_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active'
    and new.status = 'suspended'
    and (
      exists (
        select 1
        from public.contacts
        where contacts.org_id = old.org_id
          and contacts.owner_membership_id = old.id
          and contacts.deleted_at is null
      )
      or exists (
        select 1
        from public.leads
        where leads.org_id = old.org_id
          and leads.owner_membership_id = old.id
          and leads.deleted_at is null
      )
      or exists (
        select 1
        from public.clients
        where clients.org_id = old.org_id
          and clients.owner_membership_id = old.id
          and clients.deleted_at is null
      )
    )
  then
    raise exception 'Reassign active contacts, leads, and clients before suspending this member'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.convert_lead(
  p_lead_id uuid,
  p_client_name text default null,
  p_client_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  lead_row public.leads;
  client_row public.clients;
  contact_row public.contacts;
  client_name text;
  client_status text := coalesce(nullif(trim(p_client_status), ''), 'active');
  contact_email text;
  contact_phone text;
  now_ts timestamptz := now();
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if client_status not in ('prospect', 'active', 'on_hold', 'inactive', 'archived') then
    raise exception 'Client status is invalid'
      using errcode = '22023';
  end if;

  select * into lead_row
  from public.leads
  where leads.id = p_lead_id
    and leads.deleted_at is null
  for update;

  if not found then
    raise exception 'Lead not found'
      using errcode = 'P0002';
  end if;

  if not private.has_org_role(
    lead_row.org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if lead_row.stage = 'won' or lead_row.client_id is not null then
    if lead_row.stage <> 'won'
      or lead_row.client_id is null
      or lead_row.won_at is null
      or lead_row.converted_at is null
    then
      raise exception 'Converted lead is in an inconsistent state'
        using errcode = '23514';
    end if;

    select * into client_row
    from public.clients
    where clients.id = lead_row.client_id
      and clients.org_id = lead_row.org_id
    for update;

    if not found then
      raise exception 'Converted lead is missing its client'
        using errcode = 'P0002';
    end if;

    -- Defence in depth if a converted client was soft-deleted outside the guard.
    if client_row.deleted_at is not null then
      update public.clients
      set
        deleted_at = null,
        updated_by = actor_id
      where clients.id = client_row.id
      returning * into client_row;
    end if;

    return jsonb_build_object(
      'lead', to_jsonb(lead_row),
      'client', to_jsonb(client_row),
      'idempotent', true
    );
  end if;

  if lead_row.stage = 'lost' then
    raise exception 'Lost leads cannot be converted'
      using errcode = '22023';
  end if;

  contact_email := null;
  contact_phone := null;
  if lead_row.contact_id is not null then
    select * into contact_row
    from public.contacts
    where contacts.id = lead_row.contact_id
      and contacts.org_id = lead_row.org_id
    for update;

    if not found or contact_row.deleted_at is not null then
      raise exception 'Lead contact must be an active contact in the same organisation'
        using errcode = '22023';
    end if;

    contact_email := contact_row.primary_email;
    contact_phone := contact_row.primary_phone;
  end if;

  client_name := coalesce(
    nullif(trim(p_client_name), ''),
    nullif(trim(lead_row.company_name), ''),
    lead_row.name
  );

  insert into public.clients (
    org_id,
    name,
    status,
    primary_email,
    phone,
    default_currency,
    owner_membership_id,
    converted_from_lead_id,
    notes,
    metadata,
    created_by,
    updated_by
  )
  values (
    lead_row.org_id,
    client_name,
    client_status,
    contact_email,
    contact_phone,
    lead_row.currency,
    lead_row.owner_membership_id,
    lead_row.id,
    lead_row.notes,
    coalesce(lead_row.metadata, '{}'::jsonb),
    actor_id,
    actor_id
  )
  returning * into client_row;

  if lead_row.contact_id is not null then
    insert into public.client_contacts (
      org_id,
      client_id,
      contact_id,
      role,
      is_primary,
      created_by,
      updated_by
    )
    values (
      lead_row.org_id,
      client_row.id,
      lead_row.contact_id,
      'primary',
      true,
      actor_id,
      actor_id
    );
  end if;

  update public.leads
  set
    stage = 'won',
    client_id = client_row.id,
    won_at = now_ts,
    converted_at = now_ts,
    lost_at = null,
    lost_reason = null,
    updated_by = actor_id
  where leads.id = lead_row.id
  returning * into lead_row;

  insert into public.timeline_events (
    org_id,
    entity_type,
    entity_id,
    kind,
    title,
    body,
    actor_type,
    actor_id,
    source_type,
    source_id,
    payload,
    occurred_at
  )
  values
    (
      lead_row.org_id,
      'lead',
      lead_row.id,
      'conversion',
      'Lead converted to client',
      format('Created client "%s"', client_row.name),
      'user',
      actor_id,
      'client',
      client_row.id,
      jsonb_build_object('client_id', client_row.id, 'lead_id', lead_row.id),
      now_ts
    ),
    (
      lead_row.org_id,
      'client',
      client_row.id,
      'conversion',
      'Client created from lead',
      format('Converted from lead "%s"', lead_row.name),
      'user',
      actor_id,
      'lead',
      lead_row.id,
      jsonb_build_object('client_id', client_row.id, 'lead_id', lead_row.id),
      now_ts
    );

  return jsonb_build_object(
    'lead', to_jsonb(lead_row),
    'client', to_jsonb(client_row),
    'idempotent', false
  );
end;
$$;

revoke all on function private.validate_owner_membership() from public, anon, authenticated;
revoke all on function private.validate_lead_contact() from public, anon, authenticated;
revoke all on function private.protect_converted_lead() from public, anon, authenticated;
revoke all on function private.prevent_soft_delete_converted_client()
  from public, anon, authenticated;
revoke all on function public.convert_lead(uuid, text, text) from public, anon;

grant execute on function public.convert_lead(uuid, text, text) to authenticated;

alter table public.leads enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.timeline_events enable row level security;

create policy leads_select_member
on public.leads
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy leads_insert_member
on public.leads
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

create policy leads_update_member
on public.leads
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

create policy clients_select_member
on public.clients
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

create policy clients_insert_member
on public.clients
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

create policy clients_update_member
on public.clients
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

create policy client_contacts_select_member
on public.client_contacts
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy client_contacts_insert_member
on public.client_contacts
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

create policy client_contacts_update_member
on public.client_contacts
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

-- Billing may read client activity but must not observe lead conversion payloads.
create policy timeline_events_select_member
on public.timeline_events
for select
to authenticated
using (
  case
    when entity_type = 'lead' then
      private.has_org_role(
        org_id,
        array['owner', 'admin', 'member', 'readonly']
      )
    else
      private.has_org_role(
        org_id,
        array['owner', 'admin', 'member', 'billing', 'readonly']
      )
  end
);

revoke all on table public.leads from anon, authenticated;
revoke all on table public.clients from anon, authenticated;
revoke all on table public.client_contacts from anon, authenticated;
revoke all on table public.timeline_events from anon, authenticated;

grant select on table public.leads to authenticated;
grant insert (
  org_id,
  name,
  company_name,
  contact_id,
  stage,
  value_cents,
  currency,
  probability_percent,
  source,
  owner_membership_id,
  expected_close_on,
  lost_reason,
  position,
  notes,
  metadata
) on table public.leads to authenticated;
grant update (
  name,
  company_name,
  contact_id,
  stage,
  value_cents,
  currency,
  probability_percent,
  source,
  owner_membership_id,
  expected_close_on,
  lost_reason,
  lost_at,
  position,
  notes,
  metadata,
  deleted_at
) on table public.leads to authenticated;

grant select on table public.clients to authenticated;
grant insert (
  org_id,
  name,
  status,
  website_url,
  industry,
  primary_email,
  phone,
  tax_identifier,
  registration_number,
  default_currency,
  payment_terms_days,
  owner_membership_id,
  renewal_on,
  notes,
  metadata
) on table public.clients to authenticated;
grant update (
  name,
  status,
  website_url,
  industry,
  primary_email,
  phone,
  tax_identifier,
  registration_number,
  default_currency,
  payment_terms_days,
  owner_membership_id,
  renewal_on,
  notes,
  metadata,
  deleted_at
) on table public.clients to authenticated;

grant select on table public.client_contacts to authenticated;
grant insert (
  org_id,
  client_id,
  contact_id,
  role,
  is_primary
) on table public.client_contacts to authenticated;
grant update (
  role,
  is_primary,
  deleted_at
) on table public.client_contacts to authenticated;

grant select on table public.timeline_events to authenticated;
