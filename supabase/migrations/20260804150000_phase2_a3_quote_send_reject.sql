-- Phase 2 A3: quote send + reject lifecycle RPCs (mirror accept_quote / send_invoice)

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

    if quote_row.contact_id is not null then
      select * into contact_row
      from public.contacts
      where contacts.id = quote_row.contact_id
        and contacts.org_id = p_org_id;
    end if;

    snapshot := jsonb_build_object(
      'client', jsonb_build_object(
        'id', client_row.id,
        'name', client_row.name,
        'primary_email', client_row.primary_email,
        'phone', client_row.phone,
        'tax_identifier', client_row.tax_identifier,
        'registration_number', client_row.registration_number
      ),
      'contact', case
        when contact_row.id is not null then jsonb_build_object(
          'id', contact_row.id,
          'display_name', contact_row.display_name,
          'primary_email', contact_row.primary_email,
          'primary_phone', contact_row.primary_phone
        )
        else null
      end
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
    'lines', lines_json
  );
end;
$$;

revoke all on function public.send_quote(uuid, uuid, integer) from public, anon;
grant execute on function public.send_quote(uuid, uuid, integer) to authenticated;

create or replace function public.reject_quote(
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
    raise exception 'Only draft or sent quotes can be rejected'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_quote_lifecycle', 'on', true);
  perform set_config('app.allow_quote_totals', 'on', true);

  update public.quotes
  set
    status = 'rejected',
    rejected_at = now(),
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
    'Quote rejected',
    null,
    actor_id,
    'quote',
    quote_row.id,
    jsonb_build_object(
      'action', 'quote.rejected',
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
      'Quote rejected',
      format('Quote %s', quote_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.rejected',
        'quote_id', quote_row.id,
        'number', quote_row.number,
        'client_id', quote_row.client_id
      )
    );
  end if;

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json
  );
end;
$$;

revoke all on function public.reject_quote(uuid, uuid, integer) from public, anon;
grant execute on function public.reject_quote(uuid, uuid, integer) to authenticated;
