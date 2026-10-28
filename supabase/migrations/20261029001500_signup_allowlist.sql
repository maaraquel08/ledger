-- Sign-up lock (review finding K): only an allow-listed email may create an account.
-- Enforced in the database, so it holds even if "Allow new users to sign up" is switched back on.
-- To change who may sign up, see supabase/README.md §3 ("Who may sign up").

create table if not exists private.allowed_emails (
  email     text primary key check (email = lower(btrim(email))),
  added_at  timestamptz not null default now()
);
revoke all on private.allowed_emails from public;

insert into private.allowed_emails (email) values ('maaraquel24@ledger.local') on conflict do nothing;

create or replace function private.enforce_signup_allowlist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null
     or not exists (select 1 from private.allowed_emails a where a.email = lower(btrim(new.email))) then
    raise exception 'sign-ups are closed for this Ledger' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.enforce_signup_allowlist() from public;

drop trigger if exists ledger_signup_allowlist on auth.users;
create trigger ledger_signup_allowlist
  before insert or update of email on auth.users
  for each row execute function private.enforce_signup_allowlist();
