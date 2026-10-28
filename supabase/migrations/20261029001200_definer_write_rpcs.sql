-- Money tables are written ONLY through the write RPCs (review finding I).
--
-- Before: the RPCs were security invoker and the core_schema `owner_all` policies let a signed-in
-- user insert/update/delete entries, moves, accounts… directly, skipping every RPC rule
-- (opening_balance fixed, refund = expense only, status rules, move mirroring, idempotency).
-- After: the RPCs below are security definer (search_path = '', every name qualified) and still act
-- only for ledger_uid(); INSERT/UPDATE/DELETE on the money tables is revoked from anon and
-- authenticated. SELECT (and the owner_all policies that scope it) stays as it was.
--
-- A security definer function runs as its owner, which bypasses RLS, so every lookup below is
-- filtered by user_id explicitly.
--
-- Tables the client may still write directly (RLS-scoped): profiles, goals, recurring_items,
-- account_aliases, rules, corrections (insert only), raw_inputs, insights, push_subscriptions,
-- notification_log, fx_rates.

-- ---------------------------------------------------------------------------
-- ledger_uid: decide "service role may name the user" on the role the request runs as
-- (the `role` setting PostgREST switches to, or the session user for a direct connection),
-- not on current_user, which inside a security definer function is the function owner.
-- ---------------------------------------------------------------------------
create or replace function public.ledger_uid(p_user uuid default null) returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid := auth.uid();
  v_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
begin
  if v is not null then
    if p_user is not null and p_user <> v then
      raise exception 'p_user must be the caller' using errcode = '42501';
    end if;
    return v;
  end if;
  if p_user is not null and v_role in ('service_role', 'postgres', 'supabase_admin') then
    return p_user;
  end if;
  raise exception 'not authenticated' using errcode = '28000';
end $$;

