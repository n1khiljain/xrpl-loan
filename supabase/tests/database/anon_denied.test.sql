-- The browser's anon key, and a signed-in Supabase user, can't read or write any table (FR-B1, SYSTEM_DESIGN 5.1).
begin;
select plan(40);

-- the table list is pinned, so a new table fails here until it's added to the checks below
select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
   join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')),
  array['admin_actions', 'claim_documents', 'claims', 'fraxnet_connections', 'fraxnet_oauth_states', 'gas_drips',
        'guarantor_invites', 'notifications', 'once_keys', 'org_officers', 'orgs', 'profiles', 'staff', 'sync_state'],
  'public has exactly the SYSTEM_DESIGN 5.1 tables'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint,
  'every public table has row level security on'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public'),
  0::bigint,
  'no public table has a policy'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')),
  0::bigint,
  'anon and authenticated hold no table privileges'
);

select ok(
  not has_function_privilege('anon', 'public.reserve_gas_drip(public.eth_address, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.reserve_gas_drip(public.eth_address, integer)', 'execute')
  and not has_function_privilege('anon', 'public.invoke_chain_sync()', 'execute'),
  'anon and authenticated cannot call the database functions'
);

-- a row in every table, so "no rows" can't pass by accident
insert into public.profiles (wallet_address, privy_user_id, email)
values ('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 'did:privy:claimant', 'claimant@example.test');
insert into public.staff (wallet_address, role) values ('0x00000000000000000000000000000000000000aa', 'underwriter');
insert into public.orgs (id, name) values (1, 'Blockchain at Berkeley');
insert into public.org_officers (org_id, wallet_address) values (1, '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc');
insert into public.claims (id, org_id, recipient_wallet, face_value, requested_amount, callink_pr_number)
values ('00000000-0000-0000-0000-000000000001', 1, '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 1, 1, 'PR-1');
insert into public.claim_documents (claim_id, storage_path, mime_type, size_bytes, uploaded_by)
values ('00000000-0000-0000-0000-000000000001', 'c/1/receipt.pdf', 'application/pdf', 10,
        '0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
insert into public.guarantor_invites (claim_id, guarantor_wallet, token_hash, expires_at)
values ('00000000-0000-0000-0000-000000000001', '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc', repeat('a', 64), now());
insert into public.gas_drips (wallet_address) values ('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
insert into public.admin_actions (actor_wallet, action, target)
values ('0x00000000000000000000000000000000000000aa', 'kyc_manual', 'x');
insert into public.notifications (wallet_address, kind, claim_id)
values ('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 'claim_funded', '00000000-0000-0000-0000-000000000001');
insert into public.sync_state (key, last_block) values ('chain-sync', 1);
insert into public.once_keys (key) values ('fraxnet-webhook:x');
insert into public.fraxnet_oauth_states (state, wallet_address, code_verifier, nonce, expires_at)
values (repeat('s', 43), '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', repeat('v', 43), 'n', now());
insert into public.fraxnet_connections (wallet_address, fraxnet_user_id, org_id, org_name, org_verified, refresh_token)
values ('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 'usr_1', 'org_1', 'Personal', true, 'secret-refresh');
insert into storage.objects (bucket_id, name) values ('receipts', 'c/1/receipt.pdf');

select ok(
  (select not public from storage.buckets where id = 'receipts'),
  'the receipts bucket is private'
);

set local role anon;
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot select profiles');
select throws_ok('select * from public.staff', '42501', null, 'anon cannot select staff');
select throws_ok('select * from public.orgs', '42501', null, 'anon cannot select orgs');
select throws_ok('select * from public.org_officers', '42501', null, 'anon cannot select org_officers');
select throws_ok('select * from public.claims', '42501', null, 'anon cannot select claims');
select throws_ok('select * from public.claim_documents', '42501', null, 'anon cannot select claim_documents');
select throws_ok('select * from public.guarantor_invites', '42501', null, 'anon cannot select guarantor_invites');
select throws_ok('select * from public.gas_drips', '42501', null, 'anon cannot select gas_drips');
select throws_ok('select * from public.admin_actions', '42501', null, 'anon cannot select admin_actions');
select throws_ok('select * from public.notifications', '42501', null, 'anon cannot select notifications');
select throws_ok('select * from public.sync_state', '42501', null, 'anon cannot select sync_state');
select throws_ok('select * from public.once_keys', '42501', null, 'anon cannot select once_keys');
select throws_ok('select * from public.fraxnet_connections', '42501', null, 'anon cannot select fraxnet_connections');
select throws_ok('select * from public.fraxnet_oauth_states', '42501', null, 'anon cannot select fraxnet_oauth_states');
select throws_ok(
  $$insert into public.profiles (wallet_address, privy_user_id) values ('0x0000000000000000000000000000000000000001', 'x')$$,
  '42501', null, 'anon cannot insert a profile'
);
select throws_ok($$update public.claims set status_cache = 'Settled'$$, '42501', null, 'anon cannot update claims');
select throws_ok('delete from public.staff', '42501', null, 'anon cannot delete staff');
select throws_ok(
  $$select public.reserve_gas_drip('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 86400)$$,
  '42501', null, 'anon cannot reserve a gas drip'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'receipts'),
  0::bigint,
  'anon sees no receipt files'
);

reset role;
set local role authenticated;
select throws_ok('select * from public.profiles', '42501', null, 'authenticated cannot select profiles');
select throws_ok('select * from public.staff', '42501', null, 'authenticated cannot select staff');
select throws_ok('select * from public.orgs', '42501', null, 'authenticated cannot select orgs');
select throws_ok('select * from public.org_officers', '42501', null, 'authenticated cannot select org_officers');
select throws_ok('select * from public.claims', '42501', null, 'authenticated cannot select claims');
select throws_ok('select * from public.claim_documents', '42501', null, 'authenticated cannot select claim_documents');
select throws_ok('select * from public.guarantor_invites', '42501', null, 'authenticated cannot select guarantor_invites');
select throws_ok('select * from public.gas_drips', '42501', null, 'authenticated cannot select gas_drips');
select throws_ok('select * from public.admin_actions', '42501', null, 'authenticated cannot select admin_actions');
select throws_ok('select * from public.notifications', '42501', null, 'authenticated cannot select notifications');
select throws_ok('select * from public.sync_state', '42501', null, 'authenticated cannot select sync_state');
select throws_ok('select * from public.once_keys', '42501', null, 'authenticated cannot select once_keys');
select throws_ok('select * from public.fraxnet_connections', '42501', null, 'authenticated cannot select fraxnet_connections');
select throws_ok('select * from public.fraxnet_oauth_states', '42501', null, 'authenticated cannot select fraxnet_oauth_states');
select is(
  (select count(*) from storage.objects where bucket_id = 'receipts'),
  0::bigint,
  'authenticated sees no receipt files'
);

reset role;
select * from finish();
rollback;
