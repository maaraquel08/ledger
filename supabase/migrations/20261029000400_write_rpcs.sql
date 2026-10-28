-- Write RPCs. All security invoker (RLS applies) and all act for ledger_uid().
-- Every entry-changing RPC returns the same "mutation result":
--   { "batch_id": uuid|null, "undo_event_id": uuid|null, "entries": [entry_json, ...] }
-- undo_event_id is null when nothing changed (an idempotent replay returns the
-- original insert event instead).

-- ---------------------------------------------------------------------------
-- entry_json: one entry row + its move kind, splits and receipt items
-- ---------------------------------------------------------------------------
create or replace function public.entry_json(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(e) || jsonb_build_object(
    'move_kind', m.kind,
    'splits', coalesce((
      select jsonb_agg(jsonb_build_object('category_code', s.category_code, 'amount', s.amount, 'items', to_jsonb(s.items))
                       order by s.position, s.id)
        from public.entry_splits s where s.entry_id = e.id), '[]'::jsonb),
    'receipt_items', coalesce((
      select jsonb_agg(jsonb_build_object('name', r.name, 'amount', r.amount, 'category_code', r.category_code, 'unsure', r.unsure)
                       order by r.position, r.id)
        from public.receipt_items r where r.entry_id = e.id), '[]'::jsonb)
  )
  from public.entries e
  left join public.moves m on m.id = e.move_id
  where e.id = p_id
$$;

create or replace function public.mutation_result(p_ids uuid[]) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'batch_id', (select ev.batch_id from public.entry_events ev
                  where ev.batch_id = public.current_batch_id() limit 1),
    'undo_event_id', (select ev.id from public.entry_events ev
                       where ev.batch_id = public.current_batch_id() order by ev.seq limit 1),
    'entries', coalesce((
      select jsonb_agg(public.entry_json(x.id) order by x.ord)
        from (select distinct on (id) id, ord from unnest(p_ids) with ordinality as u(id, ord) order by id, ord) x
       where exists (select 1 from public.entries e where e.id = x.id)), '[]'::jsonb)
  )
$$;

