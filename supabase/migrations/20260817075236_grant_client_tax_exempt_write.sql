-- clients uses column-level write grants. The tax_exempt API field was added
-- without extending those grants, so otherwise-valid owner inserts hit 42501.
grant insert (tax_exempt) on table public.clients to authenticated;
grant update (tax_exempt) on table public.clients to authenticated;
