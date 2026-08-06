-- Service-role credential read for org AI providers + user-scoped email AI context.

create or replace function public.read_ai_integration_credentials(
  p_org_id uuid,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  integration_type text;
  existing public.integrations;
  api_key text;
begin
  integration_type := case lower(trim(p_provider))
    when 'openai' then 'ai_openai'
    when 'anthropic' then 'ai_anthropic'
    when 'google' then 'ai_google'
    when 'openrouter' then 'ai_openrouter'
    else null
  end;

  if integration_type is null then
    raise exception 'Unknown AI provider'
      using errcode = '22023';
  end if;

  select * into existing
  from public.integrations
  where integrations.org_id = p_org_id
    and integrations.type = integration_type
    and integrations.deleted_at is null;

  if existing.id is null then
    raise exception 'AI integration not found'
      using errcode = 'P0002';
  end if;

  if existing.secret_ref is null or existing.status <> 'active' then
    raise exception 'AI integration is not active'
      using errcode = 'P0002';
  end if;

  api_key := private.read_secret(existing.secret_ref);

  return jsonb_build_object(
    'provider', lower(trim(p_provider)),
    'api_key', api_key,
    'status', existing.status
  );
end;
$$;

revoke all on function public.read_ai_integration_credentials(uuid, text)
  from public, anon, authenticated;
grant execute on function public.read_ai_integration_credentials(uuid, text)
  to service_role;

-- Visible message fields for AI generate (same gate as create_email_reply_suggestion).
create or replace function public.get_email_message_ai_context(
  p_org_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_membership_id uuid;
  message_row public.email_messages;
  can_see boolean := false;
  body text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  actor_membership_id := private.current_membership_id(p_org_id);

  select * into message_row
  from public.email_messages
  where email_messages.id = p_message_id
    and email_messages.org_id = p_org_id
    and email_messages.deleted_at is null;

  if message_row.id is null then
    raise exception 'Email message not found'
      using errcode = 'P0002';
  end if;

  can_see := (
    actor_membership_id is not null
    and (
      message_row.owner_membership_id = actor_membership_id
      or exists (
        select 1
        from public.email_message_links l
        where l.message_id = message_row.id
          and l.org_id = message_row.org_id
          and l.link_reason = 'timeline_share'
      )
    )
  );

  if not can_see then
    raise exception 'Email message not found'
      using errcode = 'P0002';
  end if;

  body := left(
    coalesce(message_row.body_text, message_row.preview_text, ''),
    12000
  );

  return jsonb_build_object(
    'id', message_row.id,
    'subject', message_row.subject,
    'from_address', message_row.from_address,
    'from_name', message_row.from_name,
    'body_text', body
  );
end;
$$;

revoke all on function public.get_email_message_ai_context(uuid, uuid)
  from public, anon;
grant execute on function public.get_email_message_ai_context(uuid, uuid)
  to authenticated;
