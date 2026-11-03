-- Per-user category lists for the Budget tab.
--
-- public.categories stays the global reference table (every code an entry can carry, with the flags
-- the metrics read). user_categories is the list each Owner sees and edits: which categories, their
-- kind and order. No rows = the built-in defaults, materialised on the first add/rename/delete.
-- Writes go only through the three security definer RPCs below (search_path = '', scoped to
-- ledger_uid(), every row filtered by user_id). A rename NEVER touches categories.code (that would
-- cascade to every user): it adds the new code if missing and moves only the caller's rows.
-- System categories (Transfer, Investments, Adjustment, Other) can be neither added, renamed nor deleted.

-- Category budgets as a share of the monthly budget (spec 2026-11-03-budget-percent):
-- { "<category code>": percent }. category_budgets keeps the resolved pesos, so every reader works
-- unchanged; the client re-resolves and writes both. rename/delete below move or drop its key too.
alter table public.profiles add column if not exists category_budget_pct jsonb not null default '{}';

create table public.user_categories (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code        text not null references public.categories (code) on update cascade,
  kind        text not null check (kind in ('expense', 'income')),
  sort        int not null,
  created_at  timestamptz default now(),
  primary key (user_id, code)
);

alter table public.user_categories enable row level security;
create policy owner_select on public.user_categories for select to authenticated using (user_id = auth.uid());
-- no insert/update/delete policy and no write grant: the RPCs are the only writers
revoke insert, update, delete, truncate on public.user_categories from anon, authenticated;
revoke all on public.user_categories from anon;

-- ---------------------------------------------------------------------------
-- private helpers (callable by no API role)
-- ---------------------------------------------------------------------------

-- the defaults for a user with no rows: expense categories in categories.sort order, then income
create or replace function private.ensure_user_categories(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.user_categories where user_id = p_user) then
    return;
  end if;
  insert into public.user_categories (user_id, code, kind, sort)
  select p_user, c.code, c.kind,
         (row_number() over (order by (c.kind = 'income'), c.sort))::int
    from public.categories c
   where c.code in ('Food & drink', 'Groceries', 'Transport', 'Shopping', 'Rent & bills',
                    'Subscriptions', 'Gifts', 'Household', 'Health', 'Other', 'Salary', 'Income')
  on conflict do nothing;
end $$;

create or replace function private.user_categories_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('categories', coalesce(
    jsonb_agg(jsonb_build_object('code', code, 'kind', kind) order by sort, code), '[]'::jsonb))
    from public.user_categories where user_id = p_user
$$;