-- ---------------------------------------------------------------------------
-- set_entry_details: internal helper, no longer callable through the API
-- ---------------------------------------------------------------------------
revoke all on function public.set_entry_details(uuid, uuid, jsonb, jsonb) from public, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.set_entry_details(uuid, uuid, jsonb, jsonb) from anon;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- post_entries
-- ---------------------------------------------------------------------------
create or replace function public.post_entries(p_entries jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  v_items jsonb;
  v jsonb;
  v_id uuid;
  v_move uuid;
  v_rows int;
  v_all uuid[] := '{}';
  v_created uuid[] := '{}';
  v_existing uuid[] := '{}';
  v_result jsonb;
begin
  v_items := case jsonb_typeof(p_entries)
               when 'array' then p_entries
               when 'object' then jsonb_build_array(p_entries)
             end;
  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'post_entries expects an entry object or a non-empty array' using errcode = '22023';
  end if;

  for v in select value from jsonb_array_elements(v_items) loop
    if coalesce(v->>'status', 'posted') not in ('posted', 'review') then
      raise exception 'status must be posted or review' using errcode = '22023';
    end if;
    v_id := coalesce((v->>'id')::uuid, gen_random_uuid());
    v_move := (v->>'move_id')::uuid;

    if v_move is not null then
      insert into public.moves (id, user_id, kind)
      values (v_move, v_uid, coalesce(v->>'move_kind',
              case when v->>'category_code' = 'Investments' then 'invest' else 'transfer' end))
      on conflict (id) do nothing;
      if not exists (select 1 from public.moves m where m.id = v_move and m.user_id = v_uid) then
        raise exception 'move id % is already in use', v_move using errcode = '23505';
      end if;
    end if;

    insert into public.entries (
      id, user_id, account_id, category_code, amount, currency, occurred_at, description, merchant,
      status, review_question, move_id, raw_input_id, raw, source, created_by, rule_id, auto, method,
      receipt_image_path)
    values (
      v_id, v_uid, (v->>'account_id')::uuid, v->>'category_code', (v->>'amount')::numeric,
      coalesce(v->>'currency', 'PHP'), coalesce((v->>'occurred_at')::timestamptz, now()),
      coalesce(v->>'description', ''), v->>'merchant', coalesce(v->>'status', 'posted'),
      v->>'review_question', v_move, (v->>'raw_input_id')::uuid, v->>'raw', v->>'source',
      coalesce(v->>'created_by', 'owner'),
      (select r.id from public.rules r where r.id = (v->>'rule_id')::uuid and r.user_id = v_uid),
      coalesce((v->>'auto')::boolean, false),
      v->>'method', v->>'receipt_image_path')
    on conflict (id) do nothing;
    get diagnostics v_rows = row_count;

    if v_rows = 1 then
      v_created := v_created || v_id;
      perform public.set_entry_details(v_id, v_uid, v->'splits', v->'receipt_items');
    elsif exists (select 1 from public.entries e where e.id = v_id and e.user_id = v_uid) then
      v_existing := v_existing || v_id;
    else
      raise exception 'entry id % is already in use', v_id using errcode = '23505';
    end if;
    v_all := v_all || v_id;
  end loop;

  set constraints public.entries_check_move immediate;

  v_result := public.mutation_result(v_all);
  if v_result->>'undo_event_id' is null then
    -- pure replay: point at the original insert so the client can still undo
    v_result := v_result || jsonb_build_object(
      'undo_event_id', (select ev.id from public.entry_events ev
                         where ev.entry_id = any(v_all) and ev.op = 'insert' and ev.user_id = v_uid
                         order by ev.seq limit 1));
  end if;
  return v_result || jsonb_build_object('created', to_jsonb(v_created), 'existing', to_jsonb(v_existing));
end $$;

-- ---------------------------------------------------------------------------
-- update_entry
-- ---------------------------------------------------------------------------
create or replace function public.update_entry(p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  e public.entries;
  v_bad text;
  v_ids uuid[];
begin
  select * into e from public.entries x where x.id = p_id and x.user_id = v_uid for update;
  if not found then
    raise exception 'entry % not found', p_id using errcode = 'P0002';
  end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_patch) k
   where k not in ('account_id', 'category_code', 'amount', 'currency', 'occurred_at', 'description', 'merchant',
                   'status', 'review_question', 'method', 'auto', 'source', 'raw', 'receipt_image_path',
                   'splits', 'receipt_items');
  if v_bad is not null then
    raise exception 'update_entry: unknown or read-only keys: %', v_bad using errcode = '22023';
  end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('posted', 'review') then
    raise exception 'status must be posted or review (use void_entry / undo_event)' using errcode = '22023';
  end if;

  update public.entries set
    account_id         = case when p_patch ? 'account_id' then (p_patch->>'account_id')::uuid else account_id end,
    category_code      = case when p_patch ? 'category_code' then p_patch->>'category_code' else category_code end,
    amount             = case when p_patch ? 'amount' then (p_patch->>'amount')::numeric else amount end,
    currency           = case when p_patch ? 'currency' then p_patch->>'currency' else currency end,
    occurred_at        = case when p_patch ? 'occurred_at' then (p_patch->>'occurred_at')::timestamptz else occurred_at end,
    description        = case when p_patch ? 'description' then coalesce(p_patch->>'description', '') else description end,
    merchant           = case when p_patch ? 'merchant' then p_patch->>'merchant' else merchant end,
    status             = case when p_patch ? 'status' then p_patch->>'status' else status end,
    review_question    = case when p_patch ? 'review_question' then p_patch->>'review_question' else review_question end,
    method             = case when p_patch ? 'method' then p_patch->>'method' else method end,
    auto               = case when p_patch ? 'auto' then coalesce((p_patch->>'auto')::boolean, false) else auto end,
    source             = case when p_patch ? 'source' then p_patch->>'source' else source end,
    raw                = case when p_patch ? 'raw' then p_patch->>'raw' else raw end,
    receipt_image_path = case when p_patch ? 'receipt_image_path' then p_patch->>'receipt_image_path' else receipt_image_path end
  where id = p_id and user_id = v_uid;

  perform public.set_entry_details(p_id, v_uid,
    case when p_patch ? 'splits' then coalesce(p_patch->'splits', '[]') end,
    case when p_patch ? 'receipt_items' then coalesce(p_patch->'receipt_items', '[]') end);

  v_ids := array[p_id];
  if e.move_id is not null then
    if (p_patch ? 'amount' or p_patch ? 'occurred_at')
       and (select count(*) from public.entries x where x.move_id = e.move_id and x.user_id = v_uid) = 2 then
      update public.entries o set
        amount      = case when p_patch ? 'amount' then -(p_patch->>'amount')::numeric else o.amount end,
        occurred_at = case when p_patch ? 'occurred_at' then (p_patch->>'occurred_at')::timestamptz else o.occurred_at end
      where o.move_id = e.move_id and o.user_id = v_uid and o.id <> p_id;
    end if;
    v_ids := v_ids || array(select x.id from public.entries x
                             where x.move_id = e.move_id and x.user_id = v_uid and x.id <> p_id order by x.id);
  end if;

  set constraints public.entries_check_move immediate;
  return public.mutation_result(v_ids);
end $$;

-- ---------------------------------------------------------------------------
-- void_entry
-- ---------------------------------------------------------------------------
create or replace function public.void_entry(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  e public.entries;
begin
  select * into e from public.entries x where x.id = p_id and x.user_id = v_uid for update;
  if not found then
    raise exception 'entry % not found', p_id using errcode = 'P0002';
  end if;
  update public.entries set status = 'void' where id = p_id and user_id = v_uid and status <> 'void';
  set constraints public.entries_check_move immediate;
  return public.mutation_result(array[p_id] || array(
    select x.id from public.entries x
     where e.move_id is not null and x.move_id = e.move_id and x.user_id = v_uid and x.id <> p_id order by x.id));
end $$;

-- ---------------------------------------------------------------------------
-- mark_refunded
-- ---------------------------------------------------------------------------
create or replace function public.mark_refunded(p_id uuid, p_refunded boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  e public.entries;
begin
  select * into e from public.entries x where x.id = p_id and x.user_id = v_uid for update;
  if not found then
    raise exception 'entry % not found', p_id using errcode = 'P0002';
  end if;
  if p_refunded and (e.amount >= 0 or e.move_id is not null) then
    raise exception 'only an expense can be refunded' using errcode = '22023';
  end if;
  update public.entries
     set refunded_at = case when p_refunded then coalesce(refunded_at, now()) end
   where id = p_id and user_id = v_uid;
  return public.mutation_result(array[p_id]);
end $$;

-- ---------------------------------------------------------------------------
-- undo_event
-- ---------------------------------------------------------------------------
create or replace function public.undo_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  ev public.entry_events;
  v_batch uuid;
  v_max bigint;
  r record;
  v_deleted uuid[] := '{}';
  v_touched uuid[] := '{}';
  v_moves uuid[] := '{}';
begin
  select * into ev from public.entry_events x where x.id = p_event_id and x.user_id = v_uid;
  if not found then
    raise exception 'event % not found', p_event_id using errcode = 'P0002';
  end if;
  if ev.reverts_batch_id is not null then
    raise exception 'an undo cannot be undone' using errcode = '22023';
  end if;
  v_batch := ev.batch_id;

  if exists (select 1 from public.entry_events x where x.reverts_batch_id = v_batch and x.user_id = v_uid) then
    return jsonb_build_object('batch_id', null, 'reverted_batch_id', v_batch, 'already_undone', true,
                              'entries', '[]'::jsonb, 'deleted_ids', '[]'::jsonb);
  end if;

  select max(x.seq) into v_max from public.entry_events x where x.batch_id = v_batch and x.user_id = v_uid;
  if exists (
    select 1 from public.entry_events x
     where x.user_id = v_uid and x.seq > v_max
       and x.entry_id in (select y.entry_id from public.entry_events y where y.batch_id = v_batch and y.user_id = v_uid)
       and x.reverts_batch_id is null
       and not exists (select 1 from public.entry_events u where u.reverts_batch_id = x.batch_id and u.user_id = v_uid)
  ) then
    raise exception 'these entries changed since; undo the newer change first' using errcode = '40001';
  end if;

  perform set_config('ledger.reverts_batch', v_batch::text, true);

  -- the first event per entry in the batch holds the state from before the batch
  for r in
    select distinct on (x.entry_id) x.entry_id, x.op, x.before, x.after
      from public.entry_events x where x.batch_id = v_batch and x.user_id = v_uid
     order by x.entry_id, x.seq
  loop
    if r.op = 'insert' then
      v_moves := v_moves || (r.after->>'move_id')::uuid;
      delete from public.entries where id = r.entry_id and user_id = v_uid;
      v_deleted := v_deleted || r.entry_id;
    elsif r.op = 'delete' then
      insert into public.entries select * from jsonb_populate_record(null::public.entries, r.before);
      v_touched := v_touched || r.entry_id;
    else
      update public.entries t set
        account_id = b.account_id, category_code = b.category_code, amount = b.amount, currency = b.currency,
        occurred_at = b.occurred_at, description = b.description, merchant = b.merchant, status = b.status,
        review_question = b.review_question, refunded_at = b.refunded_at, move_id = b.move_id,
        raw_input_id = b.raw_input_id, raw = b.raw, source = b.source, created_by = b.created_by,
        rule_id = b.rule_id, auto = b.auto, method = b.method, receipt_image_path = b.receipt_image_path,
        legacy_id = b.legacy_id
      from jsonb_populate_record(null::public.entries, r.before) b
      where t.id = r.entry_id and t.user_id = v_uid;
      v_touched := v_touched || r.entry_id;
    end if;
  end loop;

  delete from public.moves m
   where m.user_id = v_uid and m.id = any(v_moves)
     and not exists (select 1 from public.entries e where e.move_id = m.id);

  set constraints public.entries_check_move immediate;

  return jsonb_build_object(
    'batch_id', public.current_batch_id(),
    'reverted_batch_id', v_batch,
    'already_undone', false,
    'entries', coalesce((select jsonb_agg(public.entry_json(t.id) order by t.id)
                           from unnest(v_touched) as t(id)
                          where exists (select 1 from public.entries e where e.id = t.id and e.user_id = v_uid)), '[]'::jsonb),
    'deleted_ids', to_jsonb(v_deleted)
  );
end $$;

-- ---------------------------------------------------------------------------
-- report_balance
-- ---------------------------------------------------------------------------
create or replace function public.report_balance(
  p_account_id uuid, p_reported numeric, p_as_of timestamptz default now(),
  p_raw_input_id uuid default null, p_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if not exists (select 1 from public.accounts a where a.id = p_account_id and a.user_id = v_uid) then
    raise exception 'account % not found', p_account_id using errcode = 'P0002';
  end if;
  insert into public.balance_snapshots (id, user_id, account_id, as_of, reported, raw_input_id)
  values (v_id, v_uid, p_account_id, coalesce(p_as_of, now()), p_reported, p_raw_input_id)
  on conflict (id) do nothing;
  if not exists (select 1 from public.balance_snapshots s where s.id = v_id and s.user_id = v_uid) then
    raise exception 'snapshot id % is already in use', v_id using errcode = '23505';
  end if;
  return public.snapshot_gap(v_id);
end $$;

-- ---------------------------------------------------------------------------
-- record_adjustment
-- ---------------------------------------------------------------------------
create or replace function public.record_adjustment(
  p_account_id uuid, p_amount numeric default null, p_note text default null, p_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  a public.accounts;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_snap uuid;
  v_gap jsonb;
  v_amount numeric;
  v_at timestamptz := now();
begin
  select * into a from public.accounts x where x.id = p_account_id and x.user_id = v_uid;
  if not found then
    raise exception 'account % not found', p_account_id using errcode = 'P0002';
  end if;

  if exists (select 1 from public.entries e where e.id = v_id and e.user_id = v_uid) then
    return public.mutation_result(array[v_id]) || jsonb_build_object('adjusted', true, 'replay', true);
  end if;

  select s.id into v_snap from public.balance_snapshots s
   where s.account_id = a.id and s.user_id = v_uid order by s.as_of desc, s.created_at desc limit 1;
  if v_snap is not null then
    v_gap := public.snapshot_gap(v_snap);
  end if;

  if p_amount is null then
    if v_gap is null then
      raise exception 'no reported balance to reconcile; pass p_amount' using errcode = '22023';
    end if;
    -- display-terms gap -> signed entry amount (credit: owed goes up when amount is negative)
    v_amount := case when a.type = 'credit' then -(v_gap->>'gap')::numeric else (v_gap->>'gap')::numeric end;
    v_at := (v_gap->>'as_of')::timestamptz;
  else
    v_amount := p_amount;
  end if;

  if v_amount = 0 then
    return jsonb_build_object('batch_id', null, 'undo_event_id', null, 'entries', '[]'::jsonb,
                              'adjusted', false, 'gap_before', v_gap->'gap', 'gap_after', v_gap->'gap');
  end if;

  insert into public.entries (id, user_id, account_id, category_code, amount, occurred_at, description, status, created_by)
  values (v_id, v_uid, a.id, 'Adjustment', v_amount, v_at, coalesce(p_note, 'Balance adjustment'), 'posted', 'owner');

  return public.mutation_result(array[v_id]) || jsonb_build_object(
    'adjusted', true,
    'gap_before', v_gap->'gap',
    'gap_after', case when v_snap is not null then public.snapshot_gap(v_snap)->'gap' end);
end $$;

-- ---------------------------------------------------------------------------
-- report_holdings
-- ---------------------------------------------------------------------------
create or replace function public.report_holdings(
  p_account_id uuid, p_holdings jsonb, p_as_of timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  v_at timestamptz := coalesce(p_as_of, now());
begin
  if not exists (select 1 from public.accounts a
                  where a.id = p_account_id and a.user_id = v_uid and a.type = 'investments') then
    raise exception 'investments account % not found', p_account_id using errcode = 'P0002';
  end if;
  insert into public.holding_snapshots (user_id, account_id, as_of, symbol, name, qty, price, value, change_pct, currency)
  select v_uid, p_account_id, v_at, h->>'symbol', coalesce(h->>'name', ''),
         (h->>'qty')::numeric,
         coalesce((h->>'price')::numeric,
                  case when (h->>'qty')::numeric <> 0 then (h->>'value')::numeric / (h->>'qty')::numeric else 0 end),
         coalesce((h->>'value')::numeric, (h->>'qty')::numeric * (h->>'price')::numeric),
         (h->>'change_pct')::numeric, coalesce(h->>'currency', 'PHP')
    from jsonb_array_elements(p_holdings) h;

  return jsonb_build_object(
    'account_id', p_account_id, 'as_of', v_at,
    'holdings', (select coalesce(jsonb_agg(to_jsonb(hs) order by hs.value desc), '[]'::jsonb)
                   from public.holding_snapshots hs
                  where hs.account_id = p_account_id and hs.user_id = v_uid and hs.as_of = v_at),
    'market_value', (select iv.market_value from public.investment_values iv
                      where iv.account_id = p_account_id and iv.user_id = v_uid));
end $$;

-- ---------------------------------------------------------------------------
-- upsert_account
-- ---------------------------------------------------------------------------
create or replace function public.upsert_account(p_account jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
  v_id uuid := coalesce((p_account->>'id')::uuid, gen_random_uuid());
  a public.accounts;
begin
  select * into a from public.accounts x where x.id = v_id and x.user_id = v_uid for update;
  if found then
    if p_account ? 'opening_balance' and (p_account->>'opening_balance')::numeric is distinct from a.opening_balance then
      raise exception 'opening_balance is fixed; use report_balance and record_adjustment' using errcode = '22023';
    end if;
    update public.accounts set
      name           = case when p_account ? 'name' then p_account->>'name' else name end,
      provider       = case when p_account ? 'provider' then p_account->>'provider' else provider end,
      provider_label = case when p_account ? 'provider_label' then coalesce(p_account->>'provider_label', '') else provider_label end,
      type           = case when p_account ? 'type' then p_account->>'type' else type end,
      kind           = case when p_account ? 'kind' then coalesce(p_account->>'kind', '') else kind end,
      last4          = case when p_account ? 'last4' then p_account->>'last4' else last4 end,
      rate           = case when p_account ? 'rate' then p_account->>'rate' else rate end,
      due_date       = case when p_account ? 'due_date' then (p_account->>'due_date')::date else due_date end,
      currency       = case when p_account ? 'currency' then p_account->>'currency' else currency end,
      archived_at    = case when p_account ? 'archived_at' then (p_account->>'archived_at')::timestamptz else archived_at end
    where id = v_id and user_id = v_uid;
  else
    if exists (select 1 from public.accounts x where x.id = v_id) then
      raise exception 'account id % is already in use', v_id using errcode = '23505';
    end if;
    insert into public.accounts (id, user_id, name, provider, provider_label, type, kind, last4, rate, due_date,
                                 currency, opening_balance, opening_date, archived_at)
    values (v_id, v_uid, p_account->>'name', coalesce(p_account->>'provider', 'other'),
            coalesce(p_account->>'provider_label', ''), p_account->>'type', coalesce(p_account->>'kind', ''),
            p_account->>'last4', p_account->>'rate', (p_account->>'due_date')::date,
            coalesce(p_account->>'currency', 'PHP'), coalesce((p_account->>'opening_balance')::numeric, 0),
            coalesce((p_account->>'opening_date')::timestamptz, now()), (p_account->>'archived_at')::timestamptz);
  end if;

  return (select to_jsonb(x) || jsonb_build_object('balance', b.balance)
            from public.accounts x join public.account_balances b on b.account_id = x.id
           where x.id = v_id and x.user_id = v_uid);
end $$;

-- ---------------------------------------------------------------------------
-- import_state (same mapping as 20261029000600_import_state.sql; every lookup user-scoped)
-- ---------------------------------------------------------------------------
create or replace function public.import_state(p_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.ledger_uid();
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
  insert into public.profiles (user_id, name, initials, income, frequency, side_income, monthly_budget,
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
               where k in (select c.code from public.categories c)), '{}'),
    coalesce((p_state->>'onboarded')::boolean, true))
  on conflict (user_id) do update set
    name = excluded.name, initials = excluded.initials, income = excluded.income,
    frequency = excluded.frequency, side_income = excluded.side_income,
    monthly_budget = excluded.monthly_budget, category_budgets = excluded.category_budgets,
    onboarded = excluded.onboarded
  where profiles.onboarded = false;
  v_tz := public.ledger_timezone(v_uid);

  -- accounts (opening balance is set after the entries are in) ------------------
  with ins as (
    insert into public.accounts (id, user_id, name, provider, provider_label, type, kind, last4, rate, due_date,
                                 opening_balance, legacy_id)
    select
      public.legacy_uuid(v_uid, 'account', a->>'id'), v_uid,
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
  insert into public.moves (id, user_id, kind, legacy_id)
  select public.legacy_uuid(v_uid, 'move', link), v_uid,
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
     and not exists (select 1 from public.moves m
                      where m.id = public.legacy_uuid(v_uid, 'move', x->>'linkId') and m.user_id = v_uid);

  -- entries -------------------------------------------------------------------
  with src as (
    select x, public.legacy_uuid(v_uid, 'entry', x->>'id') as id,
           round((x->>'amount')::numeric, 2) as amt,
           (select a.id from public.accounts a
             where a.user_id = v_uid and x->>'accountId' is not null
               and a.id = public.legacy_uuid(v_uid, 'account', x->>'accountId')) as account_id,
           (select c.code from public.categories c where c.code = x->>'category') as category_code,
           (select m.id from public.moves m
             where x->>'linkId' is not null and m.user_id = v_uid
               and m.id = public.legacy_uuid(v_uid, 'move', x->>'linkId')) as move_id
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
  insert into public.entries (id, user_id, account_id, category_code, amount, occurred_at, description, status,
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

  insert into public.entry_splits (id, user_id, entry_id, category_code, amount, items, position)
  select public.legacy_uuid(v_uid, 'split', (x->>'id') || ':' || s.ordinality), v_uid,
         public.legacy_uuid(v_uid, 'entry', x->>'id'),
         coalesce((select c.code from public.categories c where c.code = s.value->>'category'), 'Other'),
         round((s.value->>'amount')::numeric, 2),
         coalesce(array(select jsonb_array_elements_text(s.value->'items')), '{}'),
         s.ordinality::int
    from jsonb_array_elements(coalesce(p_state->'entries', '[]')) x
    cross join lateral jsonb_array_elements(coalesce(x->'split', '[]')) with ordinality s
   where round((s.value->>'amount')::numeric, 2) > 0
     and exists (select 1 from public.entries e
                  where e.id = public.legacy_uuid(v_uid, 'entry', x->>'id') and e.user_id = v_uid)
  on conflict (id) do nothing;

  insert into public.receipt_items (id, user_id, entry_id, name, amount, category_code, unsure, position)
  select public.legacy_uuid(v_uid, 'receipt_item', (x->>'id') || ':' || i.ordinality), v_uid,
         public.legacy_uuid(v_uid, 'entry', x->>'id'),
         coalesce(i.value->>'name', ''), greatest(round((i.value->>'amount')::numeric, 2), 0),
         (select c.code from public.categories c where c.code = i.value->>'category'),
         coalesce((i.value->>'unsure')::boolean, false), i.ordinality::int
    from jsonb_array_elements(coalesce(p_state->'entries', '[]')) x
    cross join lateral jsonb_array_elements(coalesce(x->'receipt'->'items', '[]')) with ordinality i
   where exists (select 1 from public.entries e
                  where e.id = public.legacy_uuid(v_uid, 'entry', x->>'id') and e.user_id = v_uid)
  on conflict (id) do nothing;

  -- opening balance of newly imported accounts: derived balance must equal Account.balance
  update public.accounts a set
    opening_balance = case when a.type = 'credit' then s.bal + coalesce(e.eff, 0) else s.bal - coalesce(e.eff, 0) end,
    opening_date = least(a.opening_date, coalesce(e.first_at, a.opening_date))
  from (select public.legacy_uuid(v_uid, 'account', x->>'id') as id, coalesce((x->>'balance')::numeric, 0) as bal
          from jsonb_array_elements(coalesce(p_state->'accounts', '[]')) x) s
  left join lateral (
    select sum(f.effect) as eff, min(f.occurred_at) as first_at
      from public.entry_facts f where f.account_id = s.id and f.user_id = v_uid
  ) e on true
  where a.id = s.id and a.user_id = v_uid and a.id = any(v_new_accounts);

  -- goals ---------------------------------------------------------------------
  insert into public.goals (id, user_id, name, saved, target, by_month, legacy_id)
  select public.legacy_uuid(v_uid, 'goal', g->>'id'), v_uid, coalesce(g->>'name', 'Goal'),
         coalesce((g->>'saved')::numeric, 0), coalesce((g->>'target')::numeric, 0),
         case when g->>'by' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then g->>'by' else '' end,
         g->>'id'
    from jsonb_array_elements(coalesce(v_prof->'goals', '[]')) g
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('goals', jsonb_build_object(
    'inserted', v_n, 'total', jsonb_array_length(coalesce(v_prof->'goals', '[]'))));

  -- holdings -> first investments account (only if it is the caller's) ---------
  select public.legacy_uuid(v_uid, 'account', a->>'id') into v_inv_account
    from jsonb_array_elements(coalesce(p_state->'accounts', '[]')) with ordinality as t(a, ord)
   where a->>'type' = 'investments'
     and exists (select 1 from public.accounts x
                  where x.id = public.legacy_uuid(v_uid, 'account', a->>'id') and x.user_id = v_uid)
   order by ord limit 1;

  if v_inv_account is null then
    if jsonb_array_length(coalesce(v_prof->'holdings', '[]')) > 0 then
      v_skipped := v_skipped || 'holdings: no investments account to attach them to'::text;
    end if;
    v_n := 0;
  else
    insert into public.holding_snapshots (id, user_id, account_id, as_of, symbol, name, qty, price, value, change_pct)
    select public.legacy_uuid(v_uid, 'holding', h->>'ticker'), v_uid, v_inv_account, now(),
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
      'accounts', coalesce((select jsonb_object_agg(a->>'id', public.legacy_uuid(v_uid, 'account', a->>'id'))
                              from jsonb_array_elements(coalesce(p_state->'accounts', '[]')) a), '{}'),
      'entries', coalesce((select jsonb_object_agg(x->>'id', public.legacy_uuid(v_uid, 'entry', x->>'id'))
                             from jsonb_array_elements(coalesce(p_state->'entries', '[]')) x), '{}'),
      'goals', coalesce((select jsonb_object_agg(g->>'id', public.legacy_uuid(v_uid, 'goal', g->>'id'))
                           from jsonb_array_elements(coalesce(v_prof->'goals', '[]')) g), '{}')));
end $$;

-- ---------------------------------------------------------------------------
-- Lock the money tables: read with RLS, write through the RPCs above only.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.entries, public.moves, public.entry_splits, public.receipt_items,
  public.accounts, public.balance_snapshots, public.holding_snapshots
from authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke insert, update, delete, truncate on
      public.entries, public.moves, public.entry_splits, public.receipt_items,
      public.accounts, public.balance_snapshots, public.holding_snapshots
    from anon;
  end if;
end $$;
