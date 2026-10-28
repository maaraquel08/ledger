-- erase_my_data(): "Erase all data" in cloud mode. Deletes every row the signed-in Owner has,
-- in every user table, and keeps the login (auth.users) so they can start again.
-- Storage objects (receipts/, voice/) are removed by the app through the Storage API, which is
-- the only supported way to delete them.

-- The append-only guard on corrections lets exactly one thing through: this erase, which sets
-- ledger.erasing for its own transaction. Everything else is still refused.
create or replace function private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('ledger.erasing', true) = 'on' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create or replace function public.erase_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_table text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform set_config('ledger.erasing', 'on', true);

  -- children before parents; entries before the rows they point at
  foreach v_table in array array[
    'notification_log', 'push_subscriptions', 'insights',
    'corrections',    -- before entries: their FK would otherwise update (set null) an append-only row
    'rules',
    'entry_splits', 'receipt_items', 'entries', 'moves',
    'balance_snapshots', 'holding_snapshots', 'fx_rates',
    'raw_inputs',
    'recurring_items', 'account_aliases', 'goals', 'accounts',
    'entry_events',   -- last: deleting entries above appends 'delete' events
    'profiles'
  ] loop
    execute format('delete from public.%I where user_id = $1', v_table) using v_uid;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  end loop;

  perform set_config('ledger.erasing', 'off', true);
  return jsonb_build_object('erased', true, 'deleted', v_counts);
end $$;

revoke all on function public.erase_my_data() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.erase_my_data() from anon;
  end if;
end $$;
grant execute on function public.erase_my_data() to authenticated;
revoke all on function private.forbid_change() from public;
