begin;

select plan(19);

select ok(
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'notes'
  ),
  'notes table exists'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.notes'::regclass
  ),
  'notes has RLS enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_note(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated can execute soft_delete_note'
);

select ok(
  not has_table_privilege('authenticated', 'public.notes', 'delete'),
  'authenticated cannot hard-delete notes'
);

create temporary table _notes_fixture (
  alice_id uuid,
  bob_id uuid,
  reader_id uuid,
  org_id uuid,
  alice_membership_id uuid,
  bob_membership_id uuid,
  reader_membership_id uuid,
  note_id uuid
) on commit drop;

grant all on table _notes_fixture to authenticated;

create or replace function pg_temp.make_auth_user(p_email text, p_name text)
returns uuid
language plpgsql
as $$
declare
  created_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    created_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('notes-foundation-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(), now(), '', '', '', ''
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

insert into _notes_fixture (alice_id, bob_id, reader_id)
values (
  pg_temp.make_auth_user('notes-alice@example.test', 'Notes Alice'),
  pg_temp.make_auth_user('notes-bob@example.test', 'Notes Bob'),
  pg_temp.make_auth_user('notes-reader@example.test', 'Notes Reader')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Notes Org',
    'notes-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _notes_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, alice_id, 'member', 'active' from _notes_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, bob_id, 'owner', 'active' from _notes_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, reader_id, 'readonly', 'active' from _notes_fixture;

update _notes_fixture
set
  alice_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _notes_fixture.org_id and m.user_id = _notes_fixture.alice_id
  ),
  bob_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _notes_fixture.org_id and m.user_id = _notes_fixture.bob_id
  ),
  reader_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _notes_fixture.org_id and m.user_id = _notes_fixture.reader_id
  );

-- Alice (member) creates a note for herself.
select pg_temp.as_user((select alice_id from _notes_fixture));
set local role authenticated;

select lives_ok(
  $$
    insert into public.notes (org_id, owner_membership_id, title, body_text, created_by, updated_by)
    select org_id, alice_membership_id, 'Alice private', 'secret body text', alice_id, alice_id
    from _notes_fixture
  $$,
  'member can insert a note owned by their own membership'
);

update _notes_fixture
set note_id = (
  select n.id from public.notes n
  where n.org_id = _notes_fixture.org_id
    and n.owner_membership_id = _notes_fixture.alice_membership_id
);

select throws_ok(
  $$
    insert into public.notes (org_id, owner_membership_id, title, created_by, updated_by)
    select org_id, bob_membership_id, 'Spoofed', alice_id, alice_id
    from _notes_fixture
  $$,
  '42501',
  null,
  'member cannot insert a note owned by another membership'
);

select isnt_empty(
  $$ select id from public.notes where id = (select note_id from _notes_fixture) $$,
  'owner can SELECT own note via RLS'
);

select is(
  (
    select count(*)::integer from public.notes
    where org_id = (select org_id from _notes_fixture)
      and search @@ websearch_to_tsquery('simple', 'secret')
  ),
  1,
  'generated search vector matches body_text'
);

select lives_ok(
  $$
    update public.notes
    set title = 'Alice updated', pinned = true, color = 'blue',
        updated_by = (select alice_id from _notes_fixture)
    where id = (select note_id from _notes_fixture)
  $$,
  'owner can update own note'
);

select is(
  (select version from public.notes where id = (select note_id from _notes_fixture)),
  2,
  'update bumps version via stamp trigger'
);

select throws_ok(
  $$
    update public.notes
    set color = 'neon', updated_by = (select alice_id from _notes_fixture)
    where id = (select note_id from _notes_fixture)
  $$,
  '23514',
  null,
  'color is restricted to the palette'
);

-- Bob (org owner) cannot see or touch Alice's note.
reset role;
select pg_temp.as_user((select bob_id from _notes_fixture));
set local role authenticated;

select is_empty(
  $$ select id from public.notes where id = (select note_id from _notes_fixture) $$,
  'org owner cannot SELECT another member''s note'
);

select lives_ok(
  $$
    update public.notes
    set title = 'Bob was here', updated_by = (select bob_id from _notes_fixture)
    where id = (select note_id from _notes_fixture)
  $$,
  'org owner update of another member''s note is silently filtered by RLS'
);

reset role;
select is(
  (select title from public.notes where id = (select note_id from _notes_fixture)),
  'Alice updated',
  'org owner update of another member''s note changed nothing'
);
select pg_temp.as_user((select bob_id from _notes_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.soft_delete_note(
      (select note_id from _notes_fixture),
      (select org_id from _notes_fixture),
      2
    )
  $$,
  'P0002',
  null,
  'org owner cannot soft-delete another member''s note'
);

-- Readonly cannot write notes.
reset role;
select pg_temp.as_user((select reader_id from _notes_fixture));
set local role authenticated;

select throws_ok(
  $$
    insert into public.notes (org_id, owner_membership_id, title, created_by, updated_by)
    select org_id, reader_membership_id, 'Readonly note', reader_id, reader_id
    from _notes_fixture
  $$,
  '42501',
  null,
  'readonly member cannot insert notes'
);

-- Alice soft-deletes her own note with version check.
reset role;
select pg_temp.as_user((select alice_id from _notes_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.soft_delete_note(
      (select note_id from _notes_fixture),
      (select org_id from _notes_fixture),
      1
    )
  $$,
  'P0001',
  null,
  'soft_delete_note rejects a stale version'
);

select lives_ok(
  $$
    select public.soft_delete_note(
      (select note_id from _notes_fixture),
      (select org_id from _notes_fixture),
      2
    )
  $$,
  'owner can soft-delete own note with the current version'
);

select is_empty(
  $$ select id from public.notes where id = (select note_id from _notes_fixture) $$,
  'soft-deleted note is hidden from its owner'
);

select * from finish();
rollback;
