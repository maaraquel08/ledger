-- Chat history for the Home chat: one thread per conversation, its turns as messages.
-- Written by the chat edge function (the caller's JWT, so RLS applies); read and deleted by
-- the client directly. Owner only, like every user table (see core_schema).

create table public.chat_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.chat_threads (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  text        text not null,
  answer      jsonb,   -- the assistant turn's full Answer (marks, bars, followups...); null for user turns
  created_at  timestamptz not null default now()
);

create index chat_threads_user_updated on public.chat_threads (user_id, updated_at desc);
create index chat_messages_thread_created on public.chat_messages (thread_id, created_at);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
create policy owner_all on public.chat_threads  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- a message must also sit in one of the caller's own threads
create policy owner_all on public.chat_messages for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.chat_threads t where t.id = thread_id and t.user_id = auth.uid()));

create trigger touch before update on public.chat_threads for each row execute function private.touch_updated_at();

-- erase_my_data: same function as 20261029001000 with the chat tables added.
create or replace function public.erase_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_table text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform set_config('ledger.erasing', 'on', true);

  -- children before parents; entries before the rows they point at
  foreach v_table in array array[
    'notification_log', 'push_subscriptions', 'insights',
    'chat_messages', 'chat_threads',   -- messages before their thread (the FK would cascade anyway)
    'corrections',    -- before entries: their FK would otherwise update (set null) an append-only row
    'rules',
    'entry_splits', 'receipt_items', 'entries', 'moves',
    'balance_snapshots', 'holding_snapshots', 'fx_rates',
    'raw_inputs',
    'recurring_items', 'account_aliases', 'goals', 'accounts',
    'entry_events',   -- last: deleting entries above appends 'delete' events
    'profiles'
  ] loop
    execute format('delete from public.%I where user_id = $1', v_table) using v_uid;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  end loop;

  perform set_config('ledger.erasing', 'off', true);
  return jsonb_build_object('erased', true, 'deleted', v_counts);
end $$;

revoke all on function public.erase_my_data() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.erase_my_data() from anon;
  end if;
end $$;
grant execute on function public.erase_my_data() to authenticated;
