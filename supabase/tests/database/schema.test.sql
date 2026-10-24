-- Constraints that back product rules.
begin;
select plan(10);

insert into public.wallets (address, encrypted_seed) values ('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', repeat('x', 40));
insert into public.profiles (wallet_address, privy_user_id) values ('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'did:privy:a');
insert into public.orgs (name) values ('Blockchain at Berkeley');
-- an invoice with no org, and an org reimbursement
insert into public.receivables (type, recipient_wallet, payer_name, due_date, face_value, requested_amount, reference)
values ('invoice', 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'Acme Supply Co.', current_date + 30, 100, 100, 'INV-7');
insert into public.receivables (type, org_id, recipient_wallet, payer_name, due_date, face_value, requested_amount, reference)
select 'reimbursement', id, 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'ASUC', current_date + 30, 100, 100, 'PR-7' from public.orgs where name = 'Blockchain at Berkeley';

select throws_ok(
  $$insert into public.receivables (type, recipient_wallet, payer_name, due_date, face_value, requested_amount, reference)
    values ('invoice', 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'Someone else', current_date + 10, 5, 5, 'INV-7')$$,
  '23505', null, 'a seller can''t sell the same reference twice'
);
select throws_ok(
  $$insert into public.receivables (type, recipient_wallet, payer_name, due_date, face_value, requested_amount, reference)
    values ('invoice', 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'Acme Supply Co.', current_date + 30, 100, 101, 'INV-8')$$,
  '23514', null, 'requested amount can''t exceed face value'
);
select throws_ok(
  $$insert into public.receivables (type, org_id, recipient_wallet, guarantor_wallet, payer_name, due_date, face_value, requested_amount, reference)
    select 'reimbursement', id, 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'ASUC', current_date + 30, 1, 1, 'PR-9' from public.orgs where name = 'Blockchain at Berkeley'$$,
  '23514', null, 'the guarantor can''t be the recipient'
);
select throws_ok(
  $$insert into public.receivables (type, recipient_wallet, guarantor_wallet, payer_name, due_date, face_value, requested_amount, reference)
    values ('invoice', 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'Acme Supply Co.', current_date + 30, 1, 1, 'INV-9')$$,
  '23514', null, 'only an org''s receivable can have a guarantor'
);
select throws_ok(
  $$insert into public.receivables (type, recipient_wallet, payer_name, face_value, requested_amount, reference)
    values ('invoice', 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', 'Acme Supply Co.', 1, 1, 'INV-10')$$,
  '23502', null, 'every receivable has a due date'
);
select throws_ok(
  $$update public.receivables set approved_amount = 101$$,
  '23514', null, 'approved amount can''t exceed what was requested'
);
select throws_ok(
  $$update public.receivables set amount_due = 10, amount_paid = 11$$,
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