-- replace an entry's splits / receipt items from a jsonb array
create or replace function public.set_entry_details(p_entry uuid, p_user uuid, p_splits jsonb, p_items jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  if p_splits is not null then
    delete from public.entry_splits where entry_id = p_entry;
    insert into public.entry_splits (user_id, entry_id, category_code, amount, items, position)
    select p_user, p_entry, s.value->>'category_code', (s.value->>'amount')::numeric,
           coalesce(array(select jsonb_array_elements_text(s.value->'items')), '{}'), s.ordinality::int
      from jsonb_array_elements(p_splits) with ordinality as s;
  end if;
  if p_items is not null then
    delete from public.receipt_items where entry_id = p_entry;
    insert into public.receipt_items (user_id, entry_id, name, amount, category_code, unsure, position)
    select p_user, p_entry, i.value->>'name', (i.value->>'amount')::numeric, i.value->>'category_code',
           coalesce((i.value->>'unsure')::boolean, false), i.ordinality::int
      from jsonb_array_elements(p_items) with ordinality as i;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- post_entries(jsonb): one entry object or an array. Atomic. Idempotent on id.
-- Entries sharing a move_id become one move (legs must sum to zero).
-- ---------------------------------------------------------------------------
create or replace function public.post_entries(p_entries jsonb) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
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
      insert into moves (id, user_id, kind)
      values (v_move, v_uid, coalesce(v->>'move_kind',
              case when v->>'category_code' = 'Investments' then 'invest' else 'transfer' end))
      on conflict (id) do nothing;
    end if;

    insert into entries (
      id, user_id, account_id, category_code, amount, currency, occurred_at, description, merchant,
      status, review_question, move_id, raw_input_id, raw, source, created_by, rule_id, auto, method,
      receipt_image_path)
    values (
      v_id, v_uid, (v->>'account_id')::uuid, v->>'category_code', (v->>'amount')::numeric,
      coalesce(v->>'currency', 'PHP'), coalesce((v->>'occurred_at')::timestamptz, now()),
      coalesce(v->>'description', ''), v->>'merchant', coalesce(v->>'status', 'posted'),
      v->>'review_question', v_move, (v->>'raw_input_id')::uuid, v->>'raw', v->>'source',
      coalesce(v->>'created_by', 'owner'), (v->>'rule_id')::uuid, coalesce((v->>'auto')::boolean, false),
      v->>'method', v->>'receipt_image_path')
    on conflict (id) do nothing;
    get diagnostics v_rows = row_count;

    if v_rows = 1 then
      v_created := v_created || v_id;
      perform set_entry_details(v_id, v_uid, v->'splits', v->'receipt_items');
    elsif exists (select 1 from entries where id = v_id and user_id = v_uid) then
      v_existing := v_existing || v_id;
    else
      raise exception 'entry id % is already in use', v_id using errcode = '23505';
    end if;
    v_all := v_all || v_id;
  end loop;

  set constraints public.entries_check_move immediate;

  v_result := mutation_result(v_all);
  if v_result->>'undo_event_id' is null then
    -- pure replay: point at the original insert so the client can still undo
    v_result := v_result || jsonb_build_object(
      'undo_event_id', (select ev.id from entry_events ev
                         where ev.entry_id = any(v_all) and ev.op = 'insert' and ev.user_id = v_uid
                         order by ev.seq limit 1));
  end if;
  return v_result || jsonb_build_object('created', to_jsonb(v_created), 'existing', to_jsonb(v_existing));
end $$;

-- ---------------------------------------------------------------------------
-- update_entry(id, patch). Patch keys (all optional): account_id, category_code,
-- amount, currency, occurred_at, description, merchant, status (posted|review),
-- review_question, method, auto, source, raw, receipt_image_path,
-- splits (replaces), receipt_items (replaces).
-- On a two-leg move, amount and occurred_at are mirrored onto the other leg.
-- ---------------------------------------------------------------------------
create or replace function public.update_entry(p_id uuid, p_patch jsonb) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
  e entries;
  v_bad text;
  v_ids uuid[];
begin
  select * into e from entries where id = p_id and user_id = v_uid for update;
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

  update entries set
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
  where id = p_id;

  perform set_entry_details(p_id, v_uid,
    case when p_patch ? 'splits' then coalesce(p_patch->'splits', '[]') end,
    case when p_patch ? 'receipt_items' then coalesce(p_patch->'receipt_items', '[]') end);

  v_ids := array[p_id];
  if e.move_id is not null then
    if (p_patch ? 'amount' or p_patch ? 'occurred_at')
       and (select count(*) from entries where move_id = e.move_id) = 2 then
      update entries o set
        amount      = case when p_patch ? 'amount' then -(p_patch->>'amount')::numeric else o.amount end,
        occurred_at = case when p_patch ? 'occurred_at' then (p_patch->>'occurred_at')::timestamptz else o.occurred_at end
      where o.move_id = e.move_id and o.id <> p_id;
    end if;
    v_ids := v_ids || array(select id from entries where move_id = e.move_id and id <> p_id order by id);
  end if;

  set constraints public.entries_check_move immediate;
  return mutation_result(v_ids);
end $$;

-- ---------------------------------------------------------------------------
-- void_entry: status void; the other leg of a move follows (trigger).
-- ---------------------------------------------------------------------------
create or replace function public.void_entry(p_id uuid) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
  e entries;
begin
  select * into e from entries where id = p_id and user_id = v_uid for update;
  if not found then
    raise exception 'entry % not found', p_id using errcode = 'P0002';
  end if;
  update entries set status = 'void' where id = p_id and status <> 'void';
  set constraints public.entries_check_move immediate;
  return mutation_result(array[p_id] || array(
    select id from entries where e.move_id is not null and move_id = e.move_id and id <> p_id order by id));
end $$;

-- ---------------------------------------------------------------------------
-- mark_refunded: expenses only (D-0009); refunded = no balance effect, not spend.
-- ---------------------------------------------------------------------------
create or replace function public.mark_refunded(p_id uuid, p_refunded boolean default true) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
  e entries;
begin
  select * into e from entries where id = p_id and user_id = v_uid for update;
  if not found then
    raise exception 'entry % not found', p_id using errcode = 'P0002';
  end if;
  if p_refunded and (e.amount >= 0 or e.move_id is not null) then
    raise exception 'only an expense can be refunded' using errcode = '22023';
  end if;
  update entries
     set refunded_at = case when p_refunded then coalesce(refunded_at, now()) end
   where id = p_id;
  return mutation_result(array[p_id]);
end $$;

-- ---------------------------------------------------------------------------
-- undo_event(event_id): reverses the whole batch the event belongs to
-- (insert -> delete, update/void/refund -> restore, delete -> re-insert).
-- Refuses an undo batch, and refuses when a later change touched the same entries.
-- Returns { batch_id, reverted_batch_id, already_undone, entries, deleted_ids }.
-- ---------------------------------------------------------------------------
create or replace function public.undo_event(p_event_id uuid) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
  ev entry_events;
  v_batch uuid;
  v_max bigint;
  r record;
  v_deleted uuid[] := '{}';
  v_touched uuid[] := '{}';
  v_moves uuid[] := '{}';
begin
  select * into ev from entry_events where id = p_event_id and user_id = v_uid;
  if not found then
    raise exception 'event % not found', p_event_id using errcode = 'P0002';
  end if;
  if ev.reverts_batch_id is not null then
    raise exception 'an undo cannot be undone' using errcode = '22023';
  end if;
  v_batch := ev.batch_id;

  if exists (select 1 from entry_events where reverts_batch_id = v_batch and user_id = v_uid) then
    return jsonb_build_object('batch_id', null, 'reverted_batch_id', v_batch, 'already_undone', true,
                              'entries', '[]'::jsonb, 'deleted_ids', '[]'::jsonb);
  end if;

  select max(seq) into v_max from entry_events where batch_id = v_batch;
  if exists (
    select 1 from entry_events x
     where x.user_id = v_uid and x.seq > v_max
       and x.entry_id in (select entry_id from entry_events where batch_id = v_batch)
       and x.reverts_batch_id is null
       and not exists (select 1 from entry_events u where u.reverts_batch_id = x.batch_id)
  ) then
    raise exception 'these entries changed since; undo the newer change first' using errcode = '40001';
  end if;

  perform set_config('ledger.reverts_batch', v_batch::text, true);

  -- the first event per entry in the batch holds the state from before the batch
  for r in
    select distinct on (entry_id) entry_id, op, before, after
      from entry_events where batch_id = v_batch
     order by entry_id, seq
  loop
    if r.op = 'insert' then
      v_moves := v_moves || (r.after->>'move_id')::uuid;
      delete from entries where id = r.entry_id;
      v_deleted := v_deleted || r.entry_id;
    elsif r.op = 'delete' then
      insert into entries select * from jsonb_populate_record(null::entries, r.before);
      v_touched := v_touched || r.entry_id;
    else
      update entries t set
        account_id = b.account_id, category_code = b.category_code, amount = b.amount, currency = b.currency,
        occurred_at = b.occurred_at, description = b.description, merchant = b.merchant, status = b.status,
        review_question = b.review_question, refunded_at = b.refunded_at, move_id = b.move_id,
        raw_input_id = b.raw_input_id, raw = b.raw, source = b.source, created_by = b.created_by,
        rule_id = b.rule_id, auto = b.auto, method = b.method, receipt_image_path = b.receipt_image_path,
        legacy_id = b.legacy_id
      from jsonb_populate_record(null::entries, r.before) b
      where t.id = r.entry_id;
      v_touched := v_touched || r.entry_id;
    end if;
  end loop;

  delete from moves m
   where m.user_id = v_uid and m.id = any(v_moves)
     and not exists (select 1 from entries e where e.move_id = m.id);

  set constraints public.entries_check_move immediate;

  return jsonb_build_object(
    'batch_id', public.current_batch_id(),
    'reverted_batch_id', v_batch,
    'already_undone', false,
    'entries', coalesce((select jsonb_agg(entry_json(t.id) order by t.id)
                           from unnest(v_touched) as t(id)
                          where exists (select 1 from entries e where e.id = t.id)), '[]'::jsonb),
    'deleted_ids', to_jsonb(v_deleted)
  );
end $$;

-- ---------------------------------------------------------------------------
-- report_balance: records what the Owner says the balance is. Never edits entries.
-- Returns { snapshot_id, account_id, as_of, reported, derived, gap }.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_gap(p_snapshot_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'snapshot_id', s.id, 'account_id', a.id, 'as_of', s.as_of, 'reported', s.reported,
    'derived', d.derived, 'gap', s.reported - d.derived)
  from public.balance_snapshots s
  join public.accounts a on a.id = s.account_id
  cross join lateral (
    select case when a.type = 'credit'
                then a.opening_balance - coalesce(sum(f.effect), 0)
                else a.opening_balance + coalesce(sum(f.effect), 0) end as derived
      from public.entry_facts f
     where f.account_id = a.id and f.occurred_at <= s.as_of
  ) d
  where s.id = p_snapshot_id
$$;

create or replace function public.report_balance(
  p_account_id uuid, p_reported numeric, p_as_of timestamptz default now(),
  p_raw_input_id uuid default null, p_id uuid default null
) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if not exists (select 1 from accounts where id = p_account_id and user_id = v_uid) then
    raise exception 'account % not found', p_account_id using errcode = 'P0002';
  end if;
  insert into balance_snapshots (id, user_id, account_id, as_of, reported, raw_input_id)
  values (v_id, v_uid, p_account_id, coalesce(p_as_of, now()), p_reported, p_raw_input_id)
  on conflict (id) do nothing;
  return snapshot_gap(v_id);
end $$;

-- ---------------------------------------------------------------------------
-- record_adjustment: the ONLY way to close a reconciliation gap.
-- p_amount null  -> closes the gap of the latest snapshot (dated at that snapshot).
-- p_amount given -> a signed entry of that amount, dated now.
-- Returns mutation result + { adjusted, gap_before, gap_after }.
-- ---------------------------------------------------------------------------
create or replace function public.record_adjustment(
  p_account_id uuid, p_amount numeric default null, p_note text default null, p_id uuid default null
) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
  a accounts;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_snap uuid;
  v_gap jsonb;
  v_amount numeric;
  v_at timestamptz := now();
begin
  select * into a from accounts where id = p_account_id and user_id = v_uid;
  if not found then
    raise exception 'account % not found', p_account_id using errcode = 'P0002';
  end if;

  if exists (select 1 from entries where id = v_id and user_id = v_uid) then
    return mutation_result(array[v_id]) || jsonb_build_object('adjusted', true, 'replay', true);
  end if;

  select id into v_snap from balance_snapshots where account_id = a.id order by as_of desc, created_at desc limit 1;
  if v_snap is not null then
    v_gap := snapshot_gap(v_snap);
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

  insert into entries (id, user_id, account_id, category_code, amount, occurred_at, description, status, created_by)
  values (v_id, v_uid, a.id, 'Adjustment', v_amount, v_at, coalesce(p_note, 'Balance adjustment'), 'posted', 'owner');

  return mutation_result(array[v_id]) || jsonb_build_object(
    'adjusted', true,
    'gap_before', v_gap->'gap',
    'gap_after', case when v_snap is not null then snapshot_gap(v_snap)->'gap' end);
end $$;

-- ---------------------------------------------------------------------------
-- report_holdings: a dated snapshot of an investments account's positions.
-- p_holdings: [{symbol, name?, qty, price?, value?, change_pct?, currency?}]
-- ---------------------------------------------------------------------------
create or replace function public.report_holdings(
  p_account_id uuid, p_holdings jsonb, p_as_of timestamptz default now()
) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
  v_at timestamptz := coalesce(p_as_of, now());
begin
  if not exists (select 1 from accounts where id = p_account_id and user_id = v_uid and type = 'investments') then
    raise exception 'investments account % not found', p_account_id using errcode = 'P0002';
  end if;
  insert into holding_snapshots (user_id, account_id, as_of, symbol, name, qty, price, value, change_pct, currency)
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
                   from holding_snapshots hs where hs.account_id = p_account_id and hs.as_of = v_at),
    'market_value', (select market_value from investment_values where account_id = p_account_id));
