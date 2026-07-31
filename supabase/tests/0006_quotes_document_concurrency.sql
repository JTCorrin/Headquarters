-- Two-session interleaving: held get_quote_document (FOR SHARE) must block
-- save_quote_draft (FOR UPDATE), then release a coherent version/line set.
-- Fixtures are committed via dblink so concurrent sessions can see them.

begin;

create extension if not exists dblink with schema extensions;

select plan(6);

select ok(
  exists (select 1 from pg_extension where extname = 'dblink'),
  'dblink is available for executable lock interleaving'
);

create temporary table _cq_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  quote_id uuid,
  quote_version integer,
  expected_version integer,
  conninfo text
) on commit drop;

create temporary table _cq_result (
  reader_sleeped boolean not null default false,
  saver_waited boolean not null default false,
  save_version integer,
  save_description text,
  save_line_count integer,
  error_text text
) on commit drop;

insert into _cq_result default values;

create or replace function pg_temp.cq_conninfo()
returns text
language sql
stable
as $$
  -- Supabase's postgres role is not a superuser. dblink only permits
  -- non-superuser connects when the connstr embeds credentials; use a URI
  -- so libpq/dblink clearly see the password attribute.
  select format(
    'postgresql://postgres:postgres@127.0.0.1:%s/%s',
    current_setting('port'),
    current_database()
  );
$$;

select ok(
  pg_temp.cq_conninfo() like 'postgresql://postgres:postgres@127.0.0.1:%',
  'dblink conninfo embeds TCP password credentials'
);

create or replace function pg_temp.cq_set_auth(p_conn text, p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform dblink_exec(
    p_conn,
    format(
      $sql$
        select set_config('request.jwt.claim.sub', %L, false);
        select set_config('request.jwt.claim.role', 'authenticated', false);
        select set_config(
          'request.jwt.claims',
          %L,
          false
        );
      $sql$,
      p_user_id::text,
      json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text
    )
  );
end;
$$;

do $$
declare
  conn text := pg_temp.cq_conninfo();
  owner_id uuid := gen_random_uuid();
  org_id uuid;
  client_id uuid;
  quote_id uuid;
  quote_version integer;
  created jsonb;
begin
  perform set_config('app.allow_test_dblink', 'on', true);
  perform private.test_dblink_connect('cq_setup', conn);

  perform dblink_exec(
    'cq_setup',
    format(
      $sql$
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
        ) values (
          '00000000-0000-0000-0000-000000000000',
          %L::uuid,
          'authenticated',
          'authenticated',
          'quote-lock-' || %L || '@example.test',
          extensions.crypt('quotes-lock-password', extensions.gen_salt('bf')),
          now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{"display_name":"Quote Lock Owner"}'::jsonb,
          now(),
          now(),
          '',
          '',
          '',
          ''
        );
      $sql$,
      owner_id,
      owner_id::text
    )
  );

  select id into org_id
  from dblink(
    'cq_setup',
    $sql$
      insert into public.organisations (name, slug, country_code, default_currency)
      values (
        'Quote Lock Org',
        'quote-lock-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        'GB',
        'GBP'
      )
      returning id
    $sql$
  ) as t(id uuid);

  perform dblink_exec(
    'cq_setup',
    format(
      $sql$
        insert into public.document_sequences (
          org_id, document_type, prefix, next_number, padding
        ) values (%L::uuid, 'quote', 'Q-', 1, 4)
        on conflict do nothing;

        insert into public.memberships (org_id, user_id, role, status)
        values (%L::uuid, %L::uuid, 'owner', 'active');
      $sql$,
      org_id,
      org_id,
      owner_id
    )
  );

  select id into client_id
  from dblink(
    'cq_setup',
    format(
      $sql$
        insert into public.clients (org_id, name, status)
        values (%L::uuid, 'Lock Client', 'active')
        returning id
      $sql$,
      org_id
    )
  ) as t(id uuid);

  perform pg_temp.cq_set_auth('cq_setup', owner_id);

  select payload into created
  from dblink(
    'cq_setup',
    format(
      $sql$
        select public.create_quote_draft(
          %L::uuid,
          jsonb_build_object(
            'title', 'Lock probe',
            'client_id', %L::uuid,
            'currency', 'GBP'
          ),
          jsonb_build_array(
            jsonb_build_object(
              'description', 'Before save',
              'quantity', 1,
              'unit_price_cents', 100,
              'tax_rate_percent', 0,
              'position', 0
            )
          )
        )
      $sql$,
      org_id,
      client_id
    )
  ) as t(payload jsonb);

  quote_id := (created -> 'quote' ->> 'id')::uuid;
  quote_version := (created -> 'quote' ->> 'version')::integer;

  insert into _cq_fixture (
    owner_id, org_id, client_id, quote_id, quote_version, expected_version, conninfo
  ) values (
    owner_id, org_id, client_id, quote_id, quote_version, quote_version + 1, conn
  );

  perform dblink_disconnect('cq_setup');
