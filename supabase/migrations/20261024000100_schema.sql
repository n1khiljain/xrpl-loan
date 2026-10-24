-- Offchain state for receivables financing on the XRP Ledger. A receivable is money someone is owed by a payer (a card
-- settlement, a reimbursement, an invoice); its seller gets paid now from the lending vault. Postgres holds profiles,
-- drafts, documents, KYC, and each receivable's lifecycle; money moves on XRPL and every transaction hash is kept in ledger_txs. The browser never
-- reads these tables: row level security is on with no policies, and anon and authenticated hold no privileges.
-- Edge functions use the service role after checking the caller's Privy token.

create type public.kyc_status as enum ('not_started', 'pending', 'approved', 'rejected');
create type public.kyc_source as enum ('manual');
create type public.staff_role as enum ('underwriter', 'attester', 'admin');
create type public.receivable_type as enum ('card_settlement', 'reimbursement', 'invoice', 'other');
create type public.payer_outcome as enum ('none', 'rejected', 'short_paid');
create type public.call_reason as enum ('none', 'payer_rejected', 'partial_shortfall', 'overdue');
create type public.receivable_status as enum (
  'Draft', 'Submitted', 'Approved', 'Funded', 'GuarantorCalled', 'Settled', 'Recovered', 'WrittenOff', 'Rejected',
  'Cancelled'
);
create type public.notification_kind as enum (
  'guaranty_requested', 'receivable_approved', 'receivable_funded', 'due_soon', 'guarantor_called'
);

-- classic XRPL addresses; amounts are integer base units of the loan asset (6 decimals)
create domain public.xrpl_address as text check (value ~ '^r[1-9A-HJ-NP-Za-km-z]{24,34}$');
create domain public.sha256_hex as text check (value ~ '^[0-9a-f]{64}$');
create domain public.units as numeric(38, 0) check (value >= 0);

-- The custodial wallet the app holds for each person. The seed is AES-GCM encrypted with WALLET_ENCRYPTION_KEY,
-- which only the edge functions know; this table never sees a plaintext seed.
create table public.wallets (
  address public.xrpl_address primary key,
  encrypted_seed text not null check (length(encrypted_seed) between 20 and 400),
  funded_tx text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  wallet_address public.xrpl_address primary key references public.wallets (address),
  privy_user_id text not null unique,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- set from a Privy identity token: the email was proven by code or Google sign-in
  email_verified boolean not null default false,
  display_name text check (display_name is null or length(display_name) <= 80),
  kyc_status public.kyc_status not null default 'not_started',
  kyc_source public.kyc_source,
  -- the staff wallet behind a manual change
  kyc_updated_by public.xrpl_address,
  kyc_updated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint kyc_source_set check (kyc_status in ('not_started', 'pending') or kyc_source is not null),
  constraint manual_has_actor check (kyc_source is distinct from 'manual' or kyc_updated_by is not null)
);

create table public.staff (
  wallet_address public.xrpl_address primary key,
  role public.staff_role not null,
  created_at timestamptz not null default now()
);

