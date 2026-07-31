-- Product catalog + append-only stock ledger with transactional adjustments.

set search_path = public, extensions, pg_catalog;

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 120),
  description text,
  position integer not null default 0,
  constraint product_categories_org_id_id_key unique (org_id, id)
);

create unique index product_categories_org_name_uidx
  on public.product_categories (org_id, lower(name))
  where deleted_at is null;

create index product_categories_org_position_idx
  on public.product_categories (org_id, position, id)
  where deleted_at is null;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  sku citext not null,
  name text not null check (char_length(name) between 1 and 160),
  description text,
  category_id uuid,
  product_type text not null,
  unit_name text,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  cost_price_cents bigint check (cost_price_cents is null or cost_price_cents >= 0),
  currency char(3) not null default 'GBP',
  tax_rate_id uuid,
  track_stock boolean not null default false,
  stock_qty numeric(14, 4),
  low_stock_at numeric(14, 4),
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  constraint products_org_id_id_key unique (org_id, id),
  constraint products_category_fk
    foreign key (org_id, category_id)
    references public.product_categories (org_id, id)
    on delete set null (category_id),
  constraint products_type_check
    check (product_type in ('product', 'service')),
  constraint products_status_check
    check (status in ('active', 'archived')),
  constraint products_currency_format_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint products_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint products_sku_length_check
    check (char_length(sku::text) between 1 and 64),
  constraint products_stock_tracking_check
    check (
      (
        track_stock = false
        and stock_qty is null
        and low_stock_at is null
      )
      or (
        track_stock = true
        and product_type = 'product'
        and stock_qty is not null
      )
    ),
  constraint products_service_no_stock_check
    check (product_type <> 'service' or track_stock = false),
  constraint products_low_stock_nonneg_check
    check (low_stock_at is null or low_stock_at >= 0)
);

create unique index products_org_sku_uidx
  on public.products (org_id, sku)
  where deleted_at is null;

create index products_org_created_idx
  on public.products (org_id, created_at desc, id desc)
  where deleted_at is null;

create index products_org_status_idx
  on public.products (org_id, status)
  where deleted_at is null;

create index products_org_category_idx
  on public.products (org_id, category_id)
  where deleted_at is null and category_id is not null;

-- Append-only ledger: no soft delete, no client rewrites.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  product_id uuid not null,
  quantity_delta numeric(14, 4) not null check (quantity_delta <> 0),
  reason text not null,
  reference_type text,
  reference_id uuid,
  occurred_at timestamptz not null default now(),
  note text,
  constraint inventory_movements_product_fk
    foreign key (org_id, product_id)
    references public.products (org_id, id)
    on delete cascade,
  constraint inventory_movements_reason_check
    check (reason in ('opening', 'adjustment', 'invoice', 'return', 'void')),
  constraint inventory_movements_org_id_id_key unique (org_id, id)
);

create index inventory_movements_product_occurred_idx
  on public.inventory_movements (org_id, product_id, occurred_at desc, id desc);

create trigger product_categories_stamp_business_row
before insert or update on public.product_categories
for each row execute function private.stamp_business_row();

create trigger products_stamp_business_row
before insert or update on public.products
for each row execute function private.stamp_business_row();

create or replace function private.validate_product_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category_id is null
    or (
      tg_op = 'UPDATE'
      and new.category_id is not distinct from old.category_id
    )
  then
    return new;
  end if;

  perform product_categories.id
  from public.product_categories
  where product_categories.id = new.category_id
    and product_categories.org_id = new.org_id
    and product_categories.deleted_at is null;

  if not found then
    raise exception 'Product category must be an active category in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger products_validate_category
before insert or update of category_id on public.products
for each row execute function private.validate_product_category();

create or replace function private.normalize_product_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  has_ledger boolean;
begin
  if tg_op = 'INSERT' then
    if new.track_stock then
      new.stock_qty := 0;
    else
      new.stock_qty := null;
      new.low_stock_at := null;
    end if;
    return new;
  end if;

  if new.track_stock is distinct from old.track_stock then
    if old.product_type = 'service' or new.product_type = 'service' then
      if new.track_stock then
        raise exception 'Services cannot track stock'
          using errcode = '23514';
      end if;
    end if;

    select exists (
      select 1
      from public.inventory_movements
      where inventory_movements.product_id = old.id
    ) into has_ledger;

    if has_ledger or coalesce(old.stock_qty, 0) <> 0 then
      raise exception 'Cannot change stock tracking after stock movements or non-zero stock'
        using errcode = '23514';
    end if;

    if new.track_stock then
      new.stock_qty := 0;
    else
      new.stock_qty := null;
      new.low_stock_at := null;
    end if;
    return new;
  end if;

  if new.stock_qty is distinct from old.stock_qty
    and current_setting('app.allow_stock_mutation', true) is distinct from 'on'
  then
    raise exception 'Stock quantity can only change through adjust_product_stock'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger products_normalize_stock
before insert or update of track_stock, stock_qty, product_type on public.products
for each row execute function private.normalize_product_stock();

create or replace function private.protect_product_category_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    if exists (
      select 1
      from public.products
      where products.category_id = old.id
        and products.deleted_at is null
    ) then
      raise exception 'Cannot soft-delete a category while active products reference it'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger product_categories_protect_delete
before update of deleted_at on public.product_categories
for each row execute function private.protect_product_category_delete();

