-- import_state(jsonb): one-time migration of the app's localStorage LedgerState
-- (src/lib/types.ts) into the signed-in user's rows. Idempotent: legacy ids map
-- deterministically to uuids (legacy_uuid) and every insert is ON CONFLICT DO NOTHING,
-- so running it twice changes nothing. Never overwrites cloud data, except a profile
-- that has not been onboarded yet.
--
-- Mapping:
--   accounts[]          -> accounts (opening_balance chosen so the derived balance equals Account.balance)
--   entries[]           -> entries; linkId groups that sum to zero -> moves; split -> entry_splits;
--                          receipt.items -> receipt_items; refunded -> refunded_at
--   profile             -> profiles; profile.goals -> goals;
--   profile.holdings    -> holding_snapshots on the first investments account
-- Returns { accounts, entries, moves, goals, holdings: {inserted, total},
--           skipped: [text], id_map: {accounts, entries, goals: {legacy: uuid}} }

create or replace function public.import_state(p_state jsonb) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
  v_prof jsonb := coalesce(p_state->'profile', '{}');
  v_tz text;
  v_n int;
  v_counts jsonb := '{}';
  v_skipped text[] := '{}';
  v_inv_account uuid;
  v_new_accounts uuid[];
begin
  if jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'import_state expects a LedgerState object' using errcode = '22023';
  end if;

  -- profile -----------------------------------------------------------------
  insert into profiles (user_id, name, initials, income, frequency, side_income, monthly_budget,
                        category_budgets, onboarded)
  values (
    v_uid,
    coalesce(v_prof->>'name', ''),
    coalesce(v_prof->>'initials', ''),
    coalesce((v_prof->>'income')::numeric, 0),
    case when v_prof->>'frequency' in ('Twice a month', 'Monthly', 'Weekly', 'Irregular')
         then v_prof->>'frequency' else 'Twice a month' end,
    coalesce(v_prof->'sideIncome', '[]'),
    coalesce((v_prof->>'monthlyBudget')::numeric, 0),
    coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(v_prof->'categoryBudgets', '{}')) as b(k, v)
               where k in (select code from categories)), '{}'),
    coalesce((p_state->>'onboarded')::boolean, true))
  on conflict (user_id) do update set
    name = excluded.name, initials = excluded.initials, income = excluded.income,
    frequency = excluded.frequency, side_income = excluded.side_income,
    monthly_budget = excluded.monthly_budget, category_budgets = excluded.category_budgets,
    onboarded = excluded.onboarded
  where profiles.onboarded = false;
  v_tz := ledger_timezone(v_uid);

  -- accounts (opening balance is set after the entries are in) ------------------
  with ins as (
    insert into accounts (id, user_id, name, provider, provider_label, type, kind, last4, rate, due_date,
                          opening_balance, legacy_id)
    select
      legacy_uuid(v_uid, 'account', a->>'id'), v_uid,
      coalesce(a->>'name', a->>'providerLabel', 'Account'),
      case when a->>'provider' in ('gcash','bpi','bdo','maya','maribank','rcbc','unionbank','ibkr','cash','other')
           then a->>'provider' else 'other' end,
      coalesce(a->>'providerLabel', ''),
      a->>'type',
      coalesce(a->>'kind', ''),
      case when a->>'last4' ~ '^[0-9]{4}$' then a->>'last4' end,
      a->>'rate',
      ((a->>'dueDate')::timestamptz at time zone v_tz)::date,
      0,
      a->>'id'
    from jsonb_array_elements(coalesce(p_state->'accounts', '[]')) a
    on conflict (id) do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_new_accounts from ins;
  v_counts := v_counts || jsonb_build_object('accounts', jsonb_build_object(
    'inserted', cardinality(v_new_accounts), 'total', jsonb_array_length(coalesce(p_state->'accounts', '[]'))));

  -- moves (linkId groups whose legs sum to zero) --------------------------------
  insert into moves (id, user_id, kind, legacy_id)
  select legacy_uuid(v_uid, 'move', link), v_uid,
         case when bool_or(cat = 'Investments') then 'invest' else 'transfer' end, link
    from (select x->>'linkId' as link, x->>'category' as cat, round((x->>'amount')::numeric, 2) as amt
            from jsonb_array_elements(coalesce(p_state->'entries', '[]')) x
           where x->>'linkId' is not null and round((x->>'amount')::numeric, 2) <> 0) l
   group by link
  having count(*) >= 2 and sum(amt) = 0
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('moves', jsonb_build_object('inserted', v_n));

  select coalesce(array_agg('entry ' || (x->>'id') || ': linkId ' || (x->>'linkId') || ' does not balance; imported unlinked'), '{}')
    into v_skipped
    from jsonb_array_elements(coalesce(p_state->'entries', '[]')) x
   where x->>'linkId' is not null
     and not exists (select 1 from moves m where m.id = legacy_uuid(v_uid, 'move', x->>'linkId'));

  -- entries -------------------------------------------------------------------
  with src as (
    select x, legacy_uuid(v_uid, 'entry', x->>'id') as id,
           round((x->>'amount')::numeric, 2) as amt,
           (select a.id from accounts a
             where a.user_id = v_uid and x->>'accountId' is not null
               and a.id = legacy_uuid(v_uid, 'account', x->>'accountId')) as account_id,
           (select c.code from categories c where c.code = x->>'category') as category_code,
           (select m.id from moves m
             where x->>'linkId' is not null and m.id = legacy_uuid(v_uid, 'move', x->>'linkId')) as move_id
      from jsonb_array_elements(coalesce(p_state->'entries', '[]')) x
     where round((x->>'amount')::numeric, 2) <> 0
  ),
  st as (
    select s.*,
      case when s.move_id is not null then
             case when bool_or(s.account_id is null or s.category_code is null) over (partition by s.move_id)
                  then 'review' else 'posted' end
           when s.account_id is null or s.category_code is null then 'review'
           else 'posted' end as status
      from src s
  )
  insert into entries (id, user_id, account_id, category_code, amount, occurred_at, description, status,
                       refunded_at, move_id, raw, source, auto, method, legacy_id)
  select st.id, v_uid, st.account_id, st.category_code, st.amt, (st.x->>'date')::timestamptz,
         coalesce(st.x->>'desc', ''), st.status,
         case when coalesce((st.x->>'refunded')::boolean, false) and st.amt < 0 and st.move_id is null
              then (st.x->>'date')::timestamptz end,
         st.move_id, st.x->>'raw',
         case when st.x->>'source' in ('voice', 'receipt') then st.x->>'source' end,
         coalesce((st.x->>'auto')::boolean, false), st.x->>'method', st.x->>'id'
    from st
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('entries', jsonb_build_object(
    'inserted', v_n, 'total', jsonb_array_length(coalesce(p_state->'entries', '[]'))));

  insert into entry_splits (id, user_id, entry_id, category_code, amount, items, position)
  select legacy_uuid(v_uid, 'split', (x->>'id') || ':' || s.ordinality), v_uid,
         legacy_uuid(v_uid, 'entry', x->>'id'),
         coalesce((select c.code from categories c where c.code = s.value->>'category'), 'Other'),
         round((s.value->>'amount')::numeric, 2),
         coalesce(array(select jsonb_array_elements_text(s.value->'items')), '{}'),
         s.ordinality::int
    from jsonb_array_elements(coalesce(p_state->'entries', '[]')) x
    cross join lateral jsonb_array_elements(coalesce(x->'split', '[]')) with ordinality s
   where round((s.value->>'amount')::numeric, 2) > 0
     and exists (select 1 from entries e where e.id = legacy_uuid(v_uid, 'entry', x->>'id'))
  on conflict (id) do nothing;

  insert into receipt_items (id, user_id, entry_id, name, amount, category_code, unsure, position)
  select legacy_uuid(v_uid, 'receipt_item', (x->>'id') || ':' || i.ordinality), v_uid,
         legacy_uuid(v_uid, 'entry', x->>'id'),
         coalesce(i.value->>'name', ''), greatest(round((i.value->>'amount')::numeric, 2), 0),
         (select c.code from categories c where c.code = i.value->>'category'),
         coalesce((i.value->>'unsure')::boolean, false), i.ordinality::int
    from jsonb_array_elements(coalesce(p_state->'entries', '[]')) x
    cross join lateral jsonb_array_elements(coalesce(x->'receipt'->'items', '[]')) with ordinality i
   where exists (select 1 from entries e where e.id = legacy_uuid(v_uid, 'entry', x->>'id'))
  on conflict (id) do nothing;

  -- opening balance of newly imported accounts: derived balance must equal Account.balance
  update accounts a set
    opening_balance = case when a.type = 'credit' then s.bal + coalesce(e.eff, 0) else s.bal - coalesce(e.eff, 0) end,
    opening_date = least(a.opening_date, coalesce(e.first_at, a.opening_date))
  from (select legacy_uuid(v_uid, 'account', x->>'id') as id, coalesce((x->>'balance')::numeric, 0) as bal
          from jsonb_array_elements(coalesce(p_state->'accounts', '[]')) x) s
  left join lateral (
    select sum(f.effect) as eff, min(f.occurred_at) as first_at
      from entry_facts f where f.account_id = s.id
  ) e on true
  where a.id = s.id and a.id = any(v_new_accounts);

  -- goals ---------------------------------------------------------------------
  insert into goals (id, user_id, name, saved, target, by_month, legacy_id)
  select legacy_uuid(v_uid, 'goal', g->>'id'), v_uid, coalesce(g->>'name', 'Goal'),
         coalesce((g->>'saved')::numeric, 0), coalesce((g->>'target')::numeric, 0),
         case when g->>'by' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then g->>'by' else '' end,
         g->>'id'
    from jsonb_array_elements(coalesce(v_prof->'goals', '[]')) g
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('goals', jsonb_build_object(
    'inserted', v_n, 'total', jsonb_array_length(coalesce(v_prof->'goals', '[]'))));

  -- holdings -> first investments account --------------------------------------
  select legacy_uuid(v_uid, 'account', a->>'id') into v_inv_account
    from jsonb_array_elements(coalesce(p_state->'accounts', '[]')) with ordinality as t(a, ord)
   where a->>'type' = 'investments'
   order by ord limit 1;

  if v_inv_account is null then
    if jsonb_array_length(coalesce(v_prof->'holdings', '[]')) > 0 then
      v_skipped := v_skipped || 'holdings: no investments account to attach them to'::text;
    end if;
    v_n := 0;
  else
    insert into holding_snapshots (id, user_id, account_id, as_of, symbol, name, qty, price, value, change_pct)
    select legacy_uuid(v_uid, 'holding', h->>'ticker'), v_uid, v_inv_account, now(),
           h->>'ticker', coalesce(h->>'name', ''), coalesce((h->>'shares')::numeric, 0),
           case when coalesce((h->>'shares')::numeric, 0) <> 0
                then round((h->>'value')::numeric / (h->>'shares')::numeric, 6) else 0 end,
           coalesce((h->>'value')::numeric, 0), (h->>'change')::numeric
      from jsonb_array_elements(coalesce(v_prof->'holdings', '[]')) h
    on conflict (id) do nothing;
    get diagnostics v_n = row_count;
  end if;
  v_counts := v_counts || jsonb_build_object('holdings', jsonb_build_object(
    'inserted', v_n, 'total', jsonb_array_length(coalesce(v_prof->'holdings', '[]'))));

  set constraints public.entries_check_move immediate;

  return v_counts || jsonb_build_object(
    'skipped', to_jsonb(v_skipped),
    'id_map', jsonb_build_object(
      'accounts', coalesce((select jsonb_object_agg(a->>'id', legacy_uuid(v_uid, 'account', a->>'id'))
                              from jsonb_array_elements(coalesce(p_state->'accounts', '[]')) a), '{}'),
      'entries', coalesce((select jsonb_object_agg(x->>'id', legacy_uuid(v_uid, 'entry', x->>'id'))
                             from jsonb_array_elements(coalesce(p_state->'entries', '[]')) x), '{}'),
      'goals', coalesce((select jsonb_object_agg(g->>'id', legacy_uuid(v_uid, 'goal', g->>'id'))
                           from jsonb_array_elements(coalesce(v_prof->'goals', '[]')) g), '{}')));
end $$;
