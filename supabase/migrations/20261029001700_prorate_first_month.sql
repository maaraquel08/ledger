-- ---------------------------------------------------------------------------
-- today_budget: the first month is prorated (QA #7). Onboarding on the 29th used to
-- spread a whole month's budget over three days. The month the ledger starts in now
-- gets budget x (days from the ledger's first day to month end) / days in month,
-- where the first day is the earliest non-void entry, or today when there is none.
-- Exact port of src/lib/selectors.ts monthBudget() + src/lib/today.ts todayBudget().
-- Adds full_budget and prorated_from ('YYYY-MM-DD' or null); budget is the month's.
-- ---------------------------------------------------------------------------
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
  v_full numeric;
  v_start date;
  v_prorated date;
begin
  select monthly_budget into v_budget from profiles where user_id = v_uid;
  if coalesce(v_budget, 0) = 0 then
    v_source := 'suggested';
    v_budget := js_round(monthly_income(v_uid) * 0.656 / 1000) * 1000;
  end if;
  if coalesce(v_budget, 0) = 0 then
    return jsonb_build_object('has_budget', false);
  end if;

  -- the month the ledger starts in is partial: prorate by the days from its first
  -- entry (or today, when nothing earlier is logged) to the end of the month
  v_full := v_budget;
  select least(v_today, min((occurred_at at time zone v_tz)::date))
    into v_start
    from entries
   where user_id = v_uid and status <> 'void';
  v_start := coalesce(v_start, v_today);
  if v_start > v_mstart then
    v_prorated := v_start;
    v_budget := js_round(v_full * (v_mend - v_start) / (v_mend - v_mstart));
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
    'full_budget', v_full,
    'prorated_from', v_prorated,
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
