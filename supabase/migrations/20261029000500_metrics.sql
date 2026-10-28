-- Metric functions: every number Ledger or Claude shows comes from here.
-- A "fact" is always { "value": number|null, "entry_ids": [uuid, ...] }.
-- Periods are half-open [p_start, p_end). Pass timestamps with an offset
-- (e.g. '2026-10-01T00:00:00+08:00') or use period_bounds() to get them.
-- p_user: only for service-role callers (cron); signed-in callers act as themselves.
-- Void entries never count. Review entries count (they are real money).

create or replace function public.ledger_fact(p_value numeric, p_ids uuid[]) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('value', p_value, 'entry_ids', to_jsonb(coalesce(p_ids, '{}'::uuid[])))
$$;

create or replace function public.ledger_timezone(p_uid uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce((select p.timezone from public.profiles p where p.user_id = p_uid), 'Asia/Manila')
$$;

-- ---------------------------------------------------------------------------
-- period_bounds('day'|'week'|'month'|'year', anchor) in the Owner's timezone.
-- Weeks start Monday (selectors.ts weekBounds).
-- ---------------------------------------------------------------------------
create or replace function public.period_bounds(
  p_period text, p_anchor timestamptz default now(), p_user uuid default null
) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_tz text := ledger_timezone(v_uid);
  v_local timestamp := coalesce(p_anchor, now()) at time zone v_tz;
  v_start timestamp;
  v_step interval;
begin
  case p_period
    when 'day'   then v_start := date_trunc('day', v_local);   v_step := interval '1 day';
    when 'week'  then v_start := date_trunc('week', v_local);  v_step := interval '7 days';
    when 'month' then v_start := date_trunc('month', v_local); v_step := interval '1 month';
    when 'year'  then v_start := date_trunc('year', v_local);  v_step := interval '1 year';
    else raise exception 'period must be day, week, month or year' using errcode = '22023';
  end case;
  return jsonb_build_object(
    'period', p_period, 'timezone', v_tz,
    'start', v_start at time zone v_tz,
    'end', (v_start + v_step) at time zone v_tz);
end $$;

-- ---------------------------------------------------------------------------
-- spend_by_category: [{category_code, value, share_pct, entry_ids}] desc.
-- Split receipts count against each of their categories (selectors.ts byCategory).
-- ---------------------------------------------------------------------------
create or replace function public.spend_by_category(
  p_start timestamptz, p_end timestamptz, p_user uuid default null
) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
begin
  return coalesce((
    with parts as (
      select category_code, amount, entry_id from spend_parts
       where user_id = v_uid and occurred_at >= p_start and occurred_at < p_end
    ),
    g as (
      select category_code, sum(amount) as value, array_agg(distinct entry_id) as ids
        from parts group by category_code
    ),
    t as (select sum(value) as total from g)
    select jsonb_agg(jsonb_build_object(
             'category_code', g.category_code,
             'value', g.value,
             'share_pct', case when t.total > 0 then round(g.value / t.total * 100, 1) end,
             'entry_ids', to_jsonb(g.ids))
           order by g.value desc, g.category_code)
      from g cross join t
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- metrics_period: the headline numbers for any period.
-- {
--   start, end,
--   income, spend, net, invested, entry_count : fact,
--   savings_rate : fact (integer percent, null without income; = round(net/income*100)),
--   by_category  : spend_by_category(),
--   top_merchants: [{merchant, value, count, entry_ids}] top 5 by spend
-- }
-- ---------------------------------------------------------------------------
create or replace function public.metrics_period(
  p_start timestamptz, p_end timestamptz, p_user uuid default null
) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_income numeric; v_income_ids uuid[];
  v_spend numeric;  v_spend_ids uuid[];
  v_inv numeric;    v_inv_ids uuid[];
  v_all_ids uuid[];
  v_merchants jsonb;
begin
  select
    coalesce(sum(amount) filter (where is_income), 0),
    array_agg(id order by occurred_at, id) filter (where is_income),
    coalesce(sum(-amount) filter (where is_spend), 0),
    array_agg(id order by occurred_at, id) filter (where is_spend),
    coalesce(sum(-amount) filter (where category_kind = 'invest' and amount < 0), 0),
    array_agg(id order by occurred_at, id) filter (where category_kind = 'invest' and amount < 0),
    array_agg(id order by occurred_at, id)
  into v_income, v_income_ids, v_spend, v_spend_ids, v_inv, v_inv_ids, v_all_ids
  from entry_facts
  where user_id = v_uid and status <> 'void' and occurred_at >= p_start and occurred_at < p_end;

  select coalesce(jsonb_agg(jsonb_build_object('merchant', m.name, 'value', m.value, 'count', m.n, 'entry_ids', to_jsonb(m.ids))
                            order by m.value desc, m.name), '[]'::jsonb)
    into v_merchants
    from (
      select min(coalesce(nullif(btrim(merchant), ''), description)) as name,
             sum(-amount) as value, count(*) as n,
             array_agg(id order by occurred_at, id) as ids
        from entry_facts
       where user_id = v_uid and is_spend and occurred_at >= p_start and occurred_at < p_end
       group by lower(btrim(coalesce(nullif(btrim(merchant), ''), description)))
       order by sum(-amount) desc, 1
       limit 5
    ) m;

  return jsonb_build_object(
    'start', p_start, 'end', p_end, 'currency', 'PHP',
    'income', ledger_fact(v_income, v_income_ids),
    'spend', ledger_fact(v_spend, v_spend_ids),
    'net', ledger_fact(v_income - v_spend, coalesce(v_income_ids, '{}') || coalesce(v_spend_ids, '{}')),
    'savings_rate', ledger_fact(
      case when v_income > 0 then js_round((v_income - v_spend) / v_income * 100) end,
      coalesce(v_income_ids, '{}') || coalesce(v_spend_ids, '{}')),
    'invested', ledger_fact(v_inv, v_inv_ids),
    'entry_count', ledger_fact(coalesce(cardinality(v_all_ids), 0), v_all_ids),
    'by_category', spend_by_category(p_start, p_end, v_uid),
    'top_merchants', v_merchants);
end $$;

-- ---------------------------------------------------------------------------
-- compare_periods: current vs previous (default: the same length right before).
-- { current, previous : metrics_period,
--   delta: {income|spend|net: {value, pct}},
--   by_category: [{category_code, current: fact, previous: fact, delta}] }
-- ---------------------------------------------------------------------------
create or replace function public.compare_periods(
  p_start timestamptz, p_end timestamptz,
  p_prev_start timestamptz default null, p_prev_end timestamptz default null,
  p_user uuid default null
) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_ps timestamptz := coalesce(p_prev_start, p_start - (p_end - p_start));
  v_pe timestamptz := coalesce(p_prev_end, p_start);
  cur jsonb := metrics_period(p_start, p_end, v_uid);
  prev jsonb := metrics_period(v_ps, v_pe, v_uid);
  k text;
  v_delta jsonb := '{}';
  c numeric; p numeric;
begin
  foreach k in array array['income', 'spend', 'net'] loop
    c := (cur->k->>'value')::numeric;
    p := (prev->k->>'value')::numeric;
    v_delta := v_delta || jsonb_build_object(k, jsonb_build_object(
      'value', c - p,
      'pct', case when p <> 0 then round((c - p) / abs(p) * 100, 1) end));
  end loop;

  return jsonb_build_object(
    'current', cur, 'previous', prev, 'delta', v_delta,
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
               'category_code', code,
               'current', ledger_fact(coalesce(cv, 0), cids),
               'previous', ledger_fact(coalesce(pv, 0), pids),
               'delta', coalesce(cv, 0) - coalesce(pv, 0))
             order by abs(coalesce(cv, 0) - coalesce(pv, 0)) desc, code)
        from (
          select coalesce(a.code, b.code) as code, a.v as cv, a.ids as cids, b.v as pv, b.ids as pids
            from (select x->>'category_code' as code, (x->>'value')::numeric as v,
                         array(select jsonb_array_elements_text(x->'entry_ids'))::uuid[] as ids
                    from jsonb_array_elements(cur->'by_category') x) a
            full join (select x->>'category_code' as code, (x->>'value')::numeric as v,
                              array(select jsonb_array_elements_text(x->'entry_ids'))::uuid[] as ids
                         from jsonb_array_elements(prev->'by_category') x) b
              on a.code = b.code
        ) j
    ), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- entries_matching: fuzzy search (pg_trgm) over description, merchant, category, raw.
-- { query, count, total (signed sum), spend, income : fact,
--   entries: [{id, occurred_at, description, merchant, amount, category_code, account_id, status, score}],
--   truncated: bool }
-- ---------------------------------------------------------------------------
create or replace function public.entries_matching(
  p_query text, p_start timestamptz default null, p_end timestamptz default null,
  p_limit int default 50, p_user uuid default null
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
-- goal_progress: [{goal_id, name, saved, target, remaining, pct, by_month,
--                  months_left, needed_per_month}]
-- months_left counts the current month and the target month; null without a date.
-- ---------------------------------------------------------------------------
create or replace function public.goal_progress(p_user uuid default null) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_month date := date_trunc('month', now() at time zone ledger_timezone(v_uid))::date;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'goal_id', g.id, 'name', g.name, 'saved', g.saved, 'target', g.target,
             'remaining', greatest(g.target - g.saved, 0),
             'pct', case when g.target > 0 then js_round(least(g.saved / g.target, 1) * 100) end,
             'by_month', nullif(g.by_month, ''),
             'months_left', ml.n,
             'needed_per_month', case when ml.n is null then null
                                      else js_round(greatest(g.target - g.saved, 0) / greatest(ml.n, 1)) end)
           order by g.created_at, g.name)
      from goals g
      cross join lateral (
        select case when g.by_month = '' then null
                    else greatest(0,
                      (extract(year from to_date(g.by_month, 'YYYY-MM'))::int * 12 + extract(month from to_date(g.by_month, 'YYYY-MM'))::int)
                    - (extract(year from v_month)::int * 12 + extract(month from v_month)::int) + 1)
               end as n
      ) ml
     where g.user_id = v_uid and g.archived_at is null
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- today_budget: an exact port of src/lib/today.ts todayBudget() (D-0006), in the
-- Owner's timezone. Budget = profile.monthly_budget, else suggestedBudget(monthlyIncome).
-- { has_budget: false } or
-- { has_budget: true, budget, budget_source: 'profile'|'suggested', date, timezone,
--   left, allowance, tomorrow, spent_before, spent_today : fact,
--   tomorrow_date: 'YYYY-MM-DD', days_left }
-- ---------------------------------------------------------------------------
create or replace function public.monthly_income(p_user uuid default null) returns numeric
language sql stable set search_path = '' as $$
  select coalesce((
    select public.js_round(p.income * case p.frequency when 'Twice a month' then 2 when 'Weekly' then 4.33 else 1 end)
      from public.profiles p where p.user_id = public.ledger_uid(p_user)), 0)
