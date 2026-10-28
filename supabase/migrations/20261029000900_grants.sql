-- Function privileges: signed-in users and the service role may call public functions;
-- anonymous callers may not. Internal helpers in schema private are callable by no API role.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') -- skip extension functions
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f.sig);
    end if;
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    elsif exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

-- views are read-only for API roles
revoke insert, update, delete, truncate on
  public.entry_facts, public.spend_parts, public.account_balances, public.reconciliation,
  public.investment_values, public.net_worth
from anon, authenticated;
