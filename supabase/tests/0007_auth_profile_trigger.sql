begin;

select plan(3);

select has_function(
  'public',
  'handle_new_user',
  'handle_new_user trigger function exists'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
  ),
  'on_auth_user_created fires after insert on auth.users'
);

-- Inserting an Auth user must create the matching public.profiles row
-- (email/password signup path for local/staging with confirmations off).
do $$
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
    'auth-trigger-proof@example.test',
    extensions.crypt('auth-trigger-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', 'Auth Trigger Proof'),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  perform set_config('test.auth_trigger_user_id', created_id::text, true);
end;
$$;

select is(
  (
    select display_name
    from public.profiles
    where id = current_setting('test.auth_trigger_user_id')::uuid
  ),
  'Auth Trigger Proof',
  'handle_new_user inserts profiles.display_name from raw_user_meta_data'
);

select * from finish();

rollback;
