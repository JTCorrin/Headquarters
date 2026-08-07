-- Persist selected AI model on integration config; preserve on key replace.

create or replace function public.upsert_ai_integration(
  p_org_id uuid,
  p_provider text,
  p_api_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  integration_type text;
  display_name text;
  existing public.integrations;
  new_secret uuid;
  old_secret uuid;
  result_row public.integrations;
  next_config jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  -- Wave B: AI writes are owner-only (not owner/admin).
  if not private.has_org_role(p_org_id, array['owner']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if p_api_key is null or length(trim(p_api_key)) < 8 then
    raise exception 'API key is required'
      using errcode = '22023';
  end if;

  case p_provider
    when 'openai' then
      integration_type := 'ai_openai';
      display_name := 'OpenAI';
    when 'anthropic' then
      integration_type := 'ai_anthropic';
      display_name := 'Anthropic';
    when 'google' then
      integration_type := 'ai_google';
      display_name := 'Google';
    when 'openrouter' then
      integration_type := 'ai_openrouter';
      display_name := 'OpenRouter';
    else
      raise exception 'Unknown AI provider'
        using errcode = '22023';
  end case;

  select * into existing
  from public.integrations
  where integrations.org_id = p_org_id
    and integrations.type = integration_type
    and integrations.deleted_at is null
  for update;

  new_secret := private.store_secret(trim(p_api_key));
  next_config := jsonb_build_object('provider', p_provider, 'auth_mode', 'api_key');
  if existing.id is not null
    and existing.config ? 'model'
    and jsonb_typeof(existing.config -> 'model') = 'string'
    and length(trim(existing.config ->> 'model')) > 0
  then
    next_config := next_config || jsonb_build_object('model', trim(existing.config ->> 'model'));
  end if;

  if existing.id is null then
    insert into public.integrations (
      org_id,
      type,
      name,
      status,
      config,
      secret_ref,
      connected_by,
      credentials_updated_at,
      created_by,
      updated_by
    )
    values (
      p_org_id,
      integration_type,
      display_name,
      'active',
      next_config,
      new_secret,
      actor_id,
      now(),
      actor_id,
      actor_id
    )
    returning * into result_row;
  else
    old_secret := existing.secret_ref;
    update public.integrations
    set
      name = display_name,
      status = 'active',
      config = next_config,
      secret_ref = new_secret,
      connected_by = actor_id,
      credentials_updated_at = now(),
      last_error_code = null,
      updated_by = actor_id,
      version = existing.version + 1
    where integrations.id = existing.id
    returning * into result_row;

    if old_secret is not null and old_secret is distinct from new_secret then
      perform private.delete_secret(old_secret);
    end if;
  end if;

  return jsonb_build_object(
    'id', result_row.id,
    'org_id', result_row.org_id,
    'type', result_row.type,
    'provider', p_provider,
    'name', result_row.name,
    'status', result_row.status,
    'config', result_row.config,
    'selected_model', nullif(trim(result_row.config ->> 'model'), ''),
    'credentials_configured', (result_row.secret_ref is not null),
    'credentials_updated_at', result_row.credentials_updated_at,
    'connected_by', result_row.connected_by,
    'last_error_code', result_row.last_error_code,
    'version', result_row.version,
    'created_at', result_row.created_at,
    'updated_at', result_row.updated_at
  );
end;
$$;

create or replace function public.set_ai_integration_model(
  p_org_id uuid,
  p_provider text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  integration_type text;
  existing public.integrations;
  result_row public.integrations;
  cleaned text := nullif(trim(coalesce(p_model, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  -- Wave B: AI writes are owner-only (not owner/admin).
  if not private.has_org_role(p_org_id, array['owner']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if cleaned is null or length(cleaned) > 256 then
    raise exception 'Model is required'
      using errcode = '22023';
  end if;

  case p_provider
    when 'openai' then integration_type := 'ai_openai';
    when 'anthropic' then integration_type := 'ai_anthropic';
    when 'google' then integration_type := 'ai_google';
    when 'openrouter' then integration_type := 'ai_openrouter';
    else
      raise exception 'Unknown AI provider'
        using errcode = '22023';
  end case;

  select * into existing
  from public.integrations
  where integrations.org_id = p_org_id
    and integrations.type = integration_type
    and integrations.deleted_at is null
  for update;

  if existing.id is null or existing.secret_ref is null then
    raise exception 'Integration not found'
      using errcode = 'P0002';
  end if;

  update public.integrations
  set
    config = coalesce(existing.config, '{}'::jsonb)
      || jsonb_build_object(
        'provider', p_provider,
        'auth_mode', 'api_key',
        'model', cleaned
      ),
    updated_by = actor_id,
    version = existing.version + 1
  where integrations.id = existing.id
  returning * into result_row;

  return jsonb_build_object(
    'id', result_row.id,
    'org_id', result_row.org_id,
    'type', result_row.type,
    'provider', p_provider,
    'name', result_row.name,
    'status', result_row.status,
    'config', result_row.config,
    'selected_model', cleaned,
    'credentials_configured', (result_row.secret_ref is not null),
    'credentials_updated_at', result_row.credentials_updated_at,
    'connected_by', result_row.connected_by,
    'last_error_code', result_row.last_error_code,
    'version', result_row.version,
    'created_at', result_row.created_at,
    'updated_at', result_row.updated_at
  );
end;
$$;

create or replace function public.list_ai_integrations(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  rows jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'org_id', i.org_id,
      'type', i.type,
      'provider', case i.type
        when 'ai_openai' then 'openai'
        when 'ai_anthropic' then 'anthropic'
        when 'ai_google' then 'google'
        when 'ai_openrouter' then 'openrouter'
        else null
      end,
      'name', i.name,
      'status', i.status,
      'config', i.config,
      'selected_model', nullif(trim(i.config ->> 'model'), ''),
      'credentials_configured', (i.secret_ref is not null),
      'credentials_updated_at', i.credentials_updated_at,
      'connected_by', i.connected_by,
      'last_error_code', i.last_error_code,
      'version', i.version,
      'created_at', i.created_at,
      'updated_at', i.updated_at
    )
  order by i.type
  ), '[]'::jsonb)
  into rows
  from public.integrations i
  where i.org_id = p_org_id
    and i.deleted_at is null
    and i.type like 'ai_%';

  return rows;
end;
$$;

revoke all on function public.set_ai_integration_model(uuid, text, text) from public, anon;
grant execute on function public.set_ai_integration_model(uuid, text, text) to authenticated;
