-- Per-mailbox sync cadence and authenticated self-service update RPC.

alter table public.mailbox_accounts
  add column sync_interval_minutes integer not null default 5
    constraint mailbox_accounts_sync_interval_minutes_check
    check (sync_interval_minutes between 1 and 60);

grant select (sync_interval_minutes)
  on table public.mailbox_accounts
  to authenticated;

create or replace function private.mailbox_account_public_json(
  p_row public.mailbox_accounts
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'org_id', p_row.org_id,
    'membership_id', p_row.membership_id,
    'email_address', p_row.email_address,
    'from_name', p_row.from_name,
    'imap_host', p_row.imap_host,
    'imap_port', p_row.imap_port,
    'imap_security', p_row.imap_security,
    'smtp_host', p_row.smtp_host,
    'smtp_port', p_row.smtp_port,
    'smtp_security', p_row.smtp_security,
    'username', p_row.username,
    'status', p_row.status,
    'auth_mode', p_row.auth_mode,
    'oauth_provider', p_row.oauth_provider,
    'last_checked_at', p_row.last_checked_at,
    'last_error_code', p_row.last_error_code,
    'credentials_configured', (p_row.secret_ref is not null),
    'credentials_updated_at', p_row.credentials_updated_at,
    'sync_catchup_complete', p_row.sync_catchup_complete,
    'sync_high_uid', p_row.sync_high_uid,
    'sync_low_uid', p_row.sync_low_uid,
    'sync_interval_minutes', p_row.sync_interval_minutes,
    'version', p_row.version,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at
  );
$$;

revoke all on function private.mailbox_account_public_json(public.mailbox_accounts)
  from public, anon, authenticated;

create or replace function public.list_mailboxes_due_for_sync(
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'org_id', m.org_id,
    'membership_id', m.membership_id,
    'imap_host', m.imap_host,
    'status', m.status,
    'consecutive_auth_failures', m.consecutive_auth_failures,
    'sync_catchup_complete', m.sync_catchup_complete
  ) order by m.sync_catchup_complete asc, m.last_checked_at nulls first), '[]'::jsonb)
  into rows
  from (
    select *
    from public.mailbox_accounts candidate
    where candidate.deleted_at is null
      and candidate.secret_ref is not null
      and candidate.status in ('pending', 'active', 'error')
      and candidate.consecutive_auth_failures < 3
      and (candidate.sync_lease_until is null or candidate.sync_lease_until < now())
      and (
        candidate.sync_catchup_complete = false
        or candidate.last_checked_at is null
        or candidate.last_checked_at <= now()
          - make_interval(mins => candidate.sync_interval_minutes)
      )
    order by candidate.sync_catchup_complete asc, candidate.last_checked_at nulls first
    limit greatest(p_limit, 1)
  ) m;

  return rows;
end;
$$;

create or replace function public.update_mailbox_sync_interval(
  p_org_id uuid,
  p_sync_interval_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  result_row public.mailbox_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_sync_interval_minutes is null
     or p_sync_interval_minutes not between 1 and 60 then
    raise exception 'Sync interval must be between 1 and 60 minutes'
      using errcode = '22023';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null
     or membership_row.role not in ('owner', 'admin', 'member') then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  update public.mailbox_accounts
  set
    sync_interval_minutes = p_sync_interval_minutes,
    updated_by = actor_id,
    version = mailbox_accounts.version + 1
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null
  returning * into result_row;

  if result_row.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  return private.mailbox_account_public_json(result_row);
end;
$$;

revoke all on function public.update_mailbox_sync_interval(uuid, integer)
  from public, anon;
grant execute on function public.update_mailbox_sync_interval(uuid, integer)
  to authenticated;
