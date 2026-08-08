-- Playbook runs + steps (Phase C). Concurrent runs per playbook;
-- at most one active run per (playbook, root entity).

set search_path = public, extensions, pg_catalog;

create table public.playbook_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  playbook_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null,
  trigger_kind text not null,
  trigger_payload jsonb not null default '{}'::jsonb,
  root_entity_type text,
  root_entity_id uuid,
  context jsonb not null default '{}'::jsonb,
  current_node_id text,
  next_action_at timestamptz,
  playbook_version integer not null check (playbook_version > 0),
  graph_snapshot jsonb not null,
  last_error text,
  constraint playbook_runs_playbook_fk
    foreign key (org_id, playbook_id)
    references public.playbooks (org_id, id)
    on delete cascade,
  constraint playbook_runs_status_check
    check (status in (
      'scheduled',
      'running',
      'waiting',
      'completed',
      'failed',
      'cancelled',
      'skipped_busy'
    )),
  constraint playbook_runs_org_id_id_key unique (org_id, id)
);

create index playbook_runs_org_playbook_idx
  on public.playbook_runs (org_id, playbook_id, created_at desc);

create index playbook_runs_due_idx
  on public.playbook_runs (next_action_at, status)
  where status in ('scheduled', 'waiting') and next_action_at is not null;

-- One active run per playbook + root entity (null entity → synthetic key via coalesce).
create unique index playbook_runs_active_entity_uidx
  on public.playbook_runs (
    playbook_id,
    coalesce(root_entity_type, ''),
    coalesce(root_entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status in ('scheduled', 'running', 'waiting');

create table public.playbook_run_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  run_id uuid not null,
  created_at timestamptz not null default now(),
  node_id text not null,
  node_type text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  error text,
  constraint playbook_run_steps_run_fk
    foreign key (org_id, run_id)
    references public.playbook_runs (org_id, id)
    on delete cascade,
  constraint playbook_run_steps_status_check
    check (status in ('started', 'completed', 'failed', 'skipped'))
);

create index playbook_run_steps_run_idx
  on public.playbook_run_steps (org_id, run_id, created_at);

alter table public.playbook_runs enable row level security;
alter table public.playbook_run_steps enable row level security;

create policy playbook_runs_select_member
on public.playbook_runs for select to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
);

create policy playbook_run_steps_select_member
on public.playbook_run_steps for select to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
);

revoke all on table public.playbook_runs from public, anon, authenticated;
revoke all on table public.playbook_run_steps from public, anon, authenticated;
grant select on table public.playbook_runs to authenticated;
grant select on table public.playbook_run_steps to authenticated;

-- Manual start (member+). Returns run row as jsonb or raises.
create or replace function public.start_playbook_run_manual(
  p_org_id uuid,
  p_playbook_id uuid,
  p_root_entity_type text default null,
  p_root_entity_id uuid default null,
  p_trigger_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  pb public.playbooks;
  run_row public.playbook_runs;
  first_node text;
  graph jsonb;
  nodes jsonb;
  trigger_id text;
  n jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into pb
  from public.playbooks
  where playbooks.id = p_playbook_id
    and playbooks.org_id = p_org_id
    and playbooks.deleted_at is null
  for share;

  if not found then
    raise exception 'Playbook not found' using errcode = 'P0002';
  end if;

  graph := pb.graph_json;
  nodes := graph->'nodes';

  trigger_id := null;
  for n in select * from jsonb_array_elements(nodes)
  loop
    if n->>'type' = 'trigger' then
      if trigger_id is not null then
        raise exception 'Playbook must have exactly one trigger' using errcode = '22023';
      end if;
      trigger_id := n->>'id';
    end if;
  end loop;
  if trigger_id is null then
    raise exception 'Playbook must have exactly one trigger' using errcode = '22023';
  end if;

  select elem->>'target'
  into first_node
  from jsonb_array_elements(coalesce(graph->'edges', '[]'::jsonb)) as elem
  where elem->>'source' = trigger_id
  order by elem->>'target', elem->>'id'
  limit 1;

  if first_node is null then
    -- Trigger-only graph: complete immediately.
    insert into public.playbook_runs (
      org_id, playbook_id, status, trigger_kind, trigger_payload,
      root_entity_type, root_entity_id, current_node_id, next_action_at,
      playbook_version, graph_snapshot
    ) values (
      p_org_id, p_playbook_id, 'completed', 'manual.run', coalesce(p_trigger_payload, '{}'::jsonb),
      p_root_entity_type, p_root_entity_id, null, null,
      pb.version, graph
    )
    returning * into run_row;
  else
    begin
      insert into public.playbook_runs (
        org_id, playbook_id, status, trigger_kind, trigger_payload,
        root_entity_type, root_entity_id, current_node_id, next_action_at,
        playbook_version, graph_snapshot
      ) values (
        p_org_id, p_playbook_id, 'scheduled', 'manual.run', coalesce(p_trigger_payload, '{}'::jsonb),
        p_root_entity_type, p_root_entity_id, first_node, now(),
        pb.version, graph
      )
      returning * into run_row;
    exception
      when unique_violation then
        insert into public.playbook_runs (
          org_id, playbook_id, status, trigger_kind, trigger_payload,
          root_entity_type, root_entity_id, current_node_id, next_action_at,
          playbook_version, graph_snapshot, last_error
        ) values (
          p_org_id, p_playbook_id, 'skipped_busy', 'manual.run', coalesce(p_trigger_payload, '{}'::jsonb),
          p_root_entity_type, p_root_entity_id, null, null,
          pb.version, graph, 'Active run already exists for this playbook and entity'
        )
        returning * into run_row;
    end;
  end if;

  return to_jsonb(run_row);
end;
$$;

revoke all on function public.start_playbook_run_manual(uuid, uuid, text, uuid, jsonb)
  from public, anon;
grant execute on function public.start_playbook_run_manual(uuid, uuid, text, uuid, jsonb)
  to authenticated;

create or replace function public.cancel_playbook_run(
  p_org_id uuid,
  p_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.playbook_runs;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into run_row
  from public.playbook_runs
  where id = p_run_id and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Playbook run not found' using errcode = 'P0002';
  end if;

  if run_row.status not in ('scheduled', 'running', 'waiting') then
    return;
  end if;

  update public.playbook_runs
  set status = 'cancelled', next_action_at = null, updated_at = now()
  where id = run_row.id;
end;
$$;

revoke all on function public.cancel_playbook_run(uuid, uuid) from public, anon;
grant execute on function public.cancel_playbook_run(uuid, uuid) to authenticated;

-- Service-role / cron: claim due runs.
create or replace function public.claim_due_playbook_runs(
  p_limit integer default 20
)
returns setof public.playbook_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select r.id
    from public.playbook_runs r
    where r.status in ('scheduled', 'waiting')
      and r.next_action_at is not null
      and r.next_action_at <= now()
    order by r.next_action_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.playbook_runs r
  set status = 'running', updated_at = now()
  from due
  where r.id = due.id
  returning r.*;
end;
$$;

revoke all on function public.claim_due_playbook_runs(integer) from public, anon, authenticated;
grant execute on function public.claim_due_playbook_runs(integer) to service_role;
