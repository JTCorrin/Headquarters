-- Recurring invoice auto-send: delivery_pending after generate + delivery claim/complete RPCs.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Activate: require org invoice SMTP when delivery_mode = auto_send
-- ---------------------------------------------------------------------------

create or replace function public.activate_recurring_schedule(
  p_schedule_id uuid,
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
  schedule_row public.recurring_invoice_schedules;
  next_at timestamptz;
  active_lines integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
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
    raise exception 'Only draft recurring schedules can be activated'
      using errcode = '22023';
  end if;

  select count(*) into active_lines
  from public.recurring_invoice_lines
  where schedule_id = schedule_row.id
    and org_id = p_org_id
    and deleted_at is null
    and active;
  if active_lines < 1 then
    raise exception 'Activation requires at least one active line'
      using errcode = '22023';
  end if;

  if schedule_row.delivery_mode = 'auto_send'
    and not exists (
      select 1
      from public.org_invoice_email_accounts a
      where a.org_id = p_org_id
        and a.deleted_at is null
        and a.secret_ref is not null
        and a.status in ('active', 'error')
    )
  then
    raise exception
      'Auto-send requires organisation invoice email to be configured (Integrations → Email sending)'
      using errcode = '22023';
  end if;

  next_at := private.compute_recurring_next_run_at(
    schedule_row.frequency,
    schedule_row.interval_count,
    schedule_row.anchor_on,
    schedule_row.start_on,
    schedule_row.end_on,
    schedule_row.timezone,
    schedule_row.local_run_time,
    schedule_row.day_of_month,
    schedule_row.weekdays,
    schedule_row.month_of_year,
    schedule_row.month_end_policy,
    now()
  );
  if next_at is null then
    raise exception 'Could not compute next_run_at for activation'
      using errcode = '22023';
  end if;

  update public.recurring_invoice_schedules
  set
    status = 'active',
    next_run_at = next_at,
    activated_at = coalesce(activated_at, now()),
    paused_at = null,
    updated_by = actor_id
  where id = schedule_row.id;

  return private.recurring_schedule_document(schedule_row.id, p_org_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- After generate: auto_send → delivery_pending, draft → generated
-- ---------------------------------------------------------------------------

create or replace function private.process_one_due_recurring_schedule(
  p_schedule public.recurring_invoice_schedules,
  p_claimed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule_row public.recurring_invoice_schedules := p_schedule;
  run_row public.recurring_invoice_runs;
  actor_id uuid;
  occurrence_key text;
  local_date date;
  period_start date;
  period_end date;
  config_snapshot jsonb;
  lines_snapshot jsonb;
  invoice_doc jsonb;
  next_at timestamptz;
  next_count integer;
  scheduled_for timestamptz;
  max_attempts constant integer := 3;
  attempt integer;
  last_error text;
  run_status text;
begin
  if schedule_row.status is distinct from 'active'
    or schedule_row.deleted_at is not null
    or schedule_row.next_run_at is null
    or schedule_row.next_run_at > now()
  then
    return jsonb_build_object('skipped', true, 'reason', 'not_due');
  end if;

  scheduled_for := schedule_row.next_run_at;
  occurrence_key := 'scheduled:' || to_char(scheduled_for at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  begin
    local_date := (scheduled_for at time zone schedule_row.timezone)::date;
  exception
    when others then
      local_date := (timezone('utc', scheduled_for))::date;
  end;

  if schedule_row.frequency = 'weekly' then
    period_start := local_date - ((extract(isodow from local_date)::integer) - 1);
    period_end := period_start + 6;
  elsif schedule_row.frequency = 'monthly' then
    period_start := date_trunc('month', local_date)::date;
    period_end := (date_trunc('month', local_date)::date + interval '1 month' - interval '1 day')::date;
  elsif schedule_row.frequency = 'yearly' then
    period_start := make_date(extract(year from local_date)::integer, 1, 1);
    period_end := make_date(extract(year from local_date)::integer, 12, 31);
  else
    period_start := local_date;
    period_end := local_date;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(recurring_invoice_lines) order by position, id),
    '[]'::jsonb
  )
  into lines_snapshot
  from public.recurring_invoice_lines
  where schedule_id = schedule_row.id
    and org_id = schedule_row.org_id
    and deleted_at is null
    and active;

  if jsonb_array_length(lines_snapshot) < 1 then
    update public.recurring_invoice_schedules
    set
      status = 'paused',
      next_run_at = null,
      paused_at = coalesce(paused_at, now()),
      updated_at = now()
    where id = schedule_row.id;
    return jsonb_build_object(
      'skipped', true,
      'reason', 'no_active_lines',
      'schedule_id', schedule_row.id
    );
  end if;

  actor_id := schedule_row.created_by;
  if actor_id is null and schedule_row.owner_membership_id is not null then
    select memberships.user_id into actor_id
    from public.memberships
    where memberships.id = schedule_row.owner_membership_id
      and memberships.org_id = schedule_row.org_id;
  end if;
  if actor_id is null then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'no_actor',
      'schedule_id', schedule_row.id
    );
  end if;

  config_snapshot := jsonb_build_object(
    'schedule', to_jsonb(schedule_row),
    'lines', lines_snapshot
  );

  next_count := schedule_row.scheduled_occurrence_count + 1;

  begin
    insert into public.recurring_invoice_runs (
      org_id, schedule_id, occurrence_sequence, occurrence_key,
      scheduled_for, occurrence_local_date, occurrence_timezone,
      schedule_version, configuration_snapshot, period_start, period_end,
      trigger, status, attempt_count, available_at, claimed_at, claimed_by,
      generated_at, request_id
    ) values (
      schedule_row.org_id, schedule_row.id, next_count, occurrence_key,
      scheduled_for, local_date, schedule_row.timezone,
      schedule_row.rule_version, config_snapshot, period_start, period_end,
      'scheduled', 'processing', 1, now(), now(), p_claimed_by,
      null, null
    )
    returning * into run_row;
  exception
    when unique_violation then
      return jsonb_build_object(
        'skipped', true,
        'reason', 'duplicate_occurrence',
        'schedule_id', p_schedule.id
      );
  end;

  for attempt in 1..max_attempts loop
    begin
      update public.recurring_invoice_runs
      set
        attempt_count = attempt,
        status = 'processing',
        claimed_at = now(),
        claimed_by = p_claimed_by,
        updated_at = now()
      where id = run_row.id
      returning * into run_row;

      invoice_doc := private.generate_invoice_from_recurring_run(
        schedule_row.org_id, schedule_row, run_row, actor_id
      );

      run_status := case
        when schedule_row.delivery_mode = 'auto_send' then 'delivery_pending'
        else 'generated'
      end;

      update public.recurring_invoice_runs
      set
        status = run_status,
        generated_at = now(),
        error_code = null,
        error_message = null,
        available_at = now(),
        updated_at = now()
      where id = run_row.id
      returning * into run_row;

      next_at := private.compute_recurring_next_run_at(
        schedule_row.frequency,
        schedule_row.interval_count,
        schedule_row.anchor_on,
        schedule_row.start_on,
        schedule_row.end_on,
        schedule_row.timezone,
        schedule_row.local_run_time,
        schedule_row.day_of_month,
        schedule_row.weekdays,
        schedule_row.month_of_year,
        schedule_row.month_end_policy,
        scheduled_for
      );

      if schedule_row.max_occurrences is not null
        and next_count >= schedule_row.max_occurrences
      then
        next_at := null;
      end if;

      if next_at is null then
        update public.recurring_invoice_schedules
        set
          status = 'completed',
          next_run_at = null,
          scheduled_occurrence_count = next_count,
          last_run_at = now(),
          completed_at = now(),
          updated_at = now()
        where id = schedule_row.id;
      else
        update public.recurring_invoice_schedules
        set
          next_run_at = next_at,
          scheduled_occurrence_count = next_count,
          last_run_at = now(),
          updated_at = now()
        where id = schedule_row.id;
      end if;

      return jsonb_build_object(
        'skipped', false,
        'schedule_id', schedule_row.id,
        'run_id', run_row.id,
        'invoice_id', invoice_doc -> 'invoice' ->> 'id',
        'delivery_mode', schedule_row.delivery_mode,
        'run_status', run_status,
        'next_run_at', next_at,
        'attempts', attempt
      );
    exception
      when others then
        last_error := sqlerrm;
        raise warning
          'process_one_due_recurring_schedule attempt %/% failed for %: %',
          attempt, max_attempts, p_schedule.id, last_error;

        update public.recurring_invoice_runs
        set
          attempt_count = attempt,
          status = 'generation_failed',
          error_code = 'GENERATION_FAILED',
          error_message = left(last_error, 500),
          updated_at = now()
        where id = run_row.id;

        if attempt < max_attempts then
          continue;
        end if;
    end;
  end loop;

  update public.recurring_invoice_schedules
  set
    status = 'paused',
    next_run_at = null,
    paused_at = coalesce(paused_at, now()),
    updated_at = now()
  where id = p_schedule.id
    and status = 'active';

  return jsonb_build_object(
    'skipped', true,
    'reason', 'generation_failed',
    'schedule_id', p_schedule.id,
    'run_id', run_row.id,
    'error', left(last_error, 500)
  );
end;
$$;

-- Mirror delivery_mode for manual run-now
create or replace function public.run_now_recurring_schedule(
  p_schedule_id uuid,
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
  v_actor_id uuid := auth.uid();
  schedule_row public.recurring_invoice_schedules;
  run_row public.recurring_invoice_runs;
  v_existing public.api_idempotency_keys;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 86400), 60));
  occurrence_key text;
  local_date date;
  period_start date;
  period_end date;
  config_snapshot jsonb;
  invoice_doc jsonb;
  v_response_headers jsonb;
  v_response_body jsonb;
  lines_snapshot jsonb;
  run_status text;
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
      exit;
    exception
      when unique_violation then
        null;
    end;
  end loop;

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
  if schedule_row.status not in ('draft', 'active', 'paused') then
    raise exception 'run-now is not allowed for status %', schedule_row.status
      using errcode = '22023';
  end if;

  occurrence_key := 'manual:' || p_idempotency_key_hash;
  begin
    local_date := (now() at time zone schedule_row.timezone)::date;
  exception
    when others then
      local_date := (timezone('utc', now()))::date;
  end;

  if schedule_row.frequency = 'weekly' then
    period_start := local_date - ((extract(isodow from local_date)::integer) - 1);
    period_end := period_start + 6;
  elsif schedule_row.frequency = 'monthly' then
    period_start := date_trunc('month', local_date)::date;
    period_end := (date_trunc('month', local_date)::date + interval '1 month' - interval '1 day')::date;
  elsif schedule_row.frequency = 'yearly' then
    period_start := make_date(extract(year from local_date)::integer, 1, 1);
    period_end := make_date(extract(year from local_date)::integer, 12, 31);
  else
    period_start := local_date;
    period_end := local_date;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(recurring_invoice_lines) order by position, id),
    '[]'::jsonb
  )
  into lines_snapshot
  from public.recurring_invoice_lines
  where schedule_id = schedule_row.id
    and org_id = p_org_id
    and deleted_at is null
    and active;

  if jsonb_array_length(lines_snapshot) < 1 then
    raise exception 'run-now requires at least one active line' using errcode = '22023';
  end if;

  config_snapshot := jsonb_build_object(
    'schedule', to_jsonb(schedule_row),
    'lines', lines_snapshot
  );

  insert into public.recurring_invoice_runs (
    org_id, schedule_id, occurrence_sequence, occurrence_key,
    scheduled_for, occurrence_local_date, occurrence_timezone,
    schedule_version, configuration_snapshot, period_start, period_end,
    trigger, status, attempt_count, available_at, claimed_at, claimed_by,
    generated_at, request_id
  ) values (
    p_org_id, schedule_row.id, null, occurrence_key,
    now(), local_date, schedule_row.timezone,
    schedule_row.rule_version, config_snapshot, period_start, period_end,
    'manual', 'processing', 1, now(), now(), 'run-now:' || v_actor_id::text,
    null, null
  )
  returning * into run_row;

  invoice_doc := private.generate_invoice_from_recurring_run(
    p_org_id, schedule_row, run_row, v_actor_id
  );

  run_status := case
    when schedule_row.delivery_mode = 'auto_send' then 'delivery_pending'
    else 'generated'
  end;

  update public.recurring_invoice_runs
  set
    status = run_status,
    generated_at = now(),
    available_at = now(),
    updated_at = now()
  where id = run_row.id
  returning * into run_row;

  update public.recurring_invoice_schedules
  set last_run_at = now(), updated_by = v_actor_id
  where id = schedule_row.id;

  v_response_headers := jsonb_build_object(
    'etag', '"' || (private.recurring_schedule_document(schedule_row.id, p_org_id) -> 'schedule' ->> 'version') || '"'
  );
  v_response_body := jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object(
      'data', jsonb_build_object(
        'run', to_jsonb(run_row),
        'invoice', invoice_doc -> 'invoice',
        'lines', invoice_doc -> 'lines',
        'schedule', private.recurring_schedule_document(schedule_row.id, p_org_id) -> 'schedule'
      )
    ),
    'headers', v_response_headers
  );

  update public.api_idempotency_keys
  set
    response_status = 200,
    response_body = v_response_body,
    resource_type = 'recurring_invoice_run',
    resource_id = run_row.id
  where api_idempotency_keys.org_id = p_org_id
    and api_idempotency_keys.actor_type = 'user'
    and api_idempotency_keys.actor_id = v_actor_id
    and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash;

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_response_body -> 'body',
    'response_headers', v_response_headers
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery claim / complete / fail / retry (service_role + authenticated retry)
-- ---------------------------------------------------------------------------

