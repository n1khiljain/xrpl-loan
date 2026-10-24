-- Constraints that back PRD rules.
begin;
select plan(6);

insert into public.profiles (wallet_address, privy_user_id) values ('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 'did:privy:a');
insert into public.orgs (id, name) values (1, 'Blockchain at Berkeley');
insert into public.claims (org_id, recipient_wallet, face_value, requested_amount, callink_pr_number)
values (1, '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 100, 100, 'PR-7');

select throws_ok(
  $$insert into public.claims (org_id, recipient_wallet, face_value, requested_amount, callink_pr_number)
    values (1, '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 100, 100, 'PR-7')$$,
  '23505', null, 'the same CalLink purchase request can''t be sold twice'
);
select throws_ok(
  $$insert into public.claims (org_id, recipient_wallet, face_value, requested_amount, callink_pr_number)
    values (1, '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 100, 101, 'PR-8')$$,
  '23514', null, 'requested amount can''t exceed face value'
);
select throws_ok(
  $$insert into public.claims (org_id, recipient_wallet, guarantor_wallet, face_value, requested_amount, callink_pr_number)
    values (1, '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 1, 1, 'PR-9')$$,
  '23514', null, 'the guarantor can''t be the recipient (U-34)'
);
select throws_ok(
  $$update public.profiles set kyc_status = 'approved', kyc_source = 'manual' where privy_user_id = 'did:privy:a'$$,
  '23514', null, 'a manual KYC change must name the underwriter'
);
select throws_ok(
  $$insert into public.profiles (wallet_address, privy_user_id) values ('0xABC', 'did:privy:b')$$,
  '23514', null, 'addresses must be lowercase 20-byte hex'
);
select throws_ok(
  $$insert into public.notifications (wallet_address, kind, claim_id)
    select '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 'claim_funded'::public.notification_kind, id from public.claims
    union all
    select '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 'claim_funded'::public.notification_kind, id from public.claims$$,
  '23505', null, 'the same email is never recorded twice'
);

select * from finish();
rollback;
