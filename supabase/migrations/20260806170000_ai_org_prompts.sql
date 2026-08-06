-- Org-wide AI prompt overrides (non-secret). Defaults live in Edge/app code when a key is absent.

create table public.ai_org_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  prompts jsonb not null default '{}'::jsonb,
  constraint ai_org_settings_org_id_key unique (org_id)
);

create trigger ai_org_settings_stamp_business_row
before insert or update on public.ai_org_settings
for each row execute function private.stamp_business_row();

alter table public.ai_org_settings enable row level security;
revoke all on table public.ai_org_settings from public, anon, authenticated;
grant select (
  id, org_id, created_at, updated_at, created_by, updated_by, deleted_at, version, prompts
) on table public.ai_org_settings to authenticated;

create policy ai_org_settings_select_member on public.ai_org_settings
for select to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_ai_org_prompts(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row public.ai_org_settings;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member', 'readonly']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into row
  from public.ai_org_settings
  where ai_org_settings.org_id = p_org_id
    and ai_org_settings.deleted_at is null;

  if row.org_id is null then
    return jsonb_build_object(
      'org_id', p_org_id,
      'version', 0,
      'overrides', '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'org_id', row.org_id,
    'version', row.version,
    'overrides', coalesce(row.prompts, '{}'::jsonb)
  );
end;
$$;

create or replace function public.upsert_ai_org_prompts(
  p_org_id uuid,
  p_prompts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing public.ai_org_settings;
  merged jsonb := '{}'::jsonb;
  key text;
  value text;
  allowed text[] := array[
    'email_reply',
    'meeting_summary',
    'meeting_task_proposals',
    'invoice_chase'
  ];
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if p_prompts is null or jsonb_typeof(p_prompts) <> 'object' then
    raise exception 'prompts must be a JSON object'
      using errcode = '22023';
  end if;

  select * into existing
  from public.ai_org_settings
  where ai_org_settings.org_id = p_org_id
    and ai_org_settings.deleted_at is null;

  merged := coalesce(existing.prompts, '{}'::jsonb);

  for key in select jsonb_object_keys(p_prompts)
  loop
    if not (key = any (allowed)) then
      raise exception 'Unknown prompt key: %', key
        using errcode = '22023';
    end if;

    if jsonb_typeof(p_prompts -> key) = 'null' then
      merged := merged - key;
      continue;
    end if;

    if jsonb_typeof(p_prompts -> key) <> 'string' then
      raise exception 'Prompt % must be a string or null', key
        using errcode = '22023';
    end if;

    value := p_prompts ->> key;
    if value is null or length(trim(value)) = 0 then
      merged := merged - key;
    elsif length(value) > 16384 then
      raise exception 'Prompt % must be at most 16384 characters', key
        using errcode = '22023';
    else
      merged := jsonb_set(merged, array[key], to_jsonb(value), true);
    end if;
  end loop;

  if existing.org_id is null then
    insert into public.ai_org_settings (org_id, prompts, created_by, updated_by)
    values (p_org_id, merged, actor_id, actor_id)
    returning * into existing;
  else
    -- version/updated_* stamped by private.stamp_business_row
    update public.ai_org_settings
    set
      prompts = merged,
      updated_by = actor_id
    where ai_org_settings.id = existing.id
    returning * into existing;
  end if;

  return jsonb_build_object(
    'org_id', existing.org_id,
    'version', existing.version,
    'overrides', coalesce(existing.prompts, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.get_ai_org_prompts(uuid) from public, anon;
grant execute on function public.get_ai_org_prompts(uuid) to authenticated;

revoke all on function public.upsert_ai_org_prompts(uuid, jsonb) from public, anon;
grant execute on function public.upsert_ai_org_prompts(uuid, jsonb) to authenticated;

-- Replace prior 6-arg overload (PG treats added args as a new signature).
drop function if exists public.create_email_reply_suggestion(uuid, uuid, text, text, text, text);

-- Email-reply stub: accept prompt text/version from Edge; stop per-tone invented sentences.
create or replace function public.create_email_reply_suggestion(
  p_org_id uuid,
  p_message_id uuid,
  p_output_text text,
  p_model_provider text,
  p_model_name text,
  p_variant text default 'neutral',
  p_prompt_text text default null,
  p_prompt_version text default null
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
  suggestion public.ai_suggestions;
  snippet text;
  output text;
  variant text := coalesce(nullif(trim(p_variant), ''), 'neutral');
  can_see boolean := false;
  effective_prompt text;
  prompt_version text;
  override text;
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

  if p_output_text is null or length(trim(p_output_text)) = 0 then
    select nullif(trim(prompts ->> 'email_reply'), '') into override
    from public.ai_org_settings
    where ai_org_settings.org_id = p_org_id
      and ai_org_settings.deleted_at is null;

    effective_prompt := coalesce(
      nullif(trim(p_prompt_text), ''),
      override,
      'Draft a concise email reply based on the source message. Stay professional and actionable.'
    );

    prompt_version := coalesce(
      nullif(trim(p_prompt_version), ''),
      'ai-prompts-v1:' || left(encode(extensions.digest(effective_prompt, 'sha256'), 'hex'), 12)
    );

    snippet := left(
      regexp_replace(
        trim(coalesce(message_row.body_text, message_row.preview_text, '')),
        '\s+',
        ' ',
        'g'
      ),
      120
    );

    output := 'Thanks for your email'
      || case
        when coalesce(nullif(message_row.subject, ''), '') <> '' then
          ' about "' || message_row.subject || '".'
        else
          '.'
      end
      || E'\n\nI will follow up shortly.\n\n'
      || 'TONE: ' || variant
      || E'\n';

    if snippet <> '' then
      output := output
        || E'\n--\nRef: "'
        || snippet
        || '…"';
    end if;
  else
    output := p_output_text;
    prompt_version := coalesce(nullif(trim(p_prompt_version), ''), 'ai-prompts-v1');
  end if;

  insert into public.ai_suggestions (
    org_id, kind, entity_type, entity_id, status, variant,
    prompt_version, model_provider, model_name, output_text,
    source_email_message_id, created_by, updated_by
  )
  values (
    p_org_id, 'email_reply', 'email_message', p_message_id, 'ready',
    variant, prompt_version, p_model_provider, p_model_name,
    output, p_message_id, actor_id, actor_id
  )
  returning * into suggestion;

  return jsonb_build_object(
    'id', suggestion.id,
    'kind', suggestion.kind,
    'status', suggestion.status,
    'variant', suggestion.variant,
    'prompt_version', suggestion.prompt_version,
    'model_provider', suggestion.model_provider,
    'model_name', suggestion.model_name,
    'output_text', suggestion.output_text,
    'source_email_message_id', suggestion.source_email_message_id,
    'created_at', suggestion.created_at
  );
end;
$$;

create or replace function public.create_invoice_chase_suggestion(
  p_org_id uuid,
  p_invoice_id uuid,
  p_output_text text,
  p_model_provider text,
  p_model_name text,
  p_variant text default 'polite',
  p_prompt_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.invoices;
  suggestion public.ai_suggestions;
  output text;
  variant text := coalesce(nullif(trim(p_variant), ''), 'polite');
  prompt_version text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into invoice_row
  from public.invoices
  where invoices.id = p_invoice_id
    and invoices.org_id = p_org_id
    and invoices.deleted_at is null;

  if invoice_row.id is null then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  if p_output_text is null or length(trim(p_output_text)) = 0 then
    raise exception 'output_text is required'
      using errcode = '22023';
  end if;

  output := p_output_text;
  prompt_version := coalesce(nullif(trim(p_prompt_version), ''), 'ai-prompts-v1');

  insert into public.ai_suggestions (
    org_id, kind, entity_type, entity_id, status, variant,
    prompt_version, model_provider, model_name, output_text,
    created_by, updated_by
  )
  values (
    p_org_id, 'invoice_chase', 'invoice', p_invoice_id, 'ready',
    variant, prompt_version, p_model_provider, p_model_name,
    output, actor_id, actor_id
  )
  returning * into suggestion;

  return jsonb_build_object(
    'id', suggestion.id,
    'kind', suggestion.kind,
    'status', suggestion.status,
    'variant', suggestion.variant,
    'prompt_version', suggestion.prompt_version,
    'model_provider', suggestion.model_provider,
    'model_name', suggestion.model_name,
    'output_text', suggestion.output_text,
    'entity_type', suggestion.entity_type,
    'entity_id', suggestion.entity_id,
    'created_at', suggestion.created_at
  );
end;
$$;

revoke all on function public.create_email_reply_suggestion(
  uuid, uuid, text, text, text, text, text, text
) from public, anon;
grant execute on function public.create_email_reply_suggestion(
  uuid, uuid, text, text, text, text, text, text
) to authenticated;

revoke all on function public.create_invoice_chase_suggestion(uuid, uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.create_invoice_chase_suggestion(uuid, uuid, text, text, text, text, text)
  to authenticated;
