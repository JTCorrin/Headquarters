-- Phase 2 A5: Idempotency-Key store+replay for financial lifecycle mutations.
-- Payment reverse already has reverse_payment_idempotent (payments foundation).
-- This adds invoice send/void, quote accept, bill receive/void.

-- ---------------------------------------------------------------------------
-- Shared claim / store helpers (SECURITY DEFINER; not granted to clients)
-- ---------------------------------------------------------------------------

create or replace function private.idempotency_claim_or_replay(
  p_org_id uuid,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.api_idempotency_keys;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 86400), 60));
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_org_id is null
    or p_idempotency_key_hash is null
    or char_length(p_idempotency_key_hash) <> 64
    or p_request_hash is null
    or char_length(p_request_hash) <> 64
    or p_route is null
    or char_length(p_route) < 1
  then
    raise exception 'Idempotency claim parameters are invalid' using errcode = '22023';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  loop
    select * into v_existing
    from public.api_idempotency_keys
    where api_idempotency_keys.org_id = p_org_id
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
        raise exception 'An identical request is already in progress' using errcode = '55000';
      end if;
      delete from public.api_idempotency_keys where id = v_existing.id;
    end if;

    begin
      insert into public.api_idempotency_keys (
        org_id, actor_type, actor_id, idempotency_key_hash, route, request_hash, expires_at
      ) values (
        p_org_id, 'user', v_actor_id, p_idempotency_key_hash, p_route, p_request_hash, v_expires_at
      );
      return null;
    exception
      when unique_violation then
        null;
    end;
  end loop;
end;
$$;

revoke all on function private.idempotency_claim_or_replay(
  uuid, text, text, text, integer
) from public, anon, authenticated;

create or replace function private.idempotency_store_response(
  p_org_id uuid,
  p_idempotency_key_hash text,
  p_response_status integer,
  p_response_body jsonb,
  p_resource_type text,
  p_resource_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  update public.api_idempotency_keys
  set
    response_status = p_response_status,
    response_body = p_response_body,
    resource_type = p_resource_type,
    resource_id = p_resource_id
  where api_idempotency_keys.org_id = p_org_id
    and api_idempotency_keys.actor_type = 'user'
    and api_idempotency_keys.actor_id = v_actor_id
    and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash;
end;
$$;

revoke all on function private.idempotency_store_response(
  uuid, text, integer, jsonb, text, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Document flatten helper: { invoice|quote|bill, lines } → Edge document
-- ---------------------------------------------------------------------------

create or replace function private.financial_document_envelope(
  p_doc jsonb,
  p_entity_key text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_flat jsonb;
  v_headers jsonb;
  v_body jsonb;
begin
  v_flat := coalesce(p_doc -> p_entity_key, '{}'::jsonb)
    || jsonb_build_object('lines', coalesce(p_doc -> 'lines', '[]'::jsonb));
  v_headers := jsonb_build_object(
    'etag', '"' || coalesce(v_flat ->> 'version', '0') || '"'
  );
  v_body := jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object('data', v_flat),
    'headers', v_headers
  );
  return v_body;
end;
$$;

revoke all on function private.financial_document_envelope(jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invoice send / void
-- ---------------------------------------------------------------------------

create or replace function public.send_invoice_idempotent(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_doc jsonb;
  v_stored jsonb;
begin
  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_doc := public.send_invoice(p_invoice_id, p_org_id, p_expected_version);
  v_stored := private.financial_document_envelope(v_doc, 'invoice');
  perform private.idempotency_store_response(
    p_org_id, p_idempotency_key_hash, 200, v_stored, 'invoice', p_invoice_id
  );

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_stored -> 'body',
    'response_headers', v_stored -> 'headers'
  );
end;
$$;

revoke all on function public.send_invoice_idempotent(
  uuid, uuid, integer, text, text, text, integer
) from public, anon;
grant execute on function public.send_invoice_idempotent(
  uuid, uuid, integer, text, text, text, integer
) to authenticated;

create or replace function public.void_invoice_idempotent(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_void_reason text,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_doc jsonb;
  v_stored jsonb;
begin
  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_doc := public.void_invoice(
    p_invoice_id, p_org_id, p_expected_version, p_void_reason
  );
  v_stored := private.financial_document_envelope(v_doc, 'invoice');
  perform private.idempotency_store_response(
    p_org_id, p_idempotency_key_hash, 200, v_stored, 'invoice', p_invoice_id
  );

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_stored -> 'body',
    'response_headers', v_stored -> 'headers'
  );
end;
$$;

revoke all on function public.void_invoice_idempotent(
  uuid, uuid, integer, text, text, text, text, integer
) from public, anon;
grant execute on function public.void_invoice_idempotent(
  uuid, uuid, integer, text, text, text, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- Quote accept
-- ---------------------------------------------------------------------------

create or replace function public.accept_quote_idempotent(
  p_quote_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_doc jsonb;
  v_stored jsonb;
begin
  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_doc := public.accept_quote(p_quote_id, p_org_id, p_expected_version);
  v_stored := private.financial_document_envelope(v_doc, 'quote');
  perform private.idempotency_store_response(
    p_org_id, p_idempotency_key_hash, 200, v_stored, 'quote', p_quote_id
  );

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_stored -> 'body',
    'response_headers', v_stored -> 'headers'
  );
end;
$$;

revoke all on function public.accept_quote_idempotent(
  uuid, uuid, integer, text, text, text, integer
) from public, anon;
grant execute on function public.accept_quote_idempotent(
  uuid, uuid, integer, text, text, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- Bill receive / void
-- ---------------------------------------------------------------------------

create or replace function public.receive_bill_idempotent(
  p_bill_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_doc jsonb;
  v_stored jsonb;
begin
  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_doc := public.receive_bill(p_bill_id, p_org_id, p_expected_version);
  v_stored := private.financial_document_envelope(v_doc, 'bill');
  perform private.idempotency_store_response(
    p_org_id, p_idempotency_key_hash, 200, v_stored, 'bill', p_bill_id
  );

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_stored -> 'body',
    'response_headers', v_stored -> 'headers'
  );
end;
$$;

revoke all on function public.receive_bill_idempotent(
  uuid, uuid, integer, text, text, text, integer
) from public, anon;
grant execute on function public.receive_bill_idempotent(
  uuid, uuid, integer, text, text, text, integer
) to authenticated;

create or replace function public.void_bill_idempotent(
  p_bill_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_void_reason text,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_doc jsonb;
  v_stored jsonb;
begin
  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_doc := public.void_bill(
    p_bill_id, p_org_id, p_expected_version, p_void_reason
  );
  v_stored := private.financial_document_envelope(v_doc, 'bill');
  perform private.idempotency_store_response(
    p_org_id, p_idempotency_key_hash, 200, v_stored, 'bill', p_bill_id
  );

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_stored -> 'body',
    'response_headers', v_stored -> 'headers'
  );
end;
$$;

revoke all on function public.void_bill_idempotent(
  uuid, uuid, integer, text, text, text, text, integer
) from public, anon;
grant execute on function public.void_bill_idempotent(
  uuid, uuid, integer, text, text, text, text, integer
) to authenticated;
