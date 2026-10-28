-- Schedules for the insights-run edge function (pg_cron + pg_net).
-- Times are Asia/Manila (UTC+8, no DST) expressed in UTC:
--   daily    21:00 PHT every day           -> '0 13 * * *'
--   weekly   20:00 PHT Sunday              -> '0 12 * * 0'
--   monthly  20:05 PHT first Sunday        -> '5 12 * * 0' + day-of-month <= 7 check
--   alerts   hourly                        -> '0 * * * *'
--
-- Needs two Vault secrets (see supabase/README.md):
--   project_url       https://<project-ref>.supabase.co
--   service_role_key  the project's service role key (sent as Bearer to insights-run)
--
-- Skipped (with a notice) when pg_cron/pg_net are unavailable (PGlite tests, plain
-- Postgres) or when the setting ledger.skip_cron = 'on'.

create or replace function private.invoke_insights(p_kind text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
  v_request bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    raise warning 'ledger cron: vault secrets project_url / service_role_key are missing; % run skipped', p_kind;
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/insights-run',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('kind', p_kind),
    timeout_milliseconds := 30000
  ) into v_request;
  return v_request;
end $$;

revoke all on function private.invoke_insights(text) from public;

do $cron$
begin
  if coalesce(current_setting('ledger.skip_cron', true), '') = 'on' then
    raise notice 'ledger.skip_cron is on; schedules not created';
    return;
  end if;
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net not available; schedules not created';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  perform cron.schedule('ledger-insights-daily',   '0 13 * * *', $$select private.invoke_insights('daily')$$);
  perform cron.schedule('ledger-insights-weekly',  '0 12 * * 0', $$select private.invoke_insights('weekly')$$);
  perform cron.schedule('ledger-insights-monthly', '5 12 * * 0',
    $$select private.invoke_insights('monthly') where extract(day from now() at time zone 'Asia/Manila') <= 7$$);
  perform cron.schedule('ledger-insights-alerts',  '0 * * * *',  $$select private.invoke_insights('alerts')$$);
end
$cron$;
