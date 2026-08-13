begin;

select plan(7);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_email_template(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_email_template'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.soft_delete_email_template(uuid, uuid, integer)',
    'execute'
  ),
  'anonymous users cannot execute soft_delete_email_template'
);

create temporary table _tpl_del_fixture (
  owner_id uuid,
  member_id uuid,
  outsider_id uuid,
  org_id uuid,
  template_id uuid,
  template_version integer
) on commit drop;

grant all on table _tpl_del_fixture to authenticated;

create or replace function pg_temp.make_auth_user(p_email text, p_name text)
returns uuid
language plpgsql
as $$
declare
  created_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    created_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt('tpl-del-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );
  return created_id;
end;
$$;

create or replace function pg_temp.as_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated;

insert into _tpl_del_fixture (owner_id, member_id, outsider_id)
values (
  pg_temp.make_auth_user('tpl-del-owner@example.test', 'Tpl Del Owner'),
  pg_temp.make_auth_user('tpl-del-member@example.test', 'Tpl Del Member'),
  pg_temp.make_auth_user('tpl-del-outsider@example.test', 'Tpl Del Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Tpl Del Org',
    'tpl-del-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _tpl_del_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active'
from _tpl_del_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active'
from _tpl_del_fixture;

with created_template as (
  insert into public.email_templates (
    org_id,
    name,
    subject,
    body_text,
    category,
    status,
    created_by,
    updated_by
  )
  select
    org_id,
    'Deletable Template',
    'Subject',
    'Body',
    'other',
    'active',
    owner_id,
    owner_id
  from _tpl_del_fixture
  returning id, version
)
update _tpl_del_fixture
set
  template_id = created_template.id,
  template_version = created_template.version
from created_template;

select pg_temp.as_user((select owner_id from _tpl_del_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_email_template(
      (select template_id from _tpl_del_fixture),
      (select org_id from _tpl_del_fixture),
      (select template_version from _tpl_del_fixture)
    )
  $$,
  'owner can soft-delete an email template via RPC'
);

select is(
  (
    select count(*)::integer
    from public.email_templates
    where id = (select template_id from _tpl_del_fixture)
  ),
  0,
  'soft-deleted email templates are hidden by RLS'
);

reset role;
select is(
  (
    select status
    from public.email_templates
    where id = (select template_id from _tpl_del_fixture)
  ),
  'archived',
  'soft-delete archives the email template'
);

select pg_temp.as_user((select owner_id from _tpl_del_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.soft_delete_email_template(
      (select template_id from _tpl_del_fixture),
      (select org_id from _tpl_del_fixture),
      (select template_version from _tpl_del_fixture)
    )
  $$,
  'P0002',
  null,
  'soft_delete_email_template returns not-found after delete'
);

reset role;
with recreated as (
  insert into public.email_templates (
    org_id,
    name,
    subject,
    body_text,
    category,
    status,
    created_by,
    updated_by
  )
  select
    org_id,
    'Member Denied Template',
    'Subject',
    'Body',
    'other',
    'active',
    owner_id,
    owner_id
  from _tpl_del_fixture
  returning id, version
)
update _tpl_del_fixture
set
  template_id = recreated.id,
  template_version = recreated.version
from recreated;

select pg_temp.as_user((select member_id from _tpl_del_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_email_template(
      (select template_id from _tpl_del_fixture),
      (select org_id from _tpl_del_fixture),
      (select template_version from _tpl_del_fixture)
    )
  $$,
  'members can soft-delete email templates'
);

reset role;

select * from finish();

rollback;
