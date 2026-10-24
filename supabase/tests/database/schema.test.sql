-- Constraints that back product rules.
begin;
select plan(8);

insert into public.wallets (address, encrypted_seed) values ('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', repeat('x', 40));
insert into public.profiles (wallet_address, privy_user_id) values ('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'did:privy:a');
insert into public.orgs (name) values ('Blockchain at Berkeley');
insert into public.claims (org_id, recipient_wallet, face_value, requested_amount, callink_pr_number)
select id, 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 100, 100, 'PR-7' from public.orgs where name = 'Blockchain at Berkeley';

select throws_ok(
  $$insert into public.claims (org_id, recipient_wallet, face_value, requested_amount, callink_pr_number)
    select id, 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 100, 100, 'PR-7' from public.orgs where name = 'Blockchain at Berkeley'$$,
  '23505', null, 'the same CalLink purchase request can''t be sold twice'
);
select throws_ok(
  $$insert into public.claims (org_id, recipient_wallet, face_value, requested_amount, callink_pr_number)
    select id, 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 100, 101, 'PR-8' from public.orgs where name = 'Blockchain at Berkeley'$$,
  '23514', null, 'requested amount can''t exceed face value'
);
select throws_ok(
  $$insert into public.claims (org_id, recipient_wallet, guarantor_wallet, face_value, requested_amount, callink_pr_number)
    select id, 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 1, 1, 'PR-9' from public.orgs where name = 'Blockchain at Berkeley'$$,
  '23514', null, 'the guarantor can''t be the recipient'
);
select throws_ok(
  $$update public.claims set approved_amount = 101$$,
  '23514', null, 'approved amount can''t exceed what was requested'
);
select throws_ok(
  $$update public.claims set amount_due = 10, amount_paid = 11$$,
  '23514', null, 'nothing is paid beyond what''s due'
);
select throws_ok(
  $$update public.profiles set kyc_status = 'approved', kyc_source = 'manual' where privy_user_id = 'did:privy:a'$$,
  '23514', null, 'a manual KYC change must name the staff member'
);
select throws_ok(
  $$insert into public.wallets (address, encrypted_seed) values ('not-an-address', repeat('x', 40))$$,
  '23514', null, 'addresses must be classic XRPL addresses'
);
select throws_ok(
  $$insert into public.profiles (wallet_address, privy_user_id) values ('rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh', 'did:privy:b')$$,
  '23503', null, 'a profile needs a custodial wallet'
);

select * from finish();
rollback;
