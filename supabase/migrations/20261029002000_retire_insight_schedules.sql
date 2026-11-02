-- Proactive insights and push were removed from the app: stop the scheduled runs so the
-- insights-run function is no longer called. The tables and functions stay (history, export).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobname) from cron.job
     where jobname in ('ledger-insights-daily', 'ledger-insights-weekly', 'ledger-insights-monthly', 'ledger-insights-alerts');
  end if;
end
$$;