end $$;

select ok(
  (select quote_id is not null and quote_version >= 1 from _cq_fixture),
  'committed fixture quote exists for lock interleaving'
);

do $$
declare
  f _cq_fixture%rowtype;
  polls integer;
  reader_sleeping boolean := false;
  saver_waiting boolean := false;
  save_result jsonb;
  send_rc integer;
begin
  select * into f from _cq_fixture;

  perform set_config('app.allow_test_dblink', 'on', true);
  perform private.test_dblink_connect('cq_reader', f.conninfo);
  perform private.test_dblink_connect('cq_saver', f.conninfo);

  perform pg_temp.cq_set_auth('cq_reader', f.owner_id);
  perform pg_temp.cq_set_auth('cq_saver', f.owner_id);

  -- One statement: FOR SHARE is held through pg_sleep.
  send_rc := dblink_send_query(
    'cq_reader',
    format(
      $sql$
        select public.get_quote_document(%L::uuid, %L::uuid), pg_sleep(4)
      $sql$,
      f.quote_id,
      f.org_id
    )
  );
  if send_rc <> 1 then
    update _cq_result
    set error_text = format('reader send failed (%s)', send_rc);
    return;
  end if;

  polls := 0;
  while polls < 40 and not reader_sleeping loop
    perform pg_sleep(0.1);
    select exists (
      select 1
      from pg_stat_activity
      where pid <> pg_backend_pid()
        and query like '%get_quote_document%'
        and wait_event = 'PgSleep'
    ) into reader_sleeping;
    polls := polls + 1;
  end loop;

  update _cq_result set reader_sleeped = reader_sleeping;

  if not reader_sleeping then
    update _cq_result
    set error_text = 'reader never entered pg_sleep while holding FOR SHARE';
    perform dblink_disconnect('cq_reader');
    perform dblink_disconnect('cq_saver');
    return;
  end if;

  send_rc := dblink_send_query(
    'cq_saver',
    format(
      $sql$
        select public.save_quote_draft(
          %L::uuid,
          %L::uuid,
          %s,
          jsonb_build_object('title', 'Lock probe saved'),
          jsonb_build_array(
            jsonb_build_object(
              'description', 'After save',
              'quantity', 2,
              'unit_price_cents', 250,
              'tax_rate_percent', 0,
              'position', 0
            )
          )
        )
      $sql$,
      f.quote_id,
      f.org_id,
      f.quote_version
    )
  );
  if send_rc <> 1 then
    update _cq_result
    set error_text = format('saver send failed (%s)', send_rc);
    perform dblink_disconnect('cq_reader');
    perform dblink_disconnect('cq_saver');
    return;
  end if;

  polls := 0;
  while polls < 40 and not saver_waiting loop
    perform pg_sleep(0.1);
    select exists (
      select 1
      from pg_stat_activity a
      where a.pid <> pg_backend_pid()
        and a.query like '%save_quote_draft%'
        and a.wait_event_type = 'Lock'
    ) into saver_waiting;
    polls := polls + 1;
  end loop;

  update _cq_result set saver_waited = saver_waiting;

  if not saver_waiting then
    update _cq_result
    set error_text = 'save_quote_draft did not block behind held get_quote_document lock';
    perform dblink_cancel_query('cq_reader');
    perform dblink_cancel_query('cq_saver');
    perform dblink_disconnect('cq_reader');
    perform dblink_disconnect('cq_saver');
    return;
  end if;

  -- Drain reader (releases FOR SHARE); saver should then complete.
  perform dblink_get_result('cq_reader');

  polls := 0;
  while polls < 50 and dblink_is_busy('cq_saver') loop
    perform pg_sleep(0.1);
    polls := polls + 1;
  end loop;

  if dblink_is_busy('cq_saver') then
    update _cq_result
    set error_text = 'save_quote_draft still busy after reader released FOR SHARE';
    perform dblink_cancel_query('cq_saver');
    perform dblink_disconnect('cq_reader');
    perform dblink_disconnect('cq_saver');
    return;
  end if;

  select payload into save_result
  from dblink_get_result('cq_saver') as t(payload jsonb);

  update _cq_result
  set
    save_version = (save_result -> 'quote' ->> 'version')::integer,
    save_description = save_result -> 'lines' -> 0 ->> 'description',
    save_line_count = jsonb_array_length(save_result -> 'lines');

  perform dblink_disconnect('cq_reader');
  perform dblink_disconnect('cq_saver');
