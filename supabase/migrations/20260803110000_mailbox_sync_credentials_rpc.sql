-- Service-role-only credential read for mailbox IMAP sync.
-- Edge sync must decrypt via private.read_secret; never grant to authenticated.

create or replace function public.read_mailbox_sync_credentials(p_mailbox_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  password text;
begin
  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  if mailbox.secret_ref is null then
    return jsonb_build_object(
      'password', null,
      'username', mailbox.username,
      'imap_host', mailbox.imap_host,
      'imap_port', mailbox.imap_port,
      'imap_security', mailbox.imap_security,
      'email_address', mailbox.email_address
    );
  end if;

  password := private.read_secret(mailbox.secret_ref);

  return jsonb_build_object(
    'password', password,
    'username', mailbox.username,
    'imap_host', mailbox.imap_host,
    'imap_port', mailbox.imap_port,
    'imap_security', mailbox.imap_security,
    'email_address', mailbox.email_address
  );
end;
$$;

revoke all on function public.read_mailbox_sync_credentials(uuid)
  from public, anon, authenticated;
grant execute on function public.read_mailbox_sync_credentials(uuid)
  to service_role;
