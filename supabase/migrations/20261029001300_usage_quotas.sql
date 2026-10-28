-- Daily usage quotas for the AI edge functions (review findings G and H).
--   chat_usage     (existing) questions per Owner-local day   -> chat_quota_take
--   capture_usage  (new)      captures per Owner-local day    -> capture_quota_take
-- Both tables are readable by their owner and writable only through the quota RPCs, which are
-- security definer (search_path = '') and act for ledger_uid() (the caller, or the user a
-- service-role caller names). Before this, chat_usage had an owner_all policy, so a signed-in
-- user could reset their own counter with a direct update.

-- ---------------------------------------------------------------------------
-- chat_usage: select-only for the owner
-- ---------------------------------------------------------------------------
drop policy if exists owner_all on public.chat_usage;
create policy owner_read on public.chat_usage for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.chat_usage from authenticated;

-- ---------------------------------------------------------------------------
-- capture_usage
-- ---------------------------------------------------------------------------
create table public.capture_usage (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null,
  count       int not null default 0 check (count >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.capture_usage enable row level security;
create policy owner_read on public.capture_usage for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.capture_usage from authenticated;

-- ---------------------------------------------------------------------------
-- private.quota_take: shared body, run only from the definer wrappers below. p_kind picks the table ('chat' | 'capture').
-- Atomically counts one use against today's limit (Owner's timezone). When the limit is
-- already reached nothing is counted and allowed = false.
-- ---------------------------------------------------------------------------
create or replace function private.quota_take(p_kind text, p_uid uuid, p_limit int) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_day date := (now() at time zone public.ledger_timezone(p_uid))::date;
  v_count int;
begin
  if p_limit is null or p_limit < 0 then
    raise exception 'limit must be >= 0' using errcode = '22023';
  end if;
  if p_kind = 'chat' then
    insert into public.chat_usage as u (user_id, day, count)
    select p_uid, v_day, 1 where p_limit > 0
    on conflict (user_id, day) do update set count = u.count + 1, updated_at = now() where u.count < p_limit
    returning u.count into v_count;
    if v_count is null then
      select u.count into v_count from public.chat_usage u where u.user_id = p_uid and u.day = v_day;
    else
      return jsonb_build_object('allowed', true, 'used', v_count, 'limit', p_limit, 'day', v_day);
    end if;
  elsif p_kind = 'capture' then
    insert into public.capture_usage as u (user_id, day, count)
    select p_uid, v_day, 1 where p_limit > 0
    on conflict (user_id, day) do update set count = u.count + 1, updated_at = now() where u.count < p_limit
    returning u.count into v_count;
    if v_count is null then
      select u.count into v_count from public.capture_usage u where u.user_id = p_uid and u.day = v_day;
    else
      return jsonb_build_object('allowed', true, 'used', v_count, 'limit', p_limit, 'day', v_day);
    end if;
  else
    raise exception 'unknown quota %', p_kind using errcode = '22023';
  end if;
  return jsonb_build_object('allowed', false, 'used', coalesce(v_count, 0), 'limit', p_limit, 'day', v_day);
end $$;
revoke all on function private.quota_take(text, uuid, int) from public;

-- chat_quota_take(p_limit, p_user) -> {allowed, used, limit, day}   (same signature as before)
create or replace function public.chat_quota_take(p_limit int, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return private.quota_take('chat', public.ledger_uid(p_user), p_limit);
end $$;

-- capture_quota_take(p_limit, p_user) -> {allowed, used, limit, day}
create or replace function public.capture_quota_take(p_limit int, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return private.quota_take('capture', public.ledger_uid(p_user), p_limit);
end $$;

revoke all on function public.capture_quota_take(int, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.chat_quota_take(int, uuid) from anon;
    revoke all on function public.capture_quota_take(int, uuid) from anon;
    revoke all on function private.quota_take(text, uuid, int) from anon;
    revoke all on public.capture_usage from anon;
    revoke all on public.chat_usage from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function private.quota_take(text, uuid, int) from authenticated;
  end if;
end $$;
grant execute on function public.capture_quota_take(int, uuid) to authenticated, service_role;
