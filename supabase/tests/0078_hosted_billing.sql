begin;
select no_plan();
create temp table billing_fixture (buyer uuid, member uuid, extra uuid, outsider uuid, subscription_id uuid, org_id uuid);
grant all on billing_fixture to authenticated;
create function pg_temp.billing_user(email text) returns uuid language plpgsql as $$
declare result uuid := gen_random_uuid();
begin
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(result,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
 return result;
end;
$$;
create function pg_temp.billing_as(uid uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',uid::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
end;
$$;
insert into billing_fixture(buyer,member,extra,outsider) values(
 pg_temp.billing_user('billing-buyer@example.test'),pg_temp.billing_user('billing-member@example.test'),
 pg_temp.billing_user('billing-extra@example.test'),pg_temp.billing_user('billing-outsider@example.test'));
select ok(public.hosted_org_access(gen_random_uuid()),'self-host is unrestricted by default');
select public.configure_hosted_billing(true);
select ok(not public.hosted_org_access(gen_random_uuid()),'hosted org without subscription is denied');
select ok(not has_function_privilege('authenticated','public.configure_hosted_billing(boolean)','EXECUTE'),'users cannot turn off enforcement');
select ok(not has_function_privilege('authenticated','public.claim_hosted_subscription(text,uuid,text)','EXECUTE'),'users cannot impersonate another claimant through RPC');
select pg_temp.billing_as(buyer) from billing_fixture;
set local role authenticated;
select throws_ok($q$select public.create_organisation('Unpaid','billing-unpaid','GB')$q$,'42501','Claim an active hosted subscription before creating an organisation','unpaid direct RPC cannot create an org');
reset role;
with inserted as (
 insert into public.hosted_subscriptions(email,status,claim_token_hash,claim_expires_at,stripe_checkout_session_id)
 values('billing-buyer@example.test','active',repeat('a',64),now()+interval '1 day','cs_test_billing') returning id
) update billing_fixture set subscription_id=inserted.id from inserted;
select is((public.claim_hosted_subscription(repeat('a',64),outsider,'wrong@example.test')->>'status')::int,403,'claim checks paid email') from billing_fixture;
select is(public.claim_hosted_subscription(repeat('a',64),buyer,'billing-buyer@example.test')->>'ok','true','buyer claims paid subscription') from billing_fixture;
select is(public.claim_hosted_subscription(repeat('a',64),buyer,'billing-buyer@example.test')->>'ok','true','repeat claim by same buyer is idempotent') from billing_fixture;
select is((public.claim_hosted_subscription(repeat('a',64),outsider,'billing-outsider@example.test')->>'status')::int,409,'different claimant cannot steal used claim') from billing_fixture;
set local role authenticated;
with created as (select public.create_organisation('Paid','billing-paid','GB') as org)
 update billing_fixture set org_id=(created.org).id from created;
select is((select count(*)::int from public.organisations where slug='billing-paid'),1,'paid organisation is visible through RLS');
select throws_ok($q$select public.create_organisation('Second','billing-second','GB')$q$,'42501','Claim an active hosted subscription before creating an organisation','one subscription cannot create a second org');
reset role;
select is(s.org_id,f.org_id,'subscription is atomically bound to organisation') from public.hosted_subscriptions s,billing_fixture f where s.id=f.subscription_id;
select ok(public.hosted_org_access(org_id),'paid organisation is accessible') from billing_fixture;
insert into public.memberships(org_id,user_id,role,status) select org_id,member,'member','active' from billing_fixture;
insert into public.organisation_invitations(org_id,email,role,token_hash,invited_by,expires_at)
 select org_id,'billing-extra@example.test','member',repeat('c',64),buyer,now()+interval '1 day' from billing_fixture;
select throws_ok($q$insert into public.memberships(org_id,user_id,role,status) select org_id,outsider,'member','active' from billing_fixture$q$,'23514','Hosted seat limit reached (three seats, including pending invitations)','pending invitation reserves the last seat');
insert into public.memberships(org_id,user_id,role,status) select org_id,extra,'member','active' from billing_fixture;
update public.organisation_invitations set accepted_at=now(),accepted_by=(select extra from billing_fixture) where token_hash=repeat('c',64);
select is((select count(*)::int from public.memberships where org_id=(select org_id from billing_fixture)),3,'invited person consumes their own reserved seat');
select ok(public.hosted_entitlement_for_user(member) is not null,'included member inherits subscription') from billing_fixture;
select ok(public.hosted_entitlement_for_user(outsider) is null,'outsider has no entitlement') from billing_fixture;
select throws_ok($q$insert into public.memberships(org_id,user_id,role,status) select org_id,outsider,'member','active' from billing_fixture$q$,'23514','Hosted seat limit reached (three seats, including pending invitations)','fourth active seat is denied');
select public.sync_hosted_subscription(subscription_id,'sub_billing','cus_billing','canceled',now(),null,null) from billing_fixture;
select public.sync_hosted_subscription(subscription_id,'sub_billing','cus_billing','active',now()+interval '1 second',null,null) from billing_fixture;
select is(s.status,'canceled','terminal subscription cannot be resurrected by concurrent stale reconciliation') from public.hosted_subscriptions s,billing_fixture f where s.id=f.subscription_id;
select ok(not public.hosted_org_access(org_id),'cancellation revokes organisation access') from billing_fixture;
select ok(public.hosted_entitlement_for_user(member) is null,'cancellation revokes included member entitlement') from billing_fixture;
select pg_temp.billing_as(buyer) from billing_fixture;
set local role authenticated;
select is((select count(*)::int from public.organisations where slug='billing-paid'),0,'RLS hides canceled organisation');
select ok(not private.has_org_role((select org_id from billing_fixture),null),'security-definer role guard denies canceled org');
reset role;
-- Recovery uses a completed checkout reference verified by billing, not an email-only lookup.
insert into public.hosted_subscriptions(email,status,claim_token_hash,claim_expires_at,stripe_checkout_session_id)
 values('billing-outsider@example.test','active',repeat('b',64),now()-interval '1 day','cs_test_expired');
select is((public.claim_hosted_subscription(repeat('b',64),outsider,'billing-outsider@example.test')->>'status')::int,410,'expired public claim requires recovery') from billing_fixture;
select is(public.recover_hosted_subscription('cs_test_expired',outsider,'billing-outsider@example.test')->>'ok','true','authenticated checkout recovery links an expired claim without another purchase') from billing_fixture;
select public.configure_hosted_billing(false);
select ok(public.hosted_org_access(org_id),'self-host mode remains independent of Stripe state') from billing_fixture;
select * from finish();
rollback;