create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_quantity_delta numeric,
  p_reason text default 'adjustment',
  p_note text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  product_row public.products;
  movement_row public.inventory_movements;
  next_qty numeric(14, 4);
  occurred timestamptz := coalesce(p_occurred_at, now());
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_quantity_delta is null
    or lower(p_quantity_delta::text) in ('nan', 'infinity', '-infinity')
    or p_quantity_delta = 0
  then
    raise exception 'Quantity delta must be a finite non-zero number'
      using errcode = '22023';
  end if;

  if round(p_quantity_delta, 4) <> p_quantity_delta then
    raise exception 'Quantity delta supports at most 4 decimal places'
      using errcode = '22023';
  end if;

  if abs(p_quantity_delta) >= 10000000000 then
    raise exception 'Quantity delta exceeds numeric(14,4) bounds'
      using errcode = '22023';
  end if;

  if p_reason is null
    or p_reason not in ('opening', 'adjustment', 'invoice', 'return', 'void')
  then
    raise exception 'Stock adjustment reason is invalid'
      using errcode = '22023';
  end if;

  select * into product_row
  from public.products
  where products.id = p_product_id
    and products.deleted_at is null
  for update;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  if not private.has_org_role(
    product_row.org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if not product_row.track_stock or product_row.product_type <> 'product' then
    raise exception 'Stock can only be adjusted for tracked products'
      using errcode = '22023';
  end if;

  next_qty := coalesce(product_row.stock_qty, 0) + p_quantity_delta;

  perform set_config('app.allow_stock_mutation', 'on', true);

  insert into public.inventory_movements (
    org_id,
    created_by,
    product_id,
    quantity_delta,
    reason,
    occurred_at,
    note
  )
  values (
    product_row.org_id,
    actor_id,
    product_row.id,
    p_quantity_delta,
    p_reason,
    occurred,
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning * into movement_row;

  update public.products
  set
    stock_qty = next_qty,
    updated_by = actor_id
  where products.id = product_row.id
  returning * into product_row;

  perform set_config('app.allow_stock_mutation', 'off', true);

  return jsonb_build_object(
    'product', to_jsonb(product_row),
    'movement', to_jsonb(movement_row)
  );
end;
$$;

revoke all on function private.validate_product_category() from public, anon, authenticated;
revoke all on function private.normalize_product_stock() from public, anon, authenticated;
revoke all on function private.protect_product_category_delete() from public, anon, authenticated;
revoke all on function public.adjust_product_stock(uuid, numeric, text, text, timestamptz)
  from public, anon;

grant execute on function public.adjust_product_stock(uuid, numeric, text, text, timestamptz)
  to authenticated;

alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory_movements enable row level security;

create policy product_categories_select_member
on public.product_categories
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

create policy product_categories_insert_member
on public.product_categories
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy product_categories_update_member
on public.product_categories
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
)
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and updated_by = auth.uid()
);

create policy products_select_member
on public.products
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

create policy products_insert_member
on public.products
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy products_update_member
on public.products
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
)
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and updated_by = auth.uid()
);

create policy inventory_movements_select_member
on public.inventory_movements
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

revoke all on table public.product_categories from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.inventory_movements from anon, authenticated;

grant select on table public.product_categories to authenticated;
grant insert (
  org_id,
  name,
  description,
  position
) on table public.product_categories to authenticated;
grant update (
  name,
  description,
  position,
  deleted_at
) on table public.product_categories to authenticated;

grant select on table public.products to authenticated;
grant insert (
  org_id,
  sku,
  name,
  description,
  category_id,
  product_type,
  unit_name,
  unit_price_cents,
  cost_price_cents,
  currency,
  tax_rate_id,
  track_stock,
  low_stock_at,
  status,
  metadata
) on table public.products to authenticated;
grant update (
  sku,
  name,
  description,
  category_id,
  product_type,
  unit_name,
  unit_price_cents,
  cost_price_cents,
  currency,
  tax_rate_id,
  track_stock,
  low_stock_at,
  status,
  metadata,
  deleted_at
) on table public.products to authenticated;

-- Authenticated clients may read the ledger but never write it directly.
grant select on table public.inventory_movements to authenticated;

-- Short-lived dedupe records for side-effecting command POSTs (stock adjust, etc.).
create table public.api_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  actor_type text not null,
  actor_id uuid not null,
  idempotency_key_hash text not null,
  route text not null,
  request_hash text not null,
  response_status smallint,
  response_body jsonb,
  resource_type text,
  resource_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint api_idempotency_keys_actor_type_check
    check (actor_type in ('user', 'agent', 'api_key')),
  constraint api_idempotency_keys_route_length_check
    check (char_length(route) between 1 and 512),
  constraint api_idempotency_keys_hash_length_check
    check (
      char_length(idempotency_key_hash) = 64
      and char_length(request_hash) = 64
    ),
  constraint api_idempotency_keys_unique_actor_key
    unique (org_id, actor_type, actor_id, idempotency_key_hash)
);

create index api_idempotency_keys_expires_idx
  on public.api_idempotency_keys (expires_at);

alter table public.api_idempotency_keys enable row level security;

create policy api_idempotency_keys_select_own
on public.api_idempotency_keys
for select
to authenticated
using (
  actor_type = 'user'
  and actor_id = auth.uid()
  and expires_at > now()
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

create policy api_idempotency_keys_insert_member
on public.api_idempotency_keys
for insert
to authenticated
with check (
  actor_type = 'user'
  and actor_id = auth.uid()
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
);

create policy api_idempotency_keys_update_own
on public.api_idempotency_keys
for update
to authenticated
using (
  actor_type = 'user'
  and actor_id = auth.uid()
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
)
with check (
  actor_type = 'user'
  and actor_id = auth.uid()
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
);

revoke all on table public.api_idempotency_keys from anon, authenticated;
grant select, insert, update on table public.api_idempotency_keys to authenticated;
