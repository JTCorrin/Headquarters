-- Product soft-delete via security-definer RPC.
-- Staging curl proof showed authenticated UPDATE ... SET deleted_at = now()
-- fails with 42501 ("This action is not permitted") — same gap as contacts/leads/clients.

create or replace function public.soft_delete_product(
  p_product_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  product_row public.products;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into product_row
  from public.products
  where products.id = p_product_id
    and products.org_id = p_org_id
    and products.deleted_at is null
  for update;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  if product_row.version is distinct from p_expected_version then
    raise exception 'Product version conflict'
      using errcode = 'P0001';
  end if;

  update public.products
  set
    deleted_at = now(),
    updated_by = actor_id
  where products.id = product_row.id;
end;
$$;

revoke all on function public.soft_delete_product(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_product(uuid, uuid, integer)
  to authenticated;