create or replace function private.is_system_category(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(p_name) in ('transfer', 'investments', 'adjustment', 'other')
$$;

-- trim and validate a new category name
create or replace function private.clean_category_name(p_name text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if v = '' or char_length(v) > 32 then
    raise exception 'category_name_invalid' using errcode = '22023';
  end if;
  if private.is_system_category(v) then
    raise exception 'category_system' using errcode = '22023';
  end if;
  return v;
end $$;

-- move one user's rows from one category code to another (never touches categories.code)
create or replace function private.reassign_category(p_user uuid, p_from text, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.entries         set category_code = p_to where user_id = p_user and category_code = p_from;
  update public.entry_splits    set category_code = p_to where user_id = p_user and category_code = p_from;
  update public.receipt_items   set category_code = p_to where user_id = p_user and category_code = p_from;
  update public.recurring_items set category_code = p_to where user_id = p_user and category_code = p_from;
  update public.rules
     set "set" = jsonb_set("set", '{category_code}', to_jsonb(p_to))
   where user_id = p_user and "set"->>'category_code' = p_from;
end $$;

-- ---------------------------------------------------------------------------
-- add_category
-- ---------------------------------------------------------------------------
create or replace function public.add_category(p_name text, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  v_name text := private.clean_category_name(p_name);
  v_kind text;
begin
  if p_kind is null or p_kind not in ('expense', 'income') then
    raise exception 'category_kind_invalid' using errcode = '22023';
  end if;
  perform private.ensure_user_categories(v_uid);
  if exists (select 1 from public.user_categories where user_id = v_uid and lower(code) = lower(v_name)) then
    raise exception 'category_exists' using errcode = '22023';
  end if;
  -- names are a shared vocabulary (categories.code); a cap keeps one account from flooding it
  if (select count(*) from public.user_categories where user_id = v_uid) >= 50 then
    raise exception 'category_limit' using errcode = '22023';
  end if;

  insert into public.categories (code, label, kind, is_spend, is_fixed, is_monthly, sort)
  values (v_name, v_name, p_kind, p_kind = 'expense', false, false, 100)
  on conflict (code) do nothing;
  select kind into v_kind from public.categories where code = v_name;
  if v_kind <> p_kind then
    raise exception 'category_kind_clash' using errcode = '22023';
  end if;

  insert into public.user_categories (user_id, code, kind, sort)
  select v_uid, v_name, p_kind, coalesce(max(sort), 0) + 1 from public.user_categories where user_id = v_uid;
  return private.user_categories_json(v_uid);
end $$;

-- ---------------------------------------------------------------------------
-- rename_category
-- ---------------------------------------------------------------------------
create or replace function public.rename_category(p_from text, p_to text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  v_to text := private.clean_category_name(p_to);
  v_src public.categories;
  v_row public.user_categories;
  v_dst_kind text;
begin
  perform private.ensure_user_categories(v_uid);
  select * into v_row from public.user_categories where user_id = v_uid and code = p_from;
  if not found then
    raise exception 'category_not_found' using errcode = '22023';
  end if;
  if private.is_system_category(p_from) then
    raise exception 'category_system' using errcode = '22023';
  end if;
  if v_to = p_from then
    return private.user_categories_json(v_uid);
  end if;
  if exists (select 1 from public.user_categories
              where user_id = v_uid and code <> p_from and lower(code) = lower(v_to)) then
    raise exception 'category_exists' using errcode = '22023';
  end if;

  select * into v_src from public.categories where code = p_from;
  insert into public.categories (code, label, kind, is_spend, is_fixed, is_monthly, sort)
  values (v_to, v_to, v_src.kind, v_src.is_spend, v_src.is_fixed, v_src.is_monthly, 100)
  on conflict (code) do nothing;
  select kind into v_dst_kind from public.categories where code = v_to;
  if v_dst_kind <> v_src.kind then
    raise exception 'category_kind_clash' using errcode = '22023';
  end if;

  perform private.reassign_category(v_uid, p_from, v_to);
  update public.profiles
     set category_budgets = (category_budgets - p_from)
                            || case when category_budgets ? p_from
                                    then jsonb_build_object(v_to, category_budgets -> p_from) else '{}'::jsonb end,
         category_budget_pct = (category_budget_pct - p_from)
                            || case when category_budget_pct ? p_from
                                    then jsonb_build_object(v_to, category_budget_pct -> p_from) else '{}'::jsonb end
   where user_id = v_uid;
  delete from public.user_categories where user_id = v_uid and code = p_from;
  insert into public.user_categories (user_id, code, kind, sort, created_at)
  values (v_uid, v_to, v_row.kind, v_row.sort, v_row.created_at);
  return private.user_categories_json(v_uid);
end $$;

-- ---------------------------------------------------------------------------
-- delete_category
-- ---------------------------------------------------------------------------
create or replace function public.delete_category(p_name text, p_move_to text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  v_row public.user_categories;
  v_dst public.user_categories;
begin
  perform private.ensure_user_categories(v_uid);
  select * into v_row from public.user_categories where user_id = v_uid and code = p_name;
  if not found then
    raise exception 'category_not_found' using errcode = '22023';
  end if;
  if private.is_system_category(p_name) then
    raise exception 'category_system' using errcode = '22023';
  end if;
  select * into v_dst from public.user_categories where user_id = v_uid and code = p_move_to;
  if not found or v_dst.code = p_name or v_dst.kind <> v_row.kind then
    raise exception 'category_move_invalid' using errcode = '22023';
  end if;

  perform private.reassign_category(v_uid, p_name, p_move_to);
  update public.profiles
     set category_budgets = category_budgets - p_name, category_budget_pct = category_budget_pct - p_name
   where user_id = v_uid;
  delete from public.user_categories where user_id = v_uid and code = p_name;
  return private.user_categories_json(v_uid);
end $$;

-- ---------------------------------------------------------------------------
-- grants: same as every definer RPC; helpers callable by no API role
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'private.ensure_user_categories(uuid)', 'private.user_categories_json(uuid)',
    'private.is_system_category(text)', 'private.clean_category_name(text)',
    'private.reassign_category(uuid, text, text)',
    'public.add_category(text, text)', 'public.rename_category(text, text)', 'public.delete_category(text, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if f like 'private.%' then
      execute format('revoke all on function %s from authenticated', f);
    else
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
end $$;

-- erase_my_data: same function as 20261103000100 with user_categories added.
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
    'chat_messages', 'chat_threads',   -- messages before their thread (the FK would cascade anyway)
    'corrections',    -- before entries: their FK would otherwise update (set null) an append-only row
    'rules',
    'entry_splits', 'receipt_items', 'entries', 'moves',
    'balance_snapshots', 'holding_snapshots', 'fx_rates',
    'raw_inputs',
    'recurring_items', 'account_aliases', 'goals', 'accounts',
    'user_categories',
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
