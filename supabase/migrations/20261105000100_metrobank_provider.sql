-- Metrobank joins the known providers (logo in the app). The provider check is widened in
-- place; existing rows are untouched.
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.accounts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%provider%';
  if v_name is not null then
    execute format('alter table public.accounts drop constraint %I', v_name);
  end if;
end $$;

alter table public.accounts add constraint accounts_provider_check
  check (provider in ('gcash','bpi','bdo','maya','maribank','rcbc','unionbank','metrobank','ibkr','cash','other'));