end $$;

-- ---------------------------------------------------------------------------
-- upsert_account: create, or patch by id. opening_balance is fixed once set:
-- fix a wrong balance with report_balance + record_adjustment.
-- Returns the account row + { balance }.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_account(p_account jsonb) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid();
  v_id uuid := coalesce((p_account->>'id')::uuid, gen_random_uuid());
  a accounts;
begin
  select * into a from accounts where id = v_id and user_id = v_uid for update;
  if found then
    if p_account ? 'opening_balance' and (p_account->>'opening_balance')::numeric is distinct from a.opening_balance then
      raise exception 'opening_balance is fixed; use report_balance and record_adjustment' using errcode = '22023';
    end if;
    update accounts set
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
    where id = v_id;
  else
    if exists (select 1 from accounts where id = v_id) then
      raise exception 'account id % is already in use', v_id using errcode = '23505';
    end if;
    insert into accounts (id, user_id, name, provider, provider_label, type, kind, last4, rate, due_date,
                          currency, opening_balance, opening_date, archived_at)
    values (v_id, v_uid, p_account->>'name', coalesce(p_account->>'provider', 'other'),
            coalesce(p_account->>'provider_label', ''), p_account->>'type', coalesce(p_account->>'kind', ''),
            p_account->>'last4', p_account->>'rate', (p_account->>'due_date')::date,
            coalesce(p_account->>'currency', 'PHP'), coalesce((p_account->>'opening_balance')::numeric, 0),
            coalesce((p_account->>'opening_date')::timestamptz, now()), (p_account->>'archived_at')::timestamptz);
  end if;

  return (select to_jsonb(x) || jsonb_build_object('balance', b.balance)
            from accounts x join account_balances b on b.account_id = x.id where x.id = v_id);
end $$;
