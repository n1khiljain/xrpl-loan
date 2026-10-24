-- Runs chain-sync every minute (SYSTEM_DESIGN 1). The function URL and CHAIN_SYNC_SECRET live in Vault, never in
-- a migration. Until both secrets exist the job is a no-op, so local stacks and fresh projects don't error.
--   select vault.create_secret('<functions base URL>/chain-sync', 'chain_sync_url');
--   select vault.create_secret('<CHAIN_SYNC_SECRET>', 'chain_sync_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

create function public.invoke_chain_sync() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
  secret text;
begin
  select decrypted_secret into target from vault.decrypted_secrets where name = 'chain_sync_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'chain_sync_secret';
  if target is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := target,
    headers := jsonb_build_object('authorization', 'Bearer ' || secret, 'content-type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.invoke_chain_sync() from public, anon, authenticated;

select cron.schedule('chain-sync', '* * * * *', 'select public.invoke_chain_sync()');
