-- User-backed compose/send paths call read_mailbox_sync_credentials with p_org_id
-- so the caller's membership can be checked. EXECUTE was left service_role-only after
-- the signature change, which blocked those checks entirely.

grant execute on function public.read_mailbox_sync_credentials(uuid, uuid)
  to authenticated;