$$;

create or replace function public.today_budget(p_now timestamptz default now(), p_user uuid default null) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_tz text := ledger_timezone(v_uid);
  v_now timestamptz := coalesce(p_now, now());
  v_local timestamp := v_now at time zone v_tz;
  v_today date := v_local::date;
  v_mstart date := date_trunc('month', v_local)::date;
  v_mend date := (date_trunc('month', v_local) + interval '1 month')::date;
  t_from timestamptz := v_mstart::timestamp at time zone v_tz;
  t_to timestamptz := v_mend::timestamp at time zone v_tz;
  t_today timestamptz := v_today::timestamp at time zone v_tz;
  t_tomorrow timestamptz := (v_today + 1)::timestamp at time zone v_tz;
  v_budget numeric;
  v_source text := 'profile';
  v_before numeric; v_before_ids uuid[];
  v_all numeric;    v_all_ids uuid[];
  v_today_spent numeric; v_today_ids uuid[];
  v_days int := v_mend - v_today;
  v_allow numeric;
  v_tomorrow numeric;
begin
  select monthly_budget into v_budget from profiles where user_id = v_uid;
  if coalesce(v_budget, 0) = 0 then
    v_source := 'suggested';
    v_budget := js_round(monthly_income(v_uid) * 0.656 / 1000) * 1000;
  end if;
  if coalesce(v_budget, 0) = 0 then
    return jsonb_build_object('has_budget', false);
  end if;

  select
    coalesce(sum(-amount) filter (where occurred_at < t_today), 0),
    array_agg(id order by occurred_at, id) filter (where occurred_at < t_today),
    coalesce(sum(-amount), 0),
    array_agg(id order by occurred_at, id)
  into v_before, v_before_ids, v_all, v_all_ids
  from entry_facts
  where user_id = v_uid and is_spend and occurred_at >= t_from and occurred_at < t_to;

  -- today's day-to-day spend: split parts, minus bills/groceries/household (is_monthly)
  select coalesce(sum(p.amount), 0), array_agg(distinct p.entry_id)
    into v_today_spent, v_today_ids
    from spend_parts p
    join categories c on c.code = p.category_code
   where p.user_id = v_uid and p.occurred_at >= t_today and p.occurred_at < t_tomorrow
     and p.occurred_at >= t_from and p.occurred_at < t_to
     and not c.is_monthly;

  v_allow := greatest(0, (v_budget - v_before) / greatest(1, v_days));
  v_tomorrow := case when v_days > 1 then greatest(0, js_round((v_budget - v_all) / (v_days - 1))) else 0 end;

  return jsonb_build_object(
    'has_budget', true,
    'budget', v_budget,
    'budget_source', v_source,
    'date', v_today,
    'timezone', v_tz,
    'left', ledger_fact(js_round(v_allow - v_today_spent), coalesce(v_before_ids, '{}') || coalesce(v_today_ids, '{}')),
    'allowance', ledger_fact(js_round(v_allow), v_before_ids),
    'tomorrow', ledger_fact(v_tomorrow, v_all_ids),
    'tomorrow_date', v_today + 1,
    'spent_before', ledger_fact(js_round(v_before), v_before_ids),
    'spent_today', ledger_fact(js_round(v_today_spent), v_today_ids),
    'days_left', greatest(1, v_days));