create table public.orgs (
  id bigint generated always as identity primary key,
  name text not null unique check (length(name) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.org_officers (
  org_id bigint not null references public.orgs (id),
  wallet_address public.xrpl_address not null,
  title text check (title is null or length(title) <= 80),
  active boolean not null default true,
  primary key (org_id, wallet_address)
);
create index org_officers_wallet on public.org_officers (wallet_address) where active;

create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  -- the short number on the receivable card
  number bigint generated always as identity unique,
  type public.receivable_type not null,
  recipient_wallet public.xrpl_address not null references public.profiles (wallet_address),
  -- who owes the money: a card processor, ASUC, a customer
  payer_name text not null check (length(payer_name) between 1 and 120),
  payer_email text check (payer_email is null or payer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- the payer's XRPL account, when they have one: underwriting reads its history, repayment watches it
  payer_wallet public.xrpl_address,
  -- when the payer is expected to pay; the loan's term runs to here
  due_date date not null,
  -- only for an org's receivables (a club reimbursement): the org, and its officer as guarantor
  org_id bigint references public.orgs (id),
  face_value public.units not null check (face_value > 0),
  requested_amount public.units not null check (requested_amount > 0),
  -- the payer's own reference: invoice number, settlement batch, purchase request
  reference text not null check (length(reference) between 1 and 64),
  description text check (description is null or length(description) <= 2000),
  -- set once by the packet function; the draft can't be edited after that
  packet_json jsonb,
  packet_hash public.sha256_hex unique,
  guarantor_wallet public.xrpl_address,
  guaranty_signed_at timestamptz,
  status public.receivable_status not null default 'Draft',
  submitted_at timestamptz,
  approved_amount public.units not null default 0,
  approved_by public.xrpl_address,
  approval_expires_at timestamptz,
  reject_reason text check (reject_reason is null or length(reject_reason) <= 200),
  fee_bps integer not null default 0 check (fee_bps between 0 and 10000),
  purchase_price public.units not null default 0,
  amount_due public.units not null default 0,
  amount_paid public.units not null default 0,
  purchased_at timestamptz,
  due_at timestamptz,
  -- the XRPL Loan ledger object that funded this receivable
  loan_id text check (loan_id is null or loan_id ~ '^[0-9A-F]{64}$'),
  call_reason public.call_reason not null default 'none',
  guarantor_called_at timestamptz,
  write_off_eligible_at timestamptz,
  principal_written_off boolean not null default false,
  written_off_principal public.units not null default 0,
  payer_outcome public.payer_outcome not null default 'none',
  payer_outcome_note text check (payer_outcome_note is null or length(payer_outcome_note) <= 2000),
  payer_outcome_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one sale per payer reference for each seller
  unique (recipient_wallet, reference),
  constraint guarantor_needs_org check (guarantor_wallet is null or org_id is not null),
  constraint requested_within_face check (requested_amount <= face_value),
  constraint approved_within_requested check (approved_amount <= requested_amount),
  constraint guarantor_not_recipient check (guarantor_wallet is distinct from recipient_wallet),
  constraint packet_complete check ((packet_json is null) = (packet_hash is null)),
  constraint paid_within_due check (amount_paid <= amount_due)
);
create index receivables_recipient on public.receivables (recipient_wallet);
create index receivables_guarantor on public.receivables (guarantor_wallet);
create index receivables_status on public.receivables (status);
create index receivables_reported on public.receivables (payer_outcome) where payer_outcome <> 'none';
create index receivables_payer_wallet on public.receivables (payer_wallet) where payer_wallet is not null;

create table public.receivable_documents (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables (id) on delete cascade,
  storage_path text not null unique,
  -- null until the upload is confirmed and hashed
  sha256 public.sha256_hex,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by public.xrpl_address not null,
  created_at timestamptz not null default now()
);
create index receivable_documents_receivable on public.receivable_documents (receivable_id);

create table public.guarantor_invites (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables (id) on delete cascade,
  guarantor_wallet public.xrpl_address not null,
  -- sha256 of the random token in the link; the token itself is never stored
  token_hash public.sha256_hex not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index guarantor_invites_receivable on public.guarantor_invites (receivable_id);

-- Every XRPL transaction the app submitted or saw for a receivable or account, for explorer links and the audit trail.
create table public.ledger_txs (
  id bigint generated always as identity primary key,
  tx_hash text not null unique check (tx_hash ~ '^[0-9A-F]{64}$'),
  tx_type text not null check (length(tx_type) between 1 and 64),
  account public.xrpl_address not null,
  receivable_id uuid references public.receivables (id) on delete set null,
  -- what the app was doing, e.g. 'fund_wallet', 'loan_set'
  purpose text not null check (length(purpose) between 1 and 64),
  result text not null check (length(result) between 1 and 64),
  created_at timestamptz not null default now()
);
create index ledger_txs_receivable on public.ledger_txs (receivable_id, created_at);
create index ledger_txs_account on public.ledger_txs (account, created_at desc);

create table public.admin_actions (
  id bigint generated always as identity primary key,
  actor_wallet public.xrpl_address not null,
  action text not null,
  target text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_actions_target on public.admin_actions (target, created_at desc);

create table public.notifications (
  id bigint generated always as identity primary key,
  wallet_address public.xrpl_address not null,
  kind public.notification_kind not null,
  receivable_id uuid not null references public.receivables (id) on delete cascade,
  sent_at timestamptz not null default now(),
  unique (wallet_address, kind, receivable_id)
);

-- Keys for things that may happen only once, such as one simulated payer payment per receivable.
create table public.once_keys (
  key text primary key check (length(key) between 1 and 200),
  created_at timestamptz not null default now()
);

-- Cursors for ledger listeners, e.g. the last validated ledger a payment watcher read.
create table public.sync_state (
  key text primary key,
  last_ledger bigint not null check (last_ledger >= 0),
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

create trigger receivables_touch before update on public.receivables
for each row execute function public.touch_updated_at();

-- deny by default: RLS on, no policies
alter table public.wallets enable row level security;
alter table public.profiles enable row level security;
alter table public.staff enable row level security;
alter table public.orgs enable row level security;
alter table public.org_officers enable row level security;
alter table public.receivables enable row level security;
alter table public.receivable_documents enable row level security;
alter table public.guarantor_invites enable row level security;
alter table public.ledger_txs enable row level security;
alter table public.admin_actions enable row level security;
alter table public.notifications enable row level security;
alter table public.once_keys enable row level security;
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
