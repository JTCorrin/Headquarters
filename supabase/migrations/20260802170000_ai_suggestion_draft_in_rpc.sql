-- Wave B hotfix: synthesize email_reply draft inside the security-definer RPC.
-- Staging proof failed because Edge selected public.email_messages via PostgREST
-- (table may be missing from the REST schema cache on an already-running stack),
-- while all other Wave B paths use RPCs successfully.

create or replace function public.create_email_reply_suggestion(
  p_org_id uuid,
  p_message_id uuid,
  p_output_text text,
  p_model_provider text,
  p_model_name text,
  p_variant text default 'neutral'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  message_row public.email_messages;
  suggestion public.ai_suggestions;
  tone text;
  snippet text;
  output text;
  variant text := coalesce(nullif(trim(p_variant), ''), 'neutral');
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into message_row
  from public.email_messages
  where email_messages.id = p_message_id
    and email_messages.org_id = p_org_id
    and email_messages.deleted_at is null;

  if message_row.id is null then
    raise exception 'Email message not found'
      using errcode = 'P0002';
  end if;

  if p_output_text is null or length(trim(p_output_text)) = 0 then
    if variant = 'firm' then
      tone := 'Thanks for your note — please confirm the next step by end of week.';
    elsif variant = 'warm' then
      tone := 'Thanks so much for getting in touch — happy to help.';
    else
      tone := 'Thanks for your email — I will follow up shortly.';
    end if;

    snippet := left(
      regexp_replace(
        trim(coalesce(message_row.body_text, message_row.preview_text, '')),
        '\s+',
        ' ',
        'g'
      ),
      120
    );

    output := tone
      || E'\n\nRe: '
      || coalesce(nullif(message_row.subject, ''), '(no subject)')
      || E'\n(From '
      || coalesce(message_row.from_address::text, 'unknown');

    if snippet <> '' then
      output := output || '; ref: "' || snippet || '…"';
    end if;

    output := output || E')\n';
  else
    output := p_output_text;
  end if;

  insert into public.ai_suggestions (
    org_id, kind, entity_type, entity_id, status, variant,
    prompt_version, model_provider, model_name, output_text,
    source_email_message_id, created_by, updated_by
  )
  values (
    p_org_id, 'email_reply', 'email_message', p_message_id, 'ready',
    variant, 'wave-b-v1', p_model_provider, p_model_name,
    output, p_message_id, actor_id, actor_id
  )
  returning * into suggestion;

  return jsonb_build_object(
    'id', suggestion.id,
    'kind', suggestion.kind,
    'status', suggestion.status,
    'variant', suggestion.variant,
    'model_provider', suggestion.model_provider,
    'model_name', suggestion.model_name,
    'output_text', suggestion.output_text,
    'source_email_message_id', suggestion.source_email_message_id,
    'created_at', suggestion.created_at
  );
end;
$$;