create or replace function public.claim_recurring_invoice_deliveries(
  p_limit integer default 20,
  p_claimed_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  holder text := coalesce(nullif(trim(p_claimed_by), ''), 'delivery-' || gen_random_uuid()::text);
  lim integer := greatest(1, least(coalesce(p_limit, 20), 50));
  result jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select runs.id as run_id, runs.org_id, inv.id as invoice_id, inv.version as invoice_version
    from public.recurring_invoice_runs runs
    join public.invoices inv
      on inv.recurring_run_id = runs.id
     and inv.org_id = runs.org_id
     and inv.deleted_at is null
    where runs.status in ('delivery_pending', 'delivery_failed')
      and runs.available_at <= now()
      and inv.status = 'draft'
    order by runs.available_at asc, runs.id asc
    limit lim
    for update of runs skip locked
  loop
    update public.recurring_invoice_runs
    set
      status = 'delivery_pending',
      claimed_at = now(),
      claimed_by = holder,
      attempt_count = attempt_count + 1,
      updated_at = now()
    where id = r.run_id;

    result := result || jsonb_build_array(jsonb_build_object(
      'run_id', r.run_id,
      'org_id', r.org_id,
      'invoice_id', r.invoice_id,
      'invoice_version', r.invoice_version
    ));
  end loop;

  return result;
end;
$$;

revoke all on function public.claim_recurring_invoice_deliveries(integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_recurring_invoice_deliveries(integer, text)
  to service_role;

create or replace function public.complete_recurring_invoice_delivery(
  p_run_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.recurring_invoice_runs;
  invoice_row public.invoices;
  schedule_row public.recurring_invoice_schedules;
  actor_id uuid;
  snapshot jsonb;
  lines_json jsonb;
begin
  select * into run_row
  from public.recurring_invoice_runs
  where id = p_run_id and org_id = p_org_id
  for update;

  if run_row.id is null then
    raise exception 'Recurring run not found' using errcode = 'P0002';
  end if;

  select * into invoice_row
  from public.invoices
  where recurring_run_id = run_row.id
    and org_id = p_org_id
    and deleted_at is null
  for update;

  if invoice_row.id is null then
    raise exception 'Invoice for run not found' using errcode = 'P0002';
  end if;

  if invoice_row.status = 'sent' then
    update public.recurring_invoice_runs
    set
      status = 'sent',
      sent_at = coalesce(sent_at, invoice_row.sent_at, now()),
      error_code = null,
      error_message = null,
      updated_at = now()
    where id = run_row.id
    returning * into run_row;
    return jsonb_build_object(
      'run_id', run_row.id,
      'invoice_id', invoice_row.id,
      'status', 'sent',
      'already_sent', true
    );
  end if;

  if invoice_row.status <> 'draft' then
    raise exception 'Only draft invoices can be auto-sent' using errcode = '22023';
  end if;

  select * into schedule_row
  from public.recurring_invoice_schedules
  where id = run_row.schedule_id and org_id = p_org_id;

  actor_id := coalesce(schedule_row.created_by, invoice_row.created_by);
  if actor_id is null and schedule_row.owner_membership_id is not null then
    select memberships.user_id into actor_id
    from public.memberships
    where memberships.id = schedule_row.owner_membership_id
      and memberships.org_id = p_org_id;
  end if;

  if invoice_row.source = 'quote' and invoice_row.party_snapshot ? 'client' then
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
    jsonb_agg(to_jsonb(invoice_lines) order by position, id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_id = invoice_row.id
    and org_id = p_org_id;

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
      'client_id', invoice_row.client_id,
      'source', 'recurring_auto_send',
      'run_id', run_row.id
    )
  );

  if invoice_row.client_id is not null then
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
        'client_id', invoice_row.client_id,
        'source', 'recurring_auto_send',
        'run_id', run_row.id
      )
    );
  end if;

  update public.recurring_invoice_runs
  set
    status = 'sent',
    sent_at = now(),
    error_code = null,
    error_message = null,
    claimed_at = null,
    claimed_by = null,
    updated_at = now()
  where id = run_row.id
  returning * into run_row;

  return jsonb_build_object(
    'run_id', run_row.id,
    'invoice_id', invoice_row.id,
    'status', 'sent',
    'already_sent', false
  );
