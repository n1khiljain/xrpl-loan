-- Rolling vault series and missed payments. Each loan records which series (vault and loan broker) funded it,
-- and when staff marked it impaired (a missed payment) or defaulted on the ledger with LoanManage.
alter table public.receivables
  add column vault_id text check (vault_id is null or vault_id ~ '^[0-9A-F]{64}$'),
  add column loan_broker_id text check (loan_broker_id is null or loan_broker_id ~ '^[0-9A-F]{64}$'),
  add column impaired_at timestamptz,
  add column defaulted_at timestamptz,
  add constraint loan_series_complete check ((vault_id is null) = (loan_broker_id is null));
create index receivables_vault on public.receivables (vault_id) where vault_id is not null;
