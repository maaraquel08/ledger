-- Support for the edge functions (supabase/functions/*):
--   chat_usage + chat_quota_take   server-side daily chat question limit (D-0016)
--   capture_checks                 the two data checks of the capture confidence gate (D-0013):
--                                  likely duplicate and "amount <= 3x category median"
-- Both RPCs are security invoker: RLS on the caller's own rows applies.

-- ---------------------------------------------------------------------------
-- chat_usage: questions asked per Owner-local day
-- ---------------------------------------------------------------------------
create table public.chat_usage (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null,
  count       int not null default 0 check (count >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.chat_usage enable row level security;
create policy owner_all on public.chat_usage for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- chat_quota_take(p_limit) -> {allowed, used, limit, day}
-- Atomically counts one question against today's limit (Owner's timezone). When the limit is
-- already reached nothing is counted and allowed = false.
create or replace function public.chat_quota_take(p_limit int, p_user uuid default null) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_day date := (now() at time zone ledger_timezone(v_uid))::date;
  v_count int;
begin
  if p_limit is null or p_limit < 0 then
    raise exception 'limit must be >= 0' using errcode = '22023';
  end if;
  insert into chat_usage as u (user_id, day, count)
  select v_uid, v_day, 1 where p_limit > 0
  on conflict (user_id, day) do update
    set count = u.count + 1, updated_at = now()
    where u.count < p_limit
  returning u.count into v_count;

  if v_count is null then
    select count into v_count from chat_usage where user_id = v_uid and day = v_day;
    return jsonb_build_object('allowed', false, 'used', coalesce(v_count, 0), 'limit', p_limit, 'day', v_day);
  end if;
  return jsonb_build_object('allowed', true, 'used', v_count, 'limit', p_limit, 'day', v_day);
end $$;

-- ---------------------------------------------------------------------------
-- capture_checks(amount, merchant, category, at) -> {
--   duplicate:  {id, occurred_at, description, merchant, amount} | null
--               same signed amount, same or similar merchant/description (equal, substring
--               or trigram word similarity >= 0.6), within 48 h of p_at, not void
--   median:     {category_code, value, sample}  value null when sample < 3
--               median |amount| of same-sign, non-void entries in that category over the
--               365 days before p_at (moves and refunded entries excluded)
-- }
-- p_exclude: entry ids to ignore (the capture's own ids on a replay).
-- ---------------------------------------------------------------------------
create or replace function public.capture_checks(
  p_amount numeric, p_merchant text, p_category text, p_at timestamptz default now(),
  p_exclude uuid[] default '{}', p_user uuid default null
) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_uid uuid := ledger_uid(p_user);
  v_at timestamptz := coalesce(p_at, now());
  q text := lower(btrim(coalesce(p_merchant, '')));
  v_dup jsonb;
  v_median numeric;
  v_sample int;
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'amount must be non-zero' using errcode = '22023';
  end if;

  if q <> '' then
    select jsonb_build_object('id', e.id, 'occurred_at', e.occurred_at, 'description', e.description,
                              'merchant', e.merchant, 'amount', e.amount)
      into v_dup
      from entries e
      cross join lateral (select lower(coalesce(e.merchant, '') || ' ' || e.description) as hay) h
     where e.user_id = v_uid and e.status <> 'void'
       and e.amount = p_amount
       and e.occurred_at between v_at - interval '48 hours' and v_at + interval '48 hours'
       and not (e.id = any(coalesce(p_exclude, '{}')))
       and (lower(coalesce(e.merchant, '')) = q or lower(e.description) = q
            or strpos(h.hay, q) > 0 or word_similarity(q, h.hay) >= 0.6)
     order by abs(extract(epoch from e.occurred_at - v_at)), e.id
     limit 1;
  end if;

  if p_category is not null then
    select percentile_cont(0.5) within group (order by abs(e.amount)), count(*)
      into v_median, v_sample
      from entries e
     where e.user_id = v_uid and e.status <> 'void'
       and e.category_code = p_category
       and sign(e.amount) = sign(p_amount)
       and e.move_id is null and e.refunded_at is null
       and e.occurred_at >= v_at - interval '365 days' and e.occurred_at < v_at
       and not (e.id = any(coalesce(p_exclude, '{}')));
  end if;

  return jsonb_build_object(
    'duplicate', v_dup,
    'median', case when p_category is null then null else jsonb_build_object(
      'category_code', p_category,
      'value', case when coalesce(v_sample, 0) >= 3 then round(v_median, 2) end,
      'sample', coalesce(v_sample, 0)) end);
end $$;

-- privileges: like 20261029000900_grants.sql, which ran before these existed
revoke all on function public.chat_quota_take(int, uuid) from public;
revoke all on function public.capture_checks(numeric, text, text, timestamptz, uuid[], uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.chat_quota_take(int, uuid) from anon;
    revoke all on function public.capture_checks(numeric, text, text, timestamptz, uuid[], uuid) from anon;
    revoke all on public.chat_usage from anon;
  end if;
end $$;
grant execute on function public.chat_quota_take(int, uuid) to authenticated, service_role;
grant execute on function public.capture_checks(numeric, text, text, timestamptz, uuid[], uuid) to authenticated, service_role;