end;
$$;

revoke all on function public.complete_recurring_invoice_delivery(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_recurring_invoice_delivery(uuid, uuid)
  to service_role;

create or replace function public.fail_recurring_invoice_delivery(
  p_run_id uuid,
  p_org_id uuid,
  p_error_code text,
  p_error_message text,
  p_retry_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.recurring_invoice_runs;
  backoff integer := greatest(60, least(coalesce(p_retry_seconds, 300), 86400));
begin
  select * into run_row
  from public.recurring_invoice_runs
  where id = p_run_id and org_id = p_org_id
  for update;

  if run_row.id is null then
    raise exception 'Recurring run not found' using errcode = 'P0002';
  end if;

  update public.recurring_invoice_runs
  set
    status = 'delivery_failed',
    error_code = left(coalesce(nullif(trim(p_error_code), ''), 'DELIVERY_FAILED'), 120),
    error_message = left(coalesce(nullif(trim(p_error_message), ''), 'Delivery failed'), 500),
    available_at = now() + make_interval(secs => backoff),
    claimed_at = null,
    claimed_by = null,
    updated_at = now()
  where id = run_row.id
  returning * into run_row;

  return jsonb_build_object(
    'run_id', run_row.id,
    'status', run_row.status,
    'available_at', run_row.available_at,
    'error_code', run_row.error_code
  );
end;
$$;

revoke all on function public.fail_recurring_invoice_delivery(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.fail_recurring_invoice_delivery(uuid, uuid, text, text, integer)
  to service_role;

create or replace function public.retry_recurring_invoice_delivery(
  p_run_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.recurring_invoice_runs;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into run_row
  from public.recurring_invoice_runs
  where id = p_run_id and org_id = p_org_id
  for update;

  if run_row.id is null then
    raise exception 'Recurring run not found' using errcode = 'P0002';
  end if;

  if run_row.status not in ('delivery_failed', 'delivery_unknown') then
    raise exception 'Only failed deliveries can be retried' using errcode = '22023';
  end if;

  update public.recurring_invoice_runs
  set
    status = 'delivery_pending',
    available_at = now(),
    error_code = null,
    error_message = null,
    claimed_at = null,
    claimed_by = null,
    updated_at = now()
  where id = run_row.id
  returning * into run_row;

  return to_jsonb(run_row);
end;
$$;

revoke all on function public.retry_recurring_invoice_delivery(uuid, uuid) from public, anon;
grant execute on function public.retry_recurring_invoice_delivery(uuid, uuid) to authenticated;
