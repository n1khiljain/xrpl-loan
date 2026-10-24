-- When connecting FraxNet added the member's app wallet to their FraxNet organization (U-78). Null until it has,
-- for example when they unticked that permission on FraxNet's consent screen.
alter table public.fraxnet_connections add column wallet_added_at timestamptz;
