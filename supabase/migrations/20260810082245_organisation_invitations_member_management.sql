-- Application-owned organisation invitations and owner-safe member management.
-- Raw invitation tokens are generated and delivered by the Edge API; only SHA-256
-- hashes are persisted.

create table public.organisation_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  email citext not null,
  role text not null,
  token_hash text not null unique,
  invited_by uuid not null references public.profiles (id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisation_invitations_email_normalized
    check (email::text = lower(btrim(email::text)) and email::text ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint organisation_invitations_role_check
    check (role in ('admin', 'member', 'billing', 'readonly')),
  constraint organisation_invitations_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint organisation_invitations_expiry_check
    check (expires_at > created_at),
  constraint organisation_invitations_terminal_state_check
    check (not (accepted_at is not null and revoked_at is not null)),
  constraint organisation_invitations_acceptance_check
    check ((accepted_at is null) = (accepted_by is null)),
  constraint organisation_invitations_revocation_check
    check ((revoked_at is null) = (revoked_by is null))
);

create unique index organisation_invitations_one_pending_email_idx
  on public.organisation_invitations (org_id, email)
  where accepted_at is null and revoked_at is null;

create index organisation_invitations_org_created_idx
  on public.organisation_invitations (org_id, created_at desc, id desc);

create index organisation_invitations_pending_expiry_idx
  on public.organisation_invitations (expires_at)
  where accepted_at is null and revoked_at is null;

create trigger organisation_invitations_set_updated_at
before update on public.organisation_invitations
for each row execute function private.set_updated_at();

alter table public.organisation_invitations enable row level security;

create policy organisation_invitations_select_admin
on public.organisation_invitations
for select
to authenticated
using (private.has_org_role(org_id, array['owner', 'admin']));

revoke all on table public.organisation_invitations from public, anon, authenticated;
grant select (
  id, org_id, email, role, invited_by, expires_at, accepted_at, accepted_by,
  revoked_at, revoked_by, created_at, updated_at
) on table public.organisation_invitations to authenticated;

create or replace function private.assert_org_member_manager(
  p_org_id uuid,
  p_allow_admin boolean default true
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text;
begin
  select memberships.role
  into actor_role
  from public.memberships
  join public.organisations on organisations.id = memberships.org_id
  where memberships.org_id = p_org_id
    and memberships.user_id = auth.uid()
    and memberships.status = 'active'
    and organisations.deleted_at is null;

  if actor_role is null
    or (actor_role <> 'owner' and (not p_allow_admin or actor_role <> 'admin'))
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return actor_role;
end;
$$;

create or replace function public.list_organisation_invitations(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.assert_org_member_manager(p_org_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', invitations.id,
      'org_id', invitations.org_id,
      'email', invitations.email::text,
      'role', invitations.role,
      'invited_by', invitations.invited_by,
      'expires_at', invitations.expires_at,
      'accepted_at', invitations.accepted_at,
      'accepted_by', invitations.accepted_by,
      'revoked_at', invitations.revoked_at,
      'revoked_by', invitations.revoked_by,
      'created_at', invitations.created_at,
      'updated_at', invitations.updated_at
    )
    order by invitations.created_at desc, invitations.id desc
  ), '[]'::jsonb)
  into result
  from public.organisation_invitations as invitations
  where invitations.org_id = p_org_id;

  return result;
end;
$$;

create or replace function public.create_organisation_invitation(
  p_org_id uuid,
  p_email text,
  p_role text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  created public.organisation_invitations;
begin
  actor_role := private.assert_org_member_manager(p_org_id);

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid invitation email' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('admin', 'member', 'billing', 'readonly') then
    raise exception 'Invalid invitation role' using errcode = '22023';
  end if;
  if actor_role = 'admin' and p_role = 'admin' then
    raise exception 'Only owners can invite administrators' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation token hash' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Invitation expiry must be in the future' using errcode = '22023';
  end if;
  if exists (
    select 1 from auth.users
    join public.memberships on memberships.user_id = users.id
    where memberships.org_id = p_org_id
      and lower(btrim(users.email)) = normalized_email
  ) then
    raise exception 'This user is already an organisation member' using errcode = '23505';
  end if;

  update public.organisation_invitations
  set revoked_at = now(), revoked_by = actor_id
  where org_id = p_org_id
    and email = normalized_email
    and accepted_at is null
    and revoked_at is null
    and expires_at <= now();

  insert into public.organisation_invitations (
    org_id, email, role, token_hash, invited_by, expires_at
  )
  values (p_org_id, normalized_email, p_role, lower(p_token_hash), actor_id, p_expires_at)
  returning * into created;

  perform private.append_audit_event(
    p_org_id, 'user', actor_id, 'organisation.invitation_created',
    'organisation_invitation', created.id, null, null, null, null,
    jsonb_build_object('email', created.email::text, 'role', created.role, 'expires_at', created.expires_at),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'id', created.id,
    'org_id', created.org_id,
    'email', created.email::text,
    'role', created.role,
    'invited_by', created.invited_by,
    'expires_at', created.expires_at,
    'accepted_at', created.accepted_at,
    'accepted_by', created.accepted_by,
    'revoked_at', created.revoked_at,
    'revoked_by', created.revoked_by,
    'created_at', created.created_at,
    'updated_at', created.updated_at
  );
end;
$$;

create or replace function public.revoke_organisation_invitation(
  p_org_id uuid,
  p_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  changed public.organisation_invitations;
begin
  perform private.assert_org_member_manager(p_org_id);

  update public.organisation_invitations
  set revoked_at = now(), revoked_by = actor_id
  where id = p_invitation_id
    and org_id = p_org_id
    and accepted_at is null
    and revoked_at is null
  returning * into changed;

  if changed.id is null then
    raise exception 'Pending invitation not found' using errcode = 'P0002';
  end if;

  perform private.append_audit_event(
    p_org_id, 'user', actor_id, 'organisation.invitation_revoked',
    'organisation_invitation', changed.id, null, null, null,
    jsonb_build_object('email', changed.email::text, 'role', changed.role),
    jsonb_build_object('revoked_at', changed.revoked_at),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'id', changed.id, 'org_id', changed.org_id, 'email', changed.email::text,
    'role', changed.role, 'invited_by', changed.invited_by,
    'expires_at', changed.expires_at, 'accepted_at', changed.accepted_at,
    'accepted_by', changed.accepted_by, 'revoked_at', changed.revoked_at,
    'revoked_by', changed.revoked_by, 'created_at', changed.created_at,
    'updated_at', changed.updated_at
  );
end;
$$;

create or replace function public.accept_organisation_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  invitation public.organisation_invitations;
  created_membership public.memberships;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation token' using errcode = '22023';
  end if;

  select lower(btrim(users.email))
  into actor_email
  from auth.users as users
  where users.id = actor_id
    and users.email is not null
    and users.email_confirmed_at is not null;

  if actor_email is null then
    raise exception 'A verified authentication email is required' using errcode = '42501';
  end if;

  select *
  into invitation
  from public.organisation_invitations
  where token_hash = lower(p_token_hash)
  for update;

  if invitation.id is null
    or invitation.accepted_at is not null
    or invitation.revoked_at is not null
    or invitation.expires_at <= now()
  then
    raise exception 'Invitation is invalid or expired' using errcode = 'P0002';
  end if;
  if invitation.email::text <> actor_email then
    raise exception 'Invitation email does not match the verified authentication email'
      using errcode = '42501';
  end if;

  insert into public.memberships (org_id, user_id, role, status)
  values (invitation.org_id, actor_id, invitation.role, 'active')
  returning * into created_membership;

  update public.organisation_invitations
  set accepted_at = now(), accepted_by = actor_id
  where id = invitation.id
    and accepted_at is null
    and revoked_at is null;

  perform private.append_audit_event(
    invitation.org_id, 'user', actor_id, 'organisation.invitation_accepted',
    'organisation_invitation', invitation.id, null, null, null,
    jsonb_build_object('email', invitation.email::text, 'role', invitation.role),
    jsonb_build_object('membership_id', created_membership.id),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'organisation_id', invitation.org_id,
    'membership_id', created_membership.id,
    'role', created_membership.role,
    'status', created_membership.status,
    'joined_at', created_membership.joined_at
  );
end;
$$;

create or replace function public.list_organisation_members(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.assert_org_member_manager(p_org_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', memberships.id,
      'org_id', memberships.org_id,
      'user_id', memberships.user_id,
      'display_name', profiles.display_name,
      'email', users.email,
      'role', memberships.role,
      'status', memberships.status,
      'job_title', memberships.job_title,
      'joined_at', memberships.joined_at,
      'suspended_at', memberships.suspended_at,
      'created_at', memberships.created_at,
      'updated_at', memberships.updated_at
    )
    order by
      case memberships.role when 'owner' then 0 when 'admin' then 1 else 2 end,
      lower(profiles.display_name),
      memberships.id
  ), '[]'::jsonb)
  into result
  from public.memberships
  join public.profiles on profiles.id = memberships.user_id
  join auth.users on users.id = memberships.user_id
  where memberships.org_id = p_org_id;

  return result;
end;
$$;

create or replace function public.update_organisation_member(
  p_org_id uuid,
  p_membership_id uuid,
  p_role text default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  before_row public.memberships;
  changed public.memberships;
  member_display_name text;
  member_email text;
begin
  actor_role := private.assert_org_member_manager(p_org_id);

  select * into before_row
  from public.memberships
  where id = p_membership_id and org_id = p_org_id
  for update;

  if before_row.id is null then
    raise exception 'Organisation member not found' using errcode = 'P0002';
  end if;
  if before_row.role = 'owner' then
    raise exception 'Use ownership transfer to change the owner' using errcode = '42501';
  end if;
  if actor_role = 'admin' and before_row.role = 'admin' then
    raise exception 'Admins cannot manage other admins' using errcode = '42501';
  end if;
  if p_role is null and p_status is null then
    raise exception 'Role or status is required' using errcode = '22023';
  end if;
  if p_role is not null and p_role not in ('admin', 'member', 'billing', 'readonly') then
    raise exception 'Invalid member role' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('active', 'suspended') then
    raise exception 'Invalid member status' using errcode = '22023';
  end if;
  if actor_role = 'admin' and p_role = 'admin' then
    raise exception 'Only owners can promote admins' using errcode = '42501';
  end if;
  if before_row.user_id = actor_id and p_status = 'suspended' then
    raise exception 'Members cannot suspend themselves' using errcode = '42501';
  end if;

  update public.memberships
  set
    role = coalesce(p_role, role),
    status = coalesce(p_status, status),
    suspended_at = case
      when coalesce(p_status, status) = 'suspended' then coalesce(suspended_at, now())
      else null
    end
  where id = before_row.id
  returning * into changed;

  select profiles.display_name, users.email
  into member_display_name, member_email
  from public.profiles
  join auth.users on users.id = profiles.id
  where profiles.id = changed.user_id;

  perform private.append_audit_event(
    p_org_id, 'user', actor_id, 'organisation.member_updated',
    'membership', changed.id, null, null, null,
    jsonb_build_object('role', before_row.role, 'status', before_row.status),
    jsonb_build_object('role', changed.role, 'status', changed.status),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'id', changed.id, 'org_id', changed.org_id, 'user_id', changed.user_id,
    'display_name', member_display_name, 'email', member_email,
    'role', changed.role, 'status', changed.status, 'job_title', changed.job_title,
    'joined_at', changed.joined_at, 'suspended_at', changed.suspended_at,
    'created_at', changed.created_at, 'updated_at', changed.updated_at
  );
end;
$$;

create or replace function public.remove_organisation_member(
  p_org_id uuid,
  p_membership_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  target public.memberships;
begin
  actor_role := private.assert_org_member_manager(p_org_id);

  select * into target
  from public.memberships
  where id = p_membership_id and org_id = p_org_id
  for update;

  if target.id is null then
    raise exception 'Organisation member not found' using errcode = 'P0002';
  end if;
  if target.role = 'owner' then
    raise exception 'Transfer ownership before removing the owner' using errcode = '42501';
  end if;
  if actor_role = 'admin' and target.role = 'admin' then
    raise exception 'Admins cannot remove other admins' using errcode = '42501';
  end if;
  if target.user_id = actor_id then
    raise exception 'Members cannot remove themselves' using errcode = '42501';
  end if;

  delete from public.memberships where id = target.id;

  perform private.append_audit_event(
    p_org_id, 'user', actor_id, 'organisation.member_removed',
    'membership', target.id, null, null, null,
    jsonb_build_object('user_id', target.user_id, 'role', target.role, 'status', target.status),
    null, '{}'::jsonb
  );
end;
$$;

create or replace function public.transfer_organisation_ownership(
  p_org_id uuid,
  p_target_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_owner public.memberships;
  target public.memberships;
begin
  perform private.assert_org_member_manager(p_org_id, false);

  select * into current_owner
  from public.memberships
  where org_id = p_org_id and user_id = actor_id and role = 'owner' and status = 'active'
  for update;
  if current_owner.id is null then
    raise exception 'Only the active owner can transfer ownership' using errcode = '42501';
  end if;

  select * into target
  from public.memberships
  where id = p_target_membership_id and org_id = p_org_id
  for update;
  if target.id is null then
    raise exception 'Organisation member not found' using errcode = 'P0002';
  end if;
  if target.id = current_owner.id then
    raise exception 'Target is already the owner' using errcode = '22023';
  end if;
  if target.status <> 'active' then
    raise exception 'Ownership can only transfer to an active member' using errcode = '22023';
  end if;

  update public.memberships set role = 'admin' where id = current_owner.id;
  update public.memberships set role = 'owner' where id = target.id returning * into target;

  perform private.append_audit_event(
    p_org_id, 'user', actor_id, 'organisation.ownership_transferred',
    'organisation', p_org_id, null, null, null,
    jsonb_build_object('owner_membership_id', current_owner.id),
    jsonb_build_object('owner_membership_id', target.id),
    jsonb_build_object('previous_owner_role', 'admin')
  );

  return jsonb_build_object(
    'previous_owner_membership_id', current_owner.id,
    'owner_membership_id', target.id,
    'owner_user_id', target.user_id
  );
end;
$$;

revoke all on function private.assert_org_member_manager(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.list_organisation_invitations(uuid) from public, anon;
revoke all on function public.create_organisation_invitation(uuid, text, text, text, timestamptz)
  from public, anon;
revoke all on function public.revoke_organisation_invitation(uuid, uuid) from public, anon;
revoke all on function public.accept_organisation_invitation(text) from public, anon;
revoke all on function public.list_organisation_members(uuid) from public, anon;
revoke all on function public.update_organisation_member(uuid, uuid, text, text)
  from public, anon;
revoke all on function public.remove_organisation_member(uuid, uuid) from public, anon;
revoke all on function public.transfer_organisation_ownership(uuid, uuid)
  from public, anon;

grant execute on function public.list_organisation_invitations(uuid) to authenticated;
grant execute on function public.create_organisation_invitation(uuid, text, text, text, timestamptz)
  to authenticated;
grant execute on function public.revoke_organisation_invitation(uuid, uuid) to authenticated;
grant execute on function public.accept_organisation_invitation(text) to authenticated;
grant execute on function public.list_organisation_members(uuid) to authenticated;
grant execute on function public.update_organisation_member(uuid, uuid, text, text)
  to authenticated;
grant execute on function public.remove_organisation_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_organisation_ownership(uuid, uuid)
  to authenticated;
