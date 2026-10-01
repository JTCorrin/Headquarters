-- Open-source release hardening (schema review):
-- 1. read_mailbox_sync_credentials: the unscoped (p_org_id null) path returned
--    decrypted mailbox credentials for any mailbox id to any authenticated caller.
--    It is now reserved for service_role; the org-scoped user path is unchanged.
-- 2. campaign_mailbox_quota_remaining: JWT callers must belong to the organisation.
-- 3. private helpers still carrying the default PUBLIC EXECUTE are narrowed.
--    Trigger functions need no caller EXECUTE at fire time. Pure helpers invoked
--    from the security-invoker clients_fill_email_domain trigger keep authenticated.
-- 4. api_keys: authenticated SELECT no longer exposes key_hash.
-- 5. Tables created without an explicit `revoke all` drop anon access and the
--    DELETE/TRUNCATE/REFERENCES/TRIGGER privileges legacy default ACLs may grant
--    (TRUNCATE bypasses RLS). No DELETE policies exist on these tables.
-- 6. Indexes for composite tenant FKs used by entity detail lookups and cascades.

-- ---------------------------------------------------------------------------
-- 1. Credential read: unscoped path is service_role only
-- ---------------------------------------------------------------------------

create or replace function public.read_mailbox_sync_credentials(
  p_mailbox_id uuid,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  password text;
  actor_id uuid;
  membership_row public.memberships;
begin
  if p_org_id is null and auth.role() is distinct from 'service_role' then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  -- When called on behalf of a user-backed flow, p_org_id pins the caller's org and
  -- the mailbox must belong to the caller's own membership. Edge-only sync paths
  -- (service role, no JWT) omit p_org_id and get the previous behaviour.
  if p_org_id is not null then
    actor_id := auth.uid();
    if actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;

    select * into membership_row
    from public.memberships
    where memberships.org_id = p_org_id
      and memberships.user_id = actor_id
      and memberships.status = 'active';

    if membership_row.id is null then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
  end if;

  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  if p_org_id is not null
     and mailbox.org_id <> p_org_id
  then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if membership_row.id is not null
     and mailbox.membership_id <> membership_row.id
  then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if mailbox.secret_ref is null then
    return jsonb_build_object(
      'auth_mode', coalesce(mailbox.auth_mode, 'password'),
      'oauth_provider', mailbox.oauth_provider,
      'password', null,
      'token_blob', null,
      'username', mailbox.username,
      'imap_host', mailbox.imap_host,
      'imap_port', mailbox.imap_port,
      'imap_security', mailbox.imap_security,
      'smtp_host', mailbox.smtp_host,
      'smtp_port', mailbox.smtp_port,
      'smtp_security', mailbox.smtp_security,
      'email_address', mailbox.email_address
    );
  end if;

  password := private.read_secret(mailbox.secret_ref);

  if coalesce(mailbox.auth_mode, 'password') = 'oauth' then
    return jsonb_build_object(
      'auth_mode', 'oauth',
      'oauth_provider', mailbox.oauth_provider,
      'password', null,
      'token_blob', password,
      'username', mailbox.username,
      'imap_host', mailbox.imap_host,
      'imap_port', mailbox.imap_port,
      'imap_security', mailbox.imap_security,
      'smtp_host', mailbox.smtp_host,
      'smtp_port', mailbox.smtp_port,
      'smtp_security', mailbox.smtp_security,
      'email_address', mailbox.email_address
    );
  end if;

  return jsonb_build_object(
    'auth_mode', 'password',
    'oauth_provider', null,
    'password', password,
    'token_blob', null,
    'username', mailbox.username,
    'imap_host', mailbox.imap_host,
    'imap_port', mailbox.imap_port,
    'imap_security', mailbox.imap_security,
    'smtp_host', mailbox.smtp_host,
    'smtp_port', mailbox.smtp_port,
    'smtp_security', mailbox.smtp_security,
    'email_address', mailbox.email_address
  );
end;
$$;

revoke all on function public.read_mailbox_sync_credentials(uuid, uuid)
  from public, anon;
grant execute on function public.read_mailbox_sync_credentials(uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Campaign quota read: membership check for JWT callers
-- ---------------------------------------------------------------------------

create or replace function public.campaign_mailbox_quota_remaining(
  p_org_id uuid,
  p_mailbox_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  used integer := 0;
  lim integer;
begin
  if auth.uid() is not null and not private.has_org_role(p_org_id) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  lim := private.email_send_quota_limit();
  select coalesce(q.sent_count, 0)
  into used
  from public.email_send_quota_usage q
  where q.org_id = p_org_id
    and q.mailbox_account_id = p_mailbox_id
    and q.usage_date = (timezone('utc', now()))::date;

  return greatest(0, lim - coalesce(used, 0));
end;
$$;

revoke all on function public.campaign_mailbox_quota_remaining(uuid, uuid)
  from public, anon;
grant execute on function public.campaign_mailbox_quota_remaining(uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Private helpers: drop default PUBLIC EXECUTE
-- ---------------------------------------------------------------------------

-- Trigger functions.
revoke all on function private.clients_fill_email_domain() from public, anon, authenticated;
revoke all on function private.email_message_playbook_dispatch() from public, anon, authenticated;
revoke all on function private.log_campaign_status() from public, anon, authenticated;
revoke all on function private.meetings_related_timeline_writer() from public, anon, authenticated;
revoke all on function private.relink_client_email_after_change() from public, anon, authenticated;
revoke all on function private.relink_contact_email_after_change() from public, anon, authenticated;
revoke all on function private.validate_project_client() from public, anon, authenticated;

-- Security definer helpers without caller checks; only reached from other definer RPCs.
revoke all on function private.apply_payment_allocations(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function private.payment_document(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.recompute_payment_allocation_status(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.recompute_invoice_payment_state(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.recompute_bill_payment_state(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.quote_recipient_contact_ids(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.invoice_recipient_contact_ids(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.quote_recipients_json(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.invoice_recipients_json(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.schedule_recipients_json(uuid, uuid)
  from public, anon, authenticated;

-- Pure helpers; clients_fill_email_domain runs as the writing role and calls these.
revoke all on function private.email_address_host(text) from public, anon;
revoke all on function private.is_public_email_domain(text) from public, anon;
revoke all on function private.website_host(text) from public, anon;
revoke all on function private.derive_email_domain(text, text) from public, anon;
revoke all on function private.message_participant_emails(text, jsonb, jsonb) from public, anon;
revoke all on function private.email_send_quota_limit() from public, anon;

grant execute on function private.email_address_host(text) to authenticated, service_role;
grant execute on function private.is_public_email_domain(text) to authenticated, service_role;
grant execute on function private.website_host(text) to authenticated, service_role;
grant execute on function private.derive_email_domain(text, text) to authenticated, service_role;
grant execute on function private.message_participant_emails(text, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function private.email_send_quota_limit() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. api_keys: hide key_hash from authenticated
-- ---------------------------------------------------------------------------

-- Column-level revokes do not narrow a table-level grant; replace it.
revoke select on table public.api_keys from authenticated;
grant select (
  id,
  org_id,
  created_at,
  updated_at,
  created_by,
  updated_by,
  deleted_at,
  version,
  name,
  prefix,
  role,
  scopes,
  expires_at,
  last_used_at,
  revoked_at
) on table public.api_keys to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Table privileges for tables created without an explicit revoke
-- ---------------------------------------------------------------------------

revoke all on table
  public.tasks,
  public.meetings,
  public.meeting_attendees,
  public.meeting_transcripts,
  public.meeting_task_proposals,
  public.projects,
  public.project_columns,
  public.project_cards,
  public.notes
from public, anon;

revoke delete, truncate, references, trigger on table
  public.tasks,
  public.meetings,
  public.meeting_attendees,
  public.meeting_transcripts,
  public.meeting_task_proposals,
  public.projects,
  public.project_columns,
  public.project_cards,
  public.notes
from authenticated;

-- ---------------------------------------------------------------------------
-- 6. Indexes on composite tenant FKs
-- ---------------------------------------------------------------------------

create index if not exists invoices_org_client_idx
  on public.invoices (org_id, client_id)
  where client_id is not null;

create index if not exists invoices_org_contact_idx
  on public.invoices (org_id, contact_id)
  where contact_id is not null;

create index if not exists quotes_org_client_idx
  on public.quotes (org_id, client_id)
  where client_id is not null;

create index if not exists quotes_org_lead_idx
  on public.quotes (org_id, lead_id)
  where lead_id is not null;

create index if not exists quotes_org_contact_idx
  on public.quotes (org_id, contact_id)
  where contact_id is not null;

create index if not exists leads_org_client_idx
  on public.leads (org_id, client_id)
  where client_id is not null;

create index if not exists leads_org_contact_idx
  on public.leads (org_id, contact_id)
  where contact_id is not null;

create index if not exists meeting_attendees_org_contact_idx
  on public.meeting_attendees (org_id, contact_id)
  where contact_id is not null;

create index if not exists email_message_reads_org_membership_idx
  on public.email_message_reads (org_id, membership_id);

create index if not exists email_messages_org_in_reply_to_idx
  on public.email_messages (org_id, in_reply_to_message_id)
  where in_reply_to_message_id is not null;

create index if not exists ai_suggestions_org_source_message_idx
  on public.ai_suggestions (org_id, source_email_message_id)
  where source_email_message_id is not null;

create index if not exists document_links_org_folder_idx
  on public.document_links (org_id, folder_id)
  where folder_id is not null;

create index if not exists document_folders_org_parent_idx
  on public.document_folders (org_id, parent_id)
  where parent_id is not null;
