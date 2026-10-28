-- Entry invariants, audit trail and derived views.

-- ---------------------------------------------------------------------------
-- 1. An entry missing an account or a category is in Review (D-0005).
--    'posted' is demoted; 'review' and 'void' are left alone.
-- ---------------------------------------------------------------------------
create or replace function private.entries_normalize() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'posted' and (new.account_id is null or new.category_code is null) then
    new.status := 'review';
  end if;
  return new;
end $$;

create trigger entries_normalize before insert or update on public.entries
  for each row execute function private.entries_normalize();

-- ---------------------------------------------------------------------------
-- 2. Legs of a move share status: changing one (void, review, posted) changes all.
--    This is what makes void_entry and undo cascade to the other leg.
-- ---------------------------------------------------------------------------
create or replace function private.entries_sync_move_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.entries
     set status = new.status
   where move_id = new.move_id and id <> new.id and status <> new.status;
  return null;
end $$;

create trigger entries_sync_move_status after update of status on public.entries
  for each row when (new.move_id is not null and new.status is distinct from old.status)
  execute function private.entries_sync_move_status();

-- ---------------------------------------------------------------------------
-- 3. Deferred: at commit, live (non-void) legs of every touched move sum to zero
--    and all legs share one status.
-- ---------------------------------------------------------------------------
create or replace function private.entries_check_move() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m uuid;
  s numeric;
  n_status int;
  n int;
begin
  for m in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.move_id end,
      case when tg_op <> 'DELETE' then new.move_id end
    ]) as x where x is not null
  loop
    select coalesce(sum(amount) filter (where status <> 'void'), 0), count(distinct status), count(*)
      into s, n_status, n
      from public.entries where move_id = m;
    if n > 0 and s <> 0 then
      raise exception 'move %: live legs must sum to zero (sum is %)', m, s using errcode = '23514';
    end if;
    if n_status > 1 then
      raise exception 'move %: legs must share one status', m using errcode = '23514';
    end if;
  end loop;
  return null;
end $$;

create constraint trigger entries_check_move
  after insert or update or delete on public.entries
  deferrable initially deferred
  for each row execute function private.entries_check_move();

-- ---------------------------------------------------------------------------
-- 4. Audit: every change to an entry appends to entry_events.
--    batch_id = one per transaction, so one undo reverses one RPC call
--    (both legs of a transfer, a void and its cascade, an import).
-- ---------------------------------------------------------------------------
create or replace function public.current_batch_id() returns uuid
language sql volatile set search_path = '' as $$
  select md5('ledger-batch:' || txid_current()::text)::uuid
$$;

create or replace function private.entries_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_op text;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'INSERT' then
    v_op := 'insert'; v_after := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_op := 'delete'; v_before := to_jsonb(old);
  else
    v_before := to_jsonb(old); v_after := to_jsonb(new);
    if (v_before - 'updated_at') = (v_after - 'updated_at') then
      return null; -- no-op update leaves no trace
    end if;
    v_op := case
      when new.status = 'void' and old.status <> 'void' then 'void'
      when new.refunded_at is distinct from old.refunded_at then 'refund'
      else 'update'
    end;
  end if;

  insert into public.entry_events (user_id, batch_id, entry_id, op, before, after, reverts_batch_id, actor)
  values (
    coalesce(new.user_id, old.user_id),
    public.current_batch_id(),
    coalesce(new.id, old.id),
    v_op, v_before, v_after,
    nullif(current_setting('ledger.reverts_batch', true), '')::uuid,
    auth.uid()
  );
  return null;
end $$;

create trigger entries_audit after insert or update or delete on public.entries
  for each row execute function private.entries_audit();

-- corrections are append-only even for the table owner path through PostgREST
create or replace function private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create trigger corrections_append_only before update or delete on public.corrections
  for each row execute function private.forbid_change();
create trigger entry_events_append_only before update on public.entry_events
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Derived views (security_invoker: RLS of the caller applies)
-- ---------------------------------------------------------------------------

-- One row per entry with the money semantics of src/lib/selectors.ts + store.tsx:
--   effect     what it does to its account (0 when void, refunded or no account)
--   is_spend   amount < 0, not refunded, not void, category null or is_spend
--   is_income  amount > 0, not void, category null or not transfer/invest/adjustment
create view public.entry_facts with (security_invoker = true) as
select
  e.id, e.user_id, e.account_id, e.category_code, e.amount, e.currency, e.occurred_at,
  e.description, e.merchant, e.status, e.refunded_at, e.move_id,
  c.kind as category_kind,
  (e.status <> 'void' and e.refunded_at is null and e.account_id is not null) as affects_balance,
  case when e.status <> 'void' and e.refunded_at is null and e.account_id is not null
       then e.amount else 0 end as effect,
  (e.status <> 'void' and e.amount < 0 and e.refunded_at is null and coalesce(c.is_spend, true)) as is_spend,
  (e.status <> 'void' and e.amount > 0
     and coalesce(c.kind not in ('transfer', 'invest', 'adjustment'), true)) as is_income
