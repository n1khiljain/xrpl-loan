-- reserve_gas_drip allows one top-up per wallet per window (FR-B7).
begin;
select plan(5);

select isnt(public.reserve_gas_drip('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 86400), null, 'first reservation succeeds');
select is(public.reserve_gas_drip('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 86400), null, 'second within 24 hours is refused');
select isnt(public.reserve_gas_drip('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc', 86400), null, 'another wallet is unaffected');

update public.gas_drips set created_at = now() - interval '24 hours 1 second'
where wallet_address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
select isnt(public.reserve_gas_drip('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', 86400), null, 'allowed again after 24 hours');

select throws_ok(
  $$select public.reserve_gas_drip('0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 86400)$$,
  '23514', null, 'checksummed addresses are rejected, so one wallet never has two spellings'
);

select * from finish();
rollback;
