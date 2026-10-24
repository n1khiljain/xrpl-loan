-- Keys for things that may happen only once (security campaign E-2c, E-4b): the digest of each FraxNet webhook body
-- already applied, so a captured delivery can't be replayed, and one simulated ASUC payout per claim, so the testnet
-- payout wallet can't be drained by cashing out and asking again. Service role only, like every other table.
create table public.once_keys (
  key text primary key check (length(key) between 1 and 200),
  created_at timestamptz not null default now()
);

alter table public.once_keys enable row level security;
revoke all on public.once_keys from anon, authenticated;
grant all on public.once_keys to service_role;