from public.entries e
left join public.categories c on c.code = e.category_code;

-- What each spending entry cost per category: its splits, or (category ?? 'Other', -amount).
-- Mirrors selectors.ts spendParts().
create view public.spend_parts with (security_invoker = true) as
select f.id as entry_id, f.user_id, f.occurred_at, s.category_code, s.amount
  from public.entry_facts f
  join public.entry_splits s on s.entry_id = f.id
 where f.is_spend
union all
select f.id, f.user_id, f.occurred_at, coalesce(f.category_code, 'Other'), -f.amount
  from public.entry_facts f
 where f.is_spend and not exists (select 1 from public.entry_splits s where s.entry_id = f.id);

-- Balance = opening + effects; credit shows amount owed (sign flipped), as store.tsx applyBalance.
create view public.account_balances with (security_invoker = true) as
select
  a.id as account_id, a.user_id, a.name, a.type, a.currency, a.opening_balance, a.archived_at,
  case when a.type = 'credit'
       then a.opening_balance - coalesce(sum(f.effect), 0)
       else a.opening_balance + coalesce(sum(f.effect), 0) end as balance,
  count(f.id) filter (where f.affects_balance) as entry_count,
  max(f.occurred_at) filter (where f.affects_balance) as last_entry_at
from public.accounts a
left join public.entry_facts f on f.account_id = a.id
group by a.id;

-- Latest Owner-reported balance vs the derived balance at that same moment.
-- gap = reported - derived (display terms). Closed only by record_adjustment.
create view public.reconciliation with (security_invoker = true) as
select
  a.id as account_id, a.user_id, a.name, a.type,
  s.id as snapshot_id, s.as_of, s.reported, d.derived,
  s.reported - d.derived as gap
from public.accounts a
join lateral (
  select bs.* from public.balance_snapshots bs
   where bs.account_id = a.id
   order by bs.as_of desc, bs.created_at desc
   limit 1
) s on true
cross join lateral (
  select case when a.type = 'credit'
              then a.opening_balance - coalesce(sum(f.effect), 0)
              else a.opening_balance + coalesce(sum(f.effect), 0) end as derived
    from public.entry_facts f
   where f.account_id = a.id and f.occurred_at <= s.as_of
) d;

-- Investments: latest holdings snapshot (in PHP via latest fx rate) + money moved in/out since;
-- derived balance when no holdings were ever reported.
create view public.investment_values with (security_invoker = true) as
select
  b.account_id, b.user_id, b.balance as derived_balance,
  h.as_of as holdings_as_of, h.value_php as holdings_value, coalesce(h.fx_missing, false) as fx_missing,
  case when h.as_of is null then b.balance
       else h.value_php + coalesce((
         select sum(f.effect) from public.entry_facts f
          where f.account_id = b.account_id and f.occurred_at > h.as_of), 0)
  end as market_value
from public.account_balances b
left join lateral (
  select max(hs.as_of) as as_of,
         sum(hs.value * case when hs.currency = 'PHP' then 1 else coalesce(fx.rate_to_php, 1) end) as value_php,
         bool_or(hs.currency <> 'PHP' and fx.rate_to_php is null) as fx_missing
    from public.holding_snapshots hs
    left join lateral (
      select r.rate_to_php from public.fx_rates r
       where r.user_id = hs.user_id and r.currency = hs.currency
       order by r.as_of desc limit 1
    ) fx on true
   where hs.account_id = b.account_id
     and hs.as_of = (select max(x.as_of) from public.holding_snapshots x where x.account_id = b.account_id)
) h on true
where b.type = 'investments';

-- Net worth = cash + investments market value - credit owed (archived accounts excluded).
create view public.net_worth with (security_invoker = true) as
select user_id, cash, invested, credit_owed, cash + invested - credit_owed as total
from (
  select
    b.user_id,
    coalesce(sum(b.balance) filter (where b.type in ('bank', 'ewallet', 'cash')), 0) as cash,
    coalesce(sum(iv.market_value), 0) as invested,
    coalesce(sum(b.balance) filter (where b.type = 'credit'), 0) as credit_owed
  from public.account_balances b
  left join public.investment_values iv on iv.account_id = b.account_id
  where b.archived_at is null
  group by b.user_id
) t;
