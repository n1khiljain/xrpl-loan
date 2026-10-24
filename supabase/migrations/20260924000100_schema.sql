-- Offchain state for college org financing (SYSTEM_DESIGN 5.1). Money and claim state live onchain; these tables
-- hold profiles, drafts, documents, KYC mirrors, and caches. The browser never reads them directly: every table
-- has row level security on with no policies, and anon and authenticated hold no privileges (FR-B1). Edge
-- functions use the service role after checking the caller's Privy token.

create type public.kyc_status as enum ('not_started', 'pending', 'approved', 'rejected');
create type public.kyc_source as enum ('fraxnet_api', 'manual');
create type public.staff_role as enum ('underwriter', 'attester', 'admin');
create type public.recipient_type as enum ('member', 'org_treasurer');
create type public.asuc_outcome as enum ('none', 'rejected', 'short_paid');
create type public.claim_status as enum (
  'Draft', 'Submitted', 'Approved', 'Funded', 'GuarantorCalled', 'Settled', 'Recovered', 'WrittenOff', 'Rejected',
  'Cancelled'
);
create type public.notification_kind as enum (
  'guaranty_requested', 'claim_approved', 'claim_funded', 'due_soon', 'guarantor_called'
);

-- addresses are stored lowercase; amounts are frxUSD wei
create domain public.eth_address as text check (value ~ '^0x[0-9a-f]{40}$');
create domain public.bytes32 as text check (value ~ '^0x[0-9a-f]{64}$');
create domain public.wei as numeric(78, 0) check (value >= 0);

create table public.profiles (
  wallet_address public.eth_address primary key,
  privy_user_id text not null unique,
  -- UNCERTAIN: U-56 (self-reported, used only for notifications)
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text check (display_name is null or length(display_name) <= 80),
  kyc_status public.kyc_status not null default 'not_started',
  kyc_source public.kyc_source,
  -- the underwriter's wallet for a manual change; null when the status came from FraxNet
  kyc_updated_by public.eth_address,
  kyc_updated_at timestamptz,
  -- UNCERTAIN: U-37
  fraxnet_account_ref text,
  liquidation_address public.eth_address,
  created_at timestamptz not null default now(),
  constraint kyc_source_set check (kyc_status = 'not_started' or kyc_source is not null),
  constraint manual_has_actor check (kyc_source is distinct from 'manual' or kyc_updated_by is not null)
);

create table public.staff (
  wallet_address public.eth_address primary key,
  role public.staff_role not null,
  created_at timestamptz not null default now()
);

-- mirrors OrgRegistry; written only by chain-sync
create table public.orgs (
  id bigint primary key check (id > 0),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- mirrors OfficerSet; written only by chain-sync
create table public.org_officers (
  org_id bigint not null references public.orgs (id),
  wallet_address public.eth_address not null,
  title text,
  active boolean not null default true,
  primary key (org_id, wallet_address)
);
create index org_officers_wallet on public.org_officers (wallet_address) where active;

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  onchain_claim_id bigint unique check (onchain_claim_id > 0),
  org_id bigint not null references public.orgs (id),
  recipient_wallet public.eth_address not null references public.profiles (wallet_address),
  recipient_type public.recipient_type not null default 'member',
  face_value public.wei not null check (face_value > 0),
  requested_amount public.wei not null check (requested_amount > 0),
  callink_pr_number text not null check (length(callink_pr_number) between 1 and 64),
  description text check (description is null or length(description) <= 2000),
  -- set once by the packet function; the draft can't be edited after that
  packet_json jsonb,
  packet_hash public.bytes32 unique,
  guarantor_wallet public.eth_address,
  guaranty_signature text check (guaranty_signature is null or guaranty_signature ~ '^0x[0-9a-f]+$'),
  guaranty_nonce numeric(78, 0),
  -- unix seconds, as passed to submitClaim
  guaranty_deadline bigint,
  status_cache public.claim_status not null default 'Draft',
  asuc_outcome public.asuc_outcome not null default 'none',
  asuc_outcome_note text check (asuc_outcome_note is null or length(asuc_outcome_note) <= 2000),
  asuc_outcome_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one sale per CalLink purchase request
  unique (org_id, callink_pr_number),
  constraint requested_within_face check (requested_amount <= face_value),
  constraint guarantor_not_recipient check (guarantor_wallet is distinct from recipient_wallet),
  constraint packet_complete check ((packet_json is null) = (packet_hash is null)),
  constraint guaranty_complete check (
    (guaranty_signature is null) = (guaranty_nonce is null) and (guaranty_signature is null) = (guaranty_deadline is null)
  )
);
create index claims_recipient on public.claims (recipient_wallet);
create index claims_guarantor on public.claims (guarantor_wallet);
create index claims_reported on public.claims (asuc_outcome) where asuc_outcome <> 'none';

create table public.claim_documents (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  storage_path text not null unique,
  -- null until the upload is confirmed and hashed
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by public.eth_address not null,
  created_at timestamptz not null default now()
);
create index claim_documents_claim on public.claim_documents (claim_id);

create table public.guarantor_invites (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  guarantor_wallet public.eth_address not null,
  -- sha256 of the random token in the link; the token itself is never stored
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index guarantor_invites_claim on public.guarantor_invites (claim_id);

create table public.gas_drips (
  id bigint generated always as identity primary key,
  wallet_address public.eth_address not null,
  amount_wei public.wei not null default 0,
  -- null while the top-up is reserved but not sent, or when the mock sponsor sent nothing
  tx_hash public.bytes32,
  created_at timestamptz not null default now()
);
create index gas_drips_wallet_time on public.gas_drips (wallet_address, created_at desc);

create table public.admin_actions (
  id bigint generated always as identity primary key,
  actor_wallet public.eth_address not null,
  action text not null,
  target text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_actions_target on public.admin_actions (target, created_at desc);

create table public.notifications (
  id bigint generated always as identity primary key,
  wallet_address public.eth_address not null,
  kind public.notification_kind not null,
  claim_id uuid not null references public.claims (id) on delete cascade,
  sent_at timestamptz not null default now(),
  unique (wallet_address, kind, claim_id)
);

create table public.sync_state (
  key text primary key,
  last_block bigint not null check (last_block >= 0),
  updated_at timestamptz not null default now()
);

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger claims_touch before update on public.claims
for each row execute function public.touch_updated_at();

-- Holds one gas top-up for a wallet (FR-B7). The advisory lock makes the check and the insert atomic, so two
-- requests at the same moment can't both pass the daily limit. Returns null when the wallet already has a top-up
-- newer than the window.
create function public.reserve_gas_drip(p_wallet public.eth_address, p_window_seconds integer)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  reservation bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('gas_drip:' || p_wallet, 0));
  if exists (
    select 1 from public.gas_drips
    where wallet_address = p_wallet and created_at > now() - make_interval(secs => p_window_seconds)
  ) then
    return null;
  end if;
  insert into public.gas_drips (wallet_address) values (p_wallet) returning id into reservation;
  return reservation;
end;
$$;

-- deny by default: RLS on, no policies
alter table public.profiles enable row level security;
alter table public.staff enable row level security;
alter table public.orgs enable row level security;
alter table public.org_officers enable row level security;
alter table public.claims enable row level security;
alter table public.claim_documents enable row level security;
alter table public.guarantor_invites enable row level security;
alter table public.gas_drips enable row level security;
alter table public.admin_actions enable row level security;
alter table public.notifications enable row level security;
alter table public.sync_state enable row level security;

-- and no privileges either, so a mistaken policy later still can't open a table to the browser
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.reserve_gas_drip(public.eth_address, integer) to service_role;
