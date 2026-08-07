-- H4: durable generation_failed rows + bounded in-process retries before pause.
-- PLANS/CODE_REVIEW_AUG7_REMEDIATION.md
--
-- Prior process_one wrapped INSERT+generate in one EXCEPTION block, so a generate
-- failure rolled back the run row and the handler's UPDATE matched nothing.
-- Nested subtransaction keeps the run; retry generate up to 3 attempts before pause.

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

  -- Generation runs in its own subtransaction so a failure cannot roll back the run row.
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

      update public.recurring_invoice_runs
      set
        status = 'generated',
        generated_at = now(),
        error_code = null,
        error_message = null,
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

  -- Exhausted retries — pause so a poison schedule does not block the due queue.
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
    'error', last_error,
    'attempts', max_attempts
  );
end;
$$;

revoke all on function private.process_one_due_recurring_schedule(
  public.recurring_invoice_schedules, text
) from public, anon, authenticated;
