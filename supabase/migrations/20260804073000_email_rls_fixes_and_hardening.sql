-- Email RLS fixes + small hardening (code review follow-ups).
--
-- 1. private.current_membership_id was revoked from authenticated, but RLS
--    policy expressions run with the invoking user's privileges, so every
--    direct select on the email surface failed with "permission denied for
--    function". Grant execute (the function only ever returns the caller's
--    own membership id).
-- 2. The email_messages <-> email_message_links select policies subqueried
--    each other, which raises "infinite recursion detected in policy" once
--    the policies are actually executable. Move the cross-table checks into
--    security definer helpers so the policy subqueries bypass RLS.
-- 3. email_message_reads inserts only checked marker ownership, not that the
--    caller can see the message — an existence oracle for other members'
--    private messages. Require message visibility.
-- 4. vendors.bank_details_encrypted is not encrypted by anything and has no
--    API write path; revoke the column write grants until a vault-backed
--    path exists.
-- 5. invoices (org_id, recurring_run_id) FK had no supporting index.

-- ---------------------------------------------------------------------------
-- 1. Make the email RLS surface executable
-- ---------------------------------------------------------------------------

grant execute on function private.current_membership_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Security definer helpers to break policy recursion
-- ---------------------------------------------------------------------------

create or replace function private.message_is_timeline_shared(
  p_message_id uuid,
  p_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.email_message_links l
    where l.message_id = p_message_id
      and l.org_id = p_org_id
      and l.link_reason = 'timeline_share'
  );
$$;

create or replace function private.thread_has_timeline_share(
  p_thread_id uuid,
  p_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.email_messages m
    join public.email_message_links l
      on l.message_id = m.id
     and l.org_id = m.org_id
    where m.thread_id = p_thread_id
      and m.org_id = p_org_id
      and m.deleted_at is null
      and l.link_reason = 'timeline_share'
  );
$$;

create or replace function private.message_owned_by_current_member(
  p_message_id uuid,
  p_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.email_messages m
    where m.id = p_message_id
      and m.org_id = p_org_id
      and m.deleted_at is null
      and m.owner_membership_id = private.current_membership_id(p_org_id)
  );
$$;

-- Owner-or-shared visibility, mirroring email_messages_select_owner_or_share.
create or replace function private.message_visible_to_current_member(
  p_message_id uuid,
  p_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.email_messages m
    where m.id = p_message_id
      and m.org_id = p_org_id
      and m.deleted_at is null
      and (
        m.owner_membership_id = private.current_membership_id(p_org_id)
        or private.message_is_timeline_shared(m.id, m.org_id)
      )
  );
$$;

revoke all on function private.message_is_timeline_shared(uuid, uuid) from public, anon;
revoke all on function private.thread_has_timeline_share(uuid, uuid) from public, anon;
revoke all on function private.message_owned_by_current_member(uuid, uuid) from public, anon;
revoke all on function private.message_visible_to_current_member(uuid, uuid) from public, anon;

grant execute on function private.message_is_timeline_shared(uuid, uuid) to authenticated;
grant execute on function private.thread_has_timeline_share(uuid, uuid) to authenticated;
grant execute on function private.message_owned_by_current_member(uuid, uuid) to authenticated;
grant execute on function private.message_visible_to_current_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recreate the recursive policies on top of the helpers
-- ---------------------------------------------------------------------------

drop policy email_threads_select_owner_or_share on public.email_threads;
create policy email_threads_select_owner_or_share on public.email_threads
for select to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
  and (
    owner_membership_id = private.current_membership_id(org_id)
    or private.thread_has_timeline_share(id, org_id)
  )
);

drop policy email_messages_select_owner_or_share on public.email_messages;
create policy email_messages_select_owner_or_share on public.email_messages
for select to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
  and (
    owner_membership_id = private.current_membership_id(org_id)
    or private.message_is_timeline_shared(id, org_id)
  )
);

drop policy email_message_links_select_owner_or_share on public.email_message_links;
create policy email_message_links_select_owner_or_share on public.email_message_links
for select to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
  and (
    private.message_owned_by_current_member(message_id, org_id)
    or link_reason = 'timeline_share'
  )
);

-- ---------------------------------------------------------------------------
-- 3. Read markers require message visibility (closes the existence oracle)
-- ---------------------------------------------------------------------------

drop policy email_message_reads_insert_own on public.email_message_reads;
create policy email_message_reads_insert_own on public.email_message_reads
for insert to authenticated
with check (
  membership_id = private.current_membership_id(org_id)
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and private.message_visible_to_current_member(message_id, org_id)
);

-- ---------------------------------------------------------------------------
-- 4. Stop plaintext bank-details ingestion (no API path uses this column)
-- ---------------------------------------------------------------------------

revoke insert (bank_details_encrypted) on table public.vendors from authenticated;
revoke update (bank_details_encrypted) on table public.vendors from authenticated;

-- ---------------------------------------------------------------------------
-- 5. Supporting index for invoices_recurring_run_fk
-- ---------------------------------------------------------------------------

create index invoices_org_recurring_run_idx
  on public.invoices (org_id, recurring_run_id)
  where recurring_run_id is not null;