end $$;

-- ---------------------------------------------------------------------------
-- detect_anomalies: deterministic triggers that decide if anything is worth saying.
-- { as_of, anomalies: [{kind, fingerprint, severity, facts, entry_ids}] }
-- kinds:
--   category_spike      month-to-date spend in a category > 1.5x its trailing 3-month
--                       monthly average and at least PHP 1,000 above it
--   recurring_missed    an active recurring item's last due date is > 3 days ago and
--                       no matching entry was logged from 3 days before it
--   reconciliation_gap  latest reported balance differs from the derived balance
--   likely_duplicate    two entries, same amount and account, similar text, within 48h
--                       (looks back 14 days)
-- ---------------------------------------------------------------------------
create or replace function public.detect_anomalies(p_now timestamptz default now(), p_user uuid default null)
returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_tz text := ledger_timezone(v_uid);
  v_now timestamptz := coalesce(p_now, now());
  v_local timestamp := v_now at time zone v_tz;
  v_today date := v_local::date;
  v_mstart date := date_trunc('month', v_local)::date;
  t_mstart timestamptz := v_mstart::timestamp at time zone v_tz;
  t_trail timestamptz := (v_mstart - interval '3 months')::timestamp at time zone v_tz;
  v_out jsonb := '[]';
begin
  -- category_spike
  v_out := v_out || coalesce((
    with cur as (
      select category_code, sum(amount) as v, array_agg(distinct entry_id) as ids
        from spend_parts where user_id = v_uid and occurred_at >= t_mstart and occurred_at <= v_now
       group by category_code),
    trail as (
      select category_code, sum(amount) / 3 as avg, array_agg(distinct entry_id) as ids
        from spend_parts where user_id = v_uid and occurred_at >= t_trail and occurred_at < t_mstart
       group by category_code)
    select jsonb_agg(jsonb_build_object(
             'kind', 'category_spike',
             'fingerprint', 'category_spike:' || cur.category_code || ':' || to_char(v_mstart, 'YYYY-MM'),
             'severity', 'warn',
             'facts', jsonb_build_object(
               'category_code', cur.category_code,
               'current', ledger_fact(cur.v, cur.ids),
               'trailing_avg', ledger_fact(round(trail.avg, 2), trail.ids),
               'ratio', round(cur.v / trail.avg, 2)),
             'entry_ids', to_jsonb(cur.ids))
           order by cur.v - trail.avg desc)
      from cur join trail using (category_code)
     where trail.avg > 0 and cur.v > trail.avg * 1.5 and cur.v - trail.avg >= 1000
  ), '[]'::jsonb);

  -- recurring_missed
  v_out := v_out || coalesce((
    with due as (
      select r.*,
        case r.cadence
          when 'monthly' then (
            select case when d <= v_today then d
                        else make_date(extract(year from pm)::int, extract(month from pm)::int,
                               least(r.day_of_month, extract(day from (pm + interval '1 month - 1 day'))::int)) end
              from (select make_date(extract(year from v_mstart)::int, extract(month from v_mstart)::int,
                             least(r.day_of_month, extract(day from (v_mstart + interval '1 month - 1 day'))::int)) as d,
                           (v_mstart - interval '1 month')::date as pm) x)
          else v_today - ((extract(dow from v_today)::int - r.weekday + 7) % 7)
        end as last_due
      from recurring_items r
      where r.user_id = v_uid and r.active)
    select jsonb_agg(jsonb_build_object(
             'kind', 'recurring_missed',
             'fingerprint', 'recurring_missed:' || d.id || ':' || d.last_due,
             'severity', 'warn',
             'facts', jsonb_build_object(
               'recurring_item_id', d.id, 'description', d.description, 'amount', d.amount,
               'due_on', d.last_due, 'days_late', v_today - d.last_due),
             'entry_ids', '[]'::jsonb)
           order by d.last_due)
      from due d
     where d.last_due >= d.starts_on
       and v_today - d.last_due > 3
       and not exists (
         select 1 from entry_facts f
          where f.user_id = v_uid and f.status <> 'void'
            and f.occurred_at >= (d.last_due - 3)::timestamp at time zone v_tz
            and f.occurred_at <= v_now
            and (d.category_code is null or f.category_code = d.category_code)
            and abs(f.amount) between abs(d.amount) * 0.5 and abs(d.amount) * 1.5
            and (strpos(lower(f.description || ' ' || coalesce(f.merchant, '')), lower(d.description)) > 0
                 or word_similarity(lower(d.description), lower(f.description || ' ' || coalesce(f.merchant, ''))) >= 0.5))
  ), '[]'::jsonb);

  -- reconciliation_gap
  v_out := v_out || coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', 'reconciliation_gap',
             'fingerprint', 'reconciliation_gap:' || r.snapshot_id,
             'severity', 'warn',
             'facts', jsonb_build_object(
               'account_id', r.account_id, 'name', r.name, 'as_of', r.as_of,
               'reported', r.reported, 'derived', r.derived, 'gap', r.gap),
             'entry_ids', '[]'::jsonb)
           order by abs(r.gap) desc)
      from reconciliation r
     where r.user_id = v_uid and r.gap <> 0
  ), '[]'::jsonb);

  -- likely_duplicate
  v_out := v_out || coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', 'likely_duplicate',
             'fingerprint', 'likely_duplicate:' || a.id || ':' || b.id,
             'severity', 'info',
             'facts', jsonb_build_object('amount', a.amount, 'first_id', a.id, 'second_id', b.id),
             'entry_ids', jsonb_build_array(a.id, b.id))
           order by b.occurred_at desc)
      from entry_facts a
      join entry_facts b
        on b.user_id = a.user_id and a.id < b.id
       and b.amount = a.amount
       and b.account_id is not distinct from a.account_id
       and abs(extract(epoch from b.occurred_at - a.occurred_at)) <= 48 * 3600
     where a.user_id = v_uid
       and a.status <> 'void' and b.status <> 'void'
       and a.move_id is null and b.move_id is null
       and a.refunded_at is null and b.refunded_at is null
       and a.occurred_at >= v_now - interval '14 days' and a.occurred_at <= v_now
       and b.occurred_at >= v_now - interval '14 days' and b.occurred_at <= v_now
       and (lower(a.description || ' ' || coalesce(a.merchant, '')) = lower(b.description || ' ' || coalesce(b.merchant, ''))
            or similarity(lower(a.description || ' ' || coalesce(a.merchant, '')),
                          lower(b.description || ' ' || coalesce(b.merchant, ''))) >= 0.6)
  ), '[]'::jsonb);

  return jsonb_build_object('as_of', v_now, 'anomalies', v_out);
end $$;
