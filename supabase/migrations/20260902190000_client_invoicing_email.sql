-- Per-client invoicing email for accounts payable / invoice destination reference.

alter table public.clients
  add column if not exists invoicing_email extensions.citext;

comment on column public.clients.invoicing_email is
  'Optional company invoicing email (accounts payable). Not auto-wired to document recipients.';

grant insert (invoicing_email) on table public.clients to authenticated;
grant update (invoicing_email) on table public.clients to authenticated;
