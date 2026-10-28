-- ---------------------------------------------------------------------------
-- QA A: mark_refunded refuses anything but a plain expense. 001200 already refused
-- money in and move legs; an Adjustment (or a lone Transfer/Investments entry) could
-- still be refunded, which changes a balance without anything having happened.
-- Mirrors src/lib/entry-rules.ts canRefund(). Un-refunding stays allowed.
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
  if p_refunded and (
       e.amount >= 0
    or e.move_id is not null
    or exists (select 1 from public.categories c
                where c.code = e.category_code and c.kind in ('transfer', 'invest', 'adjustment'))
  ) then
    raise exception 'only an expense can be refunded' using errcode = '22023';
  end if;
  update public.entries
     set refunded_at = case when p_refunded then coalesce(refunded_at, now()) end
   where id = p_id and user_id = v_uid;
  return public.mutation_result(array[p_id]);
end $$;

-- ---------------------------------------------------------------------------
-- QA B: the live legs of a move sit in different accounts. A transfer from an
-- account to itself is not a move. Same checks as 000300 plus that one.
-- ---------------------------------------------------------------------------
create or replace function private.entries_check_move() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m uuid;
  s numeric;
  n_status int;
  n int;
  n_live int;
  n_accounts int;
begin
  for m in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.move_id end,
      case when tg_op <> 'DELETE' then new.move_id end
    ]) as x where x is not null
  loop
    select coalesce(sum(amount) filter (where status <> 'void'), 0), count(distinct status), count(*),
           count(account_id) filter (where status <> 'void'),
           count(distinct account_id) filter (where status <> 'void')
      into s, n_status, n, n_live, n_accounts
      from public.entries where move_id = m;
    if n > 0 and s <> 0 then
      raise exception 'move %: live legs must sum to zero (sum is %)', m, s using errcode = '23514';
    end if;
    if n_status > 1 then
      raise exception 'move %: legs must share one status', m using errcode = '23514';
    end if;
    if n_accounts < n_live then
      raise exception 'move %: legs must be in different accounts', m using errcode = '23514';
    end if;
  end loop;
  return null;
end $$;
