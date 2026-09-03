-- Allow org members to list sibling mailboxes (safe columns only; secret_ref not granted).
-- Required for campaign from-picker (send via any linked personal mailbox in the org).

set search_path = public, extensions, pg_catalog;

create policy mailbox_accounts_select_org_member
on public.mailbox_accounts
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

comment on policy mailbox_accounts_select_org_member on public.mailbox_accounts is
  'Org members may list mailbox metadata for campaign sending; secrets remain vault-only.';