exception
  when others then
    update _cq_result set error_text = sqlerrm;
    begin
      perform dblink_disconnect('cq_reader');
    exception when others then null;
    end;
    begin
      perform dblink_disconnect('cq_saver');
    exception when others then null;
    end;
end $$;

select ok(
  (
    select reader_sleeped and saver_waited and error_text is null
    from _cq_result
  ),
  coalesce(
    (select 'lock interleave failed: ' || error_text from _cq_result where error_text is not null),
    'held get_quote_document FOR SHARE blocks concurrent save_quote_draft'
  )
);

select is(
  (select save_version from _cq_result),
  (select expected_version from _cq_fixture),
  'after lock release, save returns bumped version with replaced lines'
);

select ok(
  (
    select
      save_description = 'After save'
      and save_line_count = 1
      and exists (
        select 1
        from public.quote_lines
        where quote_id = (select quote_id from _cq_fixture)
          and description = 'After save'
          and quantity = 2
          and unit_price_cents = 250
      )
    from _cq_result
  ),
  'after lock release, persisted lines match the post-save document'
);

-- Cleanup committed dblink fixtures (main transaction rollback will not).
do $$
declare
  f _cq_fixture%rowtype;
begin
  select * into f from _cq_fixture;
  if f.quote_id is null then
    return;
  end if;

  perform set_config('app.allow_test_dblink', 'on', true);
  perform private.test_dblink_connect('cq_cleanup', f.conninfo);
  perform dblink_exec(
    'cq_cleanup',
    format(
      $sql$
        select set_config('app.allow_quote_totals', 'on', true);
        delete from public.quote_lines where quote_id = %L::uuid;
        delete from public.quotes where id = %L::uuid;
        delete from public.clients where id = %L::uuid;
        delete from public.document_sequences where org_id = %L::uuid;
        delete from public.memberships where org_id = %L::uuid;
        delete from public.organisations where id = %L::uuid;
        delete from auth.users where id = %L::uuid;
      $sql$,
      f.quote_id,
      f.quote_id,
      f.client_id,
      f.org_id,
      f.org_id,
      f.org_id,
      f.owner_id
    )
  );
  perform dblink_disconnect('cq_cleanup');
exception
  when others then
    begin
      perform dblink_disconnect('cq_cleanup');
    exception
      when others then null;
    end;
end $$;

select * from finish();
rollback;
