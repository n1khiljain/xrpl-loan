-- The browser's anon key, and a signed-in Supabase user, can't read or write any table.
begin;
select plan(36);

-- the table list is pinned, so a new table fails here until it's added to the checks below
select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
   join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')),
  array['admin_actions', 'claim_documents', 'claims', 'guarantor_invites', 'ledger_txs', 'notifications', 'once_keys', 'org_officers', 'orgs', 'profiles', 'staff', 'sync_state', 'wallets'],
  'public has exactly the expected tables'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint,
  'every public table has row level security on'
);

select is((select count(*) from pg_policies where schemaname = 'public'), 0::bigint, 'no public table has a policy');

select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')),
  0::bigint,
  'anon and authenticated hold no table privileges'
);

-- a row in every table, so "no rows" can't pass by accident
insert into public.wallets (address, encrypted_seed) values ('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', repeat('x', 40)), ('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', repeat('y', 40));
insert into public.profiles (wallet_address, privy_user_id, email) values ('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'did:privy:claimant', 'claimant@example.test');
insert into public.staff (wallet_address, role) values ('rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh', 'underwriter');
insert into public.orgs (name) values ('Blockchain at Berkeley');
insert into public.org_officers (org_id, wallet_address) select id, 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh' from public.orgs where name = 'Blockchain at Berkeley';
insert into public.claims (id, org_id, recipient_wallet, face_value, requested_amount, callink_pr_number)
select '00000000-0000-0000-0000-000000000001', id, 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 1, 1, 'PR-1' from public.orgs where name = 'Blockchain at Berkeley';
insert into public.claim_documents (claim_id, storage_path, mime_type, size_bytes, uploaded_by)
values ('00000000-0000-0000-0000-000000000001', 'c/1/receipt.pdf', 'application/pdf', 10, 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY');
insert into public.guarantor_invites (claim_id, guarantor_wallet, token_hash, expires_at)
values ('00000000-0000-0000-0000-000000000001', 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', repeat('a', 64), now());
insert into public.ledger_txs (tx_hash, tx_type, account, purpose, result)
values (repeat('A', 64), 'Payment', 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'fund_wallet', 'tesSUCCESS');
insert into public.admin_actions (actor_wallet, action, target) values ('rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh', 'kyc_manual', 'x');
insert into public.notifications (wallet_address, kind, claim_id)
values ('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'claim_funded', '00000000-0000-0000-0000-000000000001');
insert into public.sync_state (key, last_ledger) values ('payments', 1);
insert into public.once_keys (key) values ('simulate-payment:x');
insert into storage.objects (bucket_id, name) values ('receipts', 'c/1/receipt.pdf');

select ok((select not public from storage.buckets where id = 'receipts'), 'the receipts bucket is private');

set local role anon;
select throws_ok('select * from public.admin_actions', '42501', null, 'anon cannot select admin_actions');
select throws_ok('select * from public.claim_documents', '42501', null, 'anon cannot select claim_documents');
select throws_ok('select * from public.claims', '42501', null, 'anon cannot select claims');
select throws_ok('select * from public.guarantor_invites', '42501', null, 'anon cannot select guarantor_invites');
select throws_ok('select * from public.ledger_txs', '42501', null, 'anon cannot select ledger_txs');
select throws_ok('select * from public.notifications', '42501', null, 'anon cannot select notifications');
select throws_ok('select * from public.once_keys', '42501', null, 'anon cannot select once_keys');
select throws_ok('select * from public.org_officers', '42501', null, 'anon cannot select org_officers');
select throws_ok('select * from public.orgs', '42501', null, 'anon cannot select orgs');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot select profiles');
select throws_ok('select * from public.staff', '42501', null, 'anon cannot select staff');
select throws_ok('select * from public.sync_state', '42501', null, 'anon cannot select sync_state');
select throws_ok('select * from public.wallets', '42501', null, 'anon cannot select wallets');
select throws_ok(
  $$insert into public.profiles (wallet_address, privy_user_id) values ('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'x')$$,
  '42501', null, 'anon cannot insert a profile'
);
select throws_ok($$update public.claims set status = 'Settled'$$, '42501', null, 'anon cannot update claims');
select throws_ok('delete from public.staff', '42501', null, 'anon cannot delete staff');
select is((select count(*) from storage.objects where bucket_id = 'receipts'), 0::bigint, 'anon sees no receipt files');

reset role;
set local role authenticated;
select throws_ok('select * from public.admin_actions', '42501', null, 'authenticated cannot select admin_actions');
select throws_ok('select * from public.claim_documents', '42501', null, 'authenticated cannot select claim_documents');
select throws_ok('select * from public.claims', '42501', null, 'authenticated cannot select claims');
select throws_ok('select * from public.guarantor_invites', '42501', null, 'authenticated cannot select guarantor_invites');
select throws_ok('select * from public.ledger_txs', '42501', null, 'authenticated cannot select ledger_txs');
select throws_ok('select * from public.notifications', '42501', null, 'authenticated cannot select notifications');
select throws_ok('select * from public.once_keys', '42501', null, 'authenticated cannot select once_keys');
select throws_ok('select * from public.org_officers', '42501', null, 'authenticated cannot select org_officers');
select throws_ok('select * from public.orgs', '42501', null, 'authenticated cannot select orgs');
select throws_ok('select * from public.profiles', '42501', null, 'authenticated cannot select profiles');
select throws_ok('select * from public.staff', '42501', null, 'authenticated cannot select staff');
select throws_ok('select * from public.sync_state', '42501', null, 'authenticated cannot select sync_state');
select throws_ok('select * from public.wallets', '42501', null, 'authenticated cannot select wallets');
select is(
  (select count(*) from storage.objects where bucket_id = 'receipts'),
  0::bigint,
  'authenticated sees no receipt files'
);

reset role;
select * from finish();
rollback;
