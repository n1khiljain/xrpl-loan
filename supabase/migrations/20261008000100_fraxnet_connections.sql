-- Connect FraxNet (U-77). Members sign in to FraxNet through its OAuth app integration, and the app keeps the
-- refresh token so it can re-check their verification later without asking them to sign in again (FraxNet
-- doesn't remember consent). Tokens never leave the edge functions: RLS is on with no policies and only the
-- service role holds privileges, same as every other table.

-- One row per sign-in attempt, deleted when the callback uses it. Holds the PKCE verifier and nonce so the
-- browser never sees them, and ties the state to the wallet that started the attempt.
create table public.fraxnet_oauth_states (
  state text primary key check (length(state) >= 32),
  wallet_address public.eth_address not null references public.profiles (wallet_address) on delete cascade,
  code_verifier text not null check (length(code_verifier) between 43 and 128),
  nonce text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index fraxnet_oauth_states_wallet on public.fraxnet_oauth_states (wallet_address);

-- The member's FraxNet account. One FraxNet user can back one wallet, so one verified person can't approve
-- several wallets. The org columns mirror GET /org at the last check.
create table public.fraxnet_connections (
  wallet_address public.eth_address primary key references public.profiles (wallet_address) on delete cascade,
  fraxnet_user_id text not null unique,
  org_id text not null,
  org_name text not null,
  org_verified boolean not null,
  org_verified_at timestamptz,
  org_is_business boolean,
  email text,
  scopes text[] not null default '{}',
  -- UNCERTAIN: U-77 (stored as plain text behind RLS and service-role-only grants, like the rest of the data)
  refresh_token text,
  access_token text,
  access_expires_at timestamptz,
  -- set when FraxNet rejects the refresh token, so the member is asked to connect again
  needs_reconnect boolean not null default false,
  connected_at timestamptz not null default now(),
  checked_at timestamptz not null default now()
);

alter table public.fraxnet_oauth_states enable row level security;
alter table public.fraxnet_connections enable row level security;

revoke all on public.fraxnet_oauth_states from anon, authenticated;
revoke all on public.fraxnet_connections from anon, authenticated;
grant all on public.fraxnet_oauth_states to service_role;
grant all on public.fraxnet_connections to service_role;
