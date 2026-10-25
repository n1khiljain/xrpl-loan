-- A person belongs to one organization. The organization has a short id teammates type to join.
-- Expedited payments wait on a finance agent in that organization before an admin can approve them.
-- Banking details are not stored yet.

create function public.generate_join_code() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i integer;
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
  end loop;
  return code;
end;
$$;

revoke all on function public.generate_join_code() from public, anon, authenticated;

alter table public.orgs
  add column join_code text not null unique default public.generate_join_code()
  check (join_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$');

create table public.org_members (
  org_id bigint not null references public.orgs (id),
  wallet_address public.xrpl_address not null references public.profiles (wallet_address),
  -- finance agents review an expedited payment before it reaches an admin; everyone else has a title
  finance_agent boolean not null default false,
  role_title text check (role_title is null or length(role_title) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (org_id, wallet_address),
  unique (wallet_address),
  constraint member_has_one_role check (
    (finance_agent and role_title is null) or (not finance_agent and role_title is not null)
  )
);
create index org_members_finance on public.org_members (org_id) where finance_agent;

-- Between the seller sending a request and an admin reviewing it.
alter type public.receivable_status add value 'FinanceReview' before 'Submitted';

alter table public.receivables
  add column finance_cleared_at timestamptz,
  add column finance_cleared_by public.xrpl_address;

alter table public.org_members enable row level security;
revoke all on public.org_members from anon, authenticated;
grant all on public.org_members to service_role;
