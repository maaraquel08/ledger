-- Chat tools (M8): the largest entries, budget vs actual, and category-filtered search.
-- All security invoker (RLS-scoped through ledger_uid), like the metric functions in 0500.

-- ---------------------------------------------------------------------------
-- entries_matching gains p_category (exact category code, case-insensitive). A new trailing
-- parameter changes the signature, so the old one is dropped first; positional and named
-- calls that omit it behave as before.
-- ---------------------------------------------------------------------------
drop function if exists public.entries_matching(text, timestamptz, timestamptz, int, uuid);

create or replace function public.entries_matching(
  p_query text, p_start timestamptz default null, p_end timestamptz default null,
  p_limit int default 50, p_user uuid default null, p_category text default null
) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  q text := lower(btrim(coalesce(p_query, '')));
  v jsonb;
begin
  if q = '' then
    raise exception 'query is empty' using errcode = '22023';
  end if;
  with m as (
    select f.*, greatest(word_similarity(q, h.hay), similarity(q, h.hay),
                         case when strpos(h.hay, q) > 0 then 1 else 0 end) as score
      from entry_facts f
      join entries e on e.id = f.id
      cross join lateral (select lower(f.description || ' ' || coalesce(f.merchant, '') || ' '
                                       || coalesce(f.category_code, '') || ' ' || coalesce(e.raw, '')) as hay) h
     where f.user_id = v_uid and f.status <> 'void'
       and (p_start is null or f.occurred_at >= p_start)
       and (p_end is null or f.occurred_at < p_end)
       and (p_category is null or lower(f.category_code) = lower(btrim(p_category)))
       and (strpos(h.hay, q) > 0 or word_similarity(q, h.hay) >= 0.6)
  )
  select jsonb_build_object(
    'query', p_query,
    'count', ledger_fact(count(*), array_agg(id order by occurred_at desc, id)),
    'total', ledger_fact(coalesce(sum(amount), 0), array_agg(id order by occurred_at desc, id)),
    'spend', ledger_fact(coalesce(sum(-amount) filter (where is_spend), 0),
                         array_agg(id order by occurred_at desc, id) filter (where is_spend)),
    'income', ledger_fact(coalesce(sum(amount) filter (where is_income), 0),
                          array_agg(id order by occurred_at desc, id) filter (where is_income)),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'occurred_at', t.occurred_at, 'description', t.description, 'merchant', t.merchant,
               'amount', t.amount, 'category_code', t.category_code, 'account_id', t.account_id,
               'status', t.status, 'score', round(t.score::numeric, 3))
             order by t.score desc, t.occurred_at desc)
        from (select * from m order by score desc, occurred_at desc limit greatest(p_limit, 0)) t), '[]'::jsonb),
    'truncated', count(*) > greatest(p_limit, 0))
  into v from m;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- top_entries: the largest individual entries in [p_start, p_end).
-- p_kind 'spend' (is_spend, by amount paid) or 'income' (is_income); p_category optional
-- (exact code, case-insensitive); p_limit clamped to 1..20.
-- { kind, entries: [{id, occurred_at, description, merchant, amount, category_code,
--                    account_id, account_name, status}] largest first }
-- ---------------------------------------------------------------------------
create or replace function public.top_entries(
  p_start timestamptz, p_end timestamptz, p_kind text default 'spend',
  p_category text default null, p_limit int default 5, p_user uuid default null
) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_kind text := case when lower(coalesce(p_kind, 'spend')) = 'income' then 'income' else 'spend' end;
  v_n int := least(greatest(coalesce(p_limit, 5), 1), 20);
begin
  return jsonb_build_object('kind', v_kind, 'entries', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'occurred_at', t.occurred_at, 'description', t.description, 'merchant', t.merchant,
             'amount', t.amount, 'category_code', t.category_code, 'account_id', t.account_id,
             'account_name', t.account_name, 'status', t.status)
           order by abs(t.amount) desc, t.occurred_at desc, t.id)
      from (
        select f.id, f.occurred_at, f.description, f.merchant, f.amount, f.category_code, f.account_id,
               a.name as account_name, f.status
          from entry_facts f
          left join accounts a on a.id = f.account_id
         where f.user_id = v_uid
           and ((v_kind = 'spend' and f.is_spend) or (v_kind = 'income' and f.is_income))
           and f.occurred_at >= p_start and f.occurred_at < p_end
           and (p_category is null or lower(f.category_code) = lower(btrim(p_category)))
         order by abs(f.amount) desc, f.occurred_at desc, f.id
         limit v_n
      ) t), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- budget_status: budget vs actual for the month p_now falls in, and the savings rate of the
