-- S1: adjust_product_stock must not lock or oracle cross-tenant rows before authz.
-- Fetch org without FOR UPDATE, require membership, check role, then lock by (id, org_id).
-- Cross-tenant / non-member → not-found (P0002), same as missing product.

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
  product_org uuid;
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

  -- Peek org without locking (avoids cross-tenant row locks).
  select products.org_id
  into product_org
  from public.products
  where products.id = p_product_id
    and products.deleted_at is null;

  if product_org is null then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  -- Non-members get not-found (no existence oracle for other orgs).
  if not private.has_org_role(product_org, null) then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  -- Role check before row lock.
  if not private.has_org_role(
    product_org,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into product_row
  from public.products
  where products.id = p_product_id
    and products.org_id = product_org
    and products.deleted_at is null
  for update;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
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
    and products.org_id = product_row.org_id
  returning * into product_row;

  perform set_config('app.allow_stock_mutation', 'off', true);

  return jsonb_build_object(
    'product', to_jsonb(product_row),
    'movement', to_jsonb(movement_row)
  );
end;
$$;

-- Idempotent wrapper: keep org-scoped peek + role check before any FOR UPDATE
-- (idempotency key lock / nested adjust). Reassert role before claiming the key.
create or replace function public.adjust_product_stock_idempotent(
  p_product_id uuid,
  p_org_id uuid,
  p_quantity_delta numeric,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_reason text default 'adjustment',
  p_note text default null,
  p_occurred_at timestamptz default null,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_product_org uuid;
  v_product_deleted_at timestamptz;
  v_existing public.api_idempotency_keys;
  v_adjustment jsonb;
  v_response_body jsonb;
  v_response_headers jsonb;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(p_ttl_seconds, 60));
begin
  if v_actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_org_id is null
    or p_idempotency_key_hash is null
    or char_length(p_idempotency_key_hash) <> 64
    or p_request_hash is null
    or char_length(p_request_hash) <> 64
    or p_route is null
    or char_length(p_route) < 1
  then
    raise exception 'Idempotency claim parameters are invalid'
      using errcode = '22023';
  end if;

  -- Authz before locking the idempotency claim or nested stock adjust.
  -- Org is required from the API tenancy context.
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    -- Match adjust_product_stock: non-members / wrong-org → not-found when product
    -- is absent from this org; in-org wrong role → permission denied below.
    if not private.has_org_role(p_org_id, null) then
      raise exception 'Product not found'
        using errcode = 'P0002';
    end if;
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  -- Include soft-deleted products so completed claims can still replay.
  select products.org_id, products.deleted_at
  into v_product_org, v_product_deleted_at
  from public.products
  where products.id = p_product_id
    and products.org_id = p_org_id;

  if v_product_org is null then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  loop
    select * into v_existing
    from public.api_idempotency_keys
    where api_idempotency_keys.org_id = v_product_org
      and api_idempotency_keys.actor_type = 'user'
      and api_idempotency_keys.actor_id = v_actor_id
      and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash
    for update;

    if found then
      if v_existing.expires_at > now() then
        if v_existing.request_hash is distinct from p_request_hash
          or v_existing.route is distinct from p_route
        then
          raise exception 'Idempotency-Key was reused with a different request payload'
            using errcode = '23505';
        end if;

        if v_existing.response_status is not null and v_existing.response_body is not null then
          return jsonb_build_object(
            'replay', true,
            'response_status', v_existing.response_status,
            'response_body', v_existing.response_body -> 'body',
            'response_headers', coalesce(v_existing.response_body -> 'headers', '{}'::jsonb)
          );
        end if;

        raise exception 'An identical request is already in progress'
          using errcode = '55000';
      end if;

      -- Expired key: reclaim the unique slot.
      delete from public.api_idempotency_keys
      where api_idempotency_keys.id = v_existing.id;
    end if;

    -- New claims (and expired reclaim) require an active product.
    if v_product_deleted_at is not null then
      raise exception 'Product not found'
        using errcode = 'P0002';
    end if;

    begin
      insert into public.api_idempotency_keys (
        org_id,
        actor_type,
        actor_id,
        idempotency_key_hash,
        route,
        request_hash,
        expires_at
      ) values (
        v_product_org,
        'user',
        v_actor_id,
        p_idempotency_key_hash,
        p_route,
        p_request_hash,
        v_expires_at
      );
      exit; -- claimed
    exception
      when unique_violation then
        -- Concurrent claim won; loop and lock the winner's row.
        null;
    end;
  end loop;

  v_adjustment := public.adjust_product_stock(
    p_product_id,
    p_quantity_delta,
    p_reason,
    p_note,
    p_occurred_at
  );

  v_response_headers := jsonb_build_object(
    'etag', '"' || (v_adjustment -> 'product' ->> 'version') || '"'
  );
  v_response_body := jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object('data', v_adjustment),
    'headers', v_response_headers
  );

  update public.api_idempotency_keys
  set
    response_status = 200,
    response_body = v_response_body,
    resource_type = 'product',
    resource_id = p_product_id
  where api_idempotency_keys.org_id = v_product_org
    and api_idempotency_keys.actor_type = 'user'
    and api_idempotency_keys.actor_id = v_actor_id
    and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash;

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_response_body -> 'body',
    'response_headers', v_response_headers,
    'product', v_adjustment -> 'product',
    'movement', v_adjustment -> 'movement'
  );
end;
$$;
