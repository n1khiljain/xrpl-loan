-- Turns notifications into an outbox. chain-sync queues each FR-B9 email once (the unique key still holds) and
-- every run retries unsent ones, so an email provider outage delays emails instead of losing them after the sync
-- cursor moves past the event. `data` holds the template fields (amounts, dates, link), not the email address,
-- which is read from the profile when the email is sent.
alter table public.notifications alter column sent_at drop not null;
alter table public.notifications alter column sent_at drop default;
alter table public.notifications add column data jsonb not null default '{}'::jsonb;
alter table public.notifications add column created_at timestamptz not null default now();
alter table public.notifications add column attempts integer not null default 0 check (attempts >= 0);
alter table public.notifications add column last_error text;

create index notifications_pending on public.notifications (created_at) where sent_at is null;