-- three full months before it.
-- { has_budget, month, budget, budget_source, spent, left,
--   categories: [{category_code, budget (null = none set), spent: fact, left}] spent desc,
--   savings: [{month, income, spend, savings_rate: fact}] most recent first }
-- budget/budget_source come from today_budget (profile budget or the suggested one, prorated
-- in the first month). Category budgets are profiles.category_budgets.
-- ---------------------------------------------------------------------------
create or replace function public.budget_status(p_now timestamptz default now(), p_user uuid default null)
returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_tz text := ledger_timezone(v_uid);
  v_local timestamp := coalesce(p_now, now()) at time zone v_tz;
  v_mstart timestamp := date_trunc('month', v_local);
  t_from timestamptz := v_mstart at time zone v_tz;
  t_to timestamptz := (v_mstart + interval '1 month') at time zone v_tz;
  v_tb jsonb := today_budget(coalesce(p_now, now()), v_uid);
  v_spent numeric; v_spent_ids uuid[];
  v_cats jsonb;
  v_sav jsonb := '[]'::jsonb;
  i int;
  s timestamp;
  mp jsonb;
begin
  select coalesce(sum(-amount), 0), array_agg(id order by occurred_at, id)
    into v_spent, v_spent_ids
    from entry_facts
   where user_id = v_uid and is_spend and occurred_at >= t_from and occurred_at < t_to;

  select coalesce(jsonb_agg(jsonb_build_object(
           'category_code', c.code,
           'budget', c.budget,
           'spent', ledger_fact(c.spent, c.ids),
           'left', case when c.budget is not null then c.budget - c.spent end)
         order by c.spent desc, c.code), '[]'::jsonb)
    into v_cats
    from (
      select coalesce(b.code, s.code) as code, b.budget, coalesce(s.spent, 0) as spent, s.ids
        from (select key as code, value::numeric as budget
                from profiles p, jsonb_each_text(p.category_budgets)
               where p.user_id = v_uid and value::numeric > 0) b
        full join (select category_code as code, sum(amount) as spent, array_agg(distinct entry_id) as ids
                     from spend_parts
                    where user_id = v_uid and occurred_at >= t_from and occurred_at < t_to
                    group by category_code) s on s.code = b.code
    ) c;

  for i in 1..3 loop
    s := v_mstart - make_interval(months => i);
    mp := metrics_period(s at time zone v_tz, (s + interval '1 month') at time zone v_tz, v_uid);
    v_sav := v_sav || jsonb_build_array(jsonb_build_object(
      'month', trim(to_char(s, 'FMMonth')),
      'income', mp->'income', 'spend', mp->'spend', 'savings_rate', mp->'savings_rate'));
  end loop;

  return jsonb_build_object(
    'has_budget', coalesce((v_tb->>'has_budget')::boolean, false),
    'month', trim(to_char(v_mstart, 'FMMonth')),
    'budget', v_tb->'budget',
    'budget_source', v_tb->'budget_source',
    'spent', ledger_fact(v_spent, v_spent_ids),
    'left', case when v_tb ? 'budget' then (v_tb->>'budget')::numeric - v_spent end,
    'categories', v_cats,
    'savings', v_sav);
end $$;

-- privileges: like 0900_grants.sql, which ran before these existed
revoke all on function public.entries_matching(text, timestamptz, timestamptz, int, uuid, text) from public;
revoke all on function public.top_entries(timestamptz, timestamptz, text, text, int, uuid) from public;
revoke all on function public.budget_status(timestamptz, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.entries_matching(text, timestamptz, timestamptz, int, uuid, text) from anon;
    revoke all on function public.top_entries(timestamptz, timestamptz, text, text, int, uuid) from anon;
    revoke all on function public.budget_status(timestamptz, uuid) from anon;
  end if;
end $$;
grant execute on function public.entries_matching(text, timestamptz, timestamptz, int, uuid, text) to authenticated, service_role;
grant execute on function public.top_entries(timestamptz, timestamptz, text, text, int, uuid) to authenticated, service_role;
grant execute on function public.budget_status(timestamptz, uuid) to authenticated, service_role;
