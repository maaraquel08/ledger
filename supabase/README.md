# Ledger on Supabase

The cloud backend for Ledger's CFO agent: Postgres (the one record of all money), Auth (magic
link, single owner), Storage (receipts, voice clips), Edge Functions, and `pg_cron` schedules.
The app keeps running in **local mode** until `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set.

- `migrations/` — schema, rules, RPCs, metrics. Reference: [`CONTRACT.md`](./CONTRACT.md).
- `functions/` — edge functions (`capture`, `chat`, `insights-run`, `notify`).
- `config.toml` — local CLI config (email auth on).
- Tests: `npm test` loads every migration into PGlite (Postgres in WASM) and checks balances,
  transfers, undo, RLS, metrics and parity with `src/lib/today.ts`. No Docker needed.

## 1. Create the project

1. Sign in at <https://supabase.com/dashboard> → **New project**. Region: **Southeast Asia
   (Singapore)**. Save the database password in your password manager.
2. **Project Settings → API**: copy the **Project URL**, the **anon** key and the **service_role**
   key. The service role key bypasses all security: never put it in the app or in git.

## 2. Link and push the schema

Requires the Supabase CLI (`brew install supabase/tap/supabase`), from the repo root:

```sh
supabase login                                  # opens the browser
supabase link --project-ref <project-ref>       # the id in the project URL; asks for the DB password
supabase db push                                # applies supabase/migrations in order
```

`db push` also enables `pg_trgm`, `pg_cron` and `pg_net` and creates the private buckets
`receipts` and `voice`. Check the result in **Database → Tables** (RLS shows "enabled" on every table).

## 3. Auth: email magic link, one owner

**Authentication → Providers → Email**: enabled. **Authentication → URL Configuration**: set
**Site URL** to where the app runs (e.g. `https://ledger.example.com`) and add
`http://localhost:5173` to **Redirect URLs** for development.

Sign in once from the app with your email. Then, so nobody else can create an account:
**Authentication → Providers → Email → Allow new users to sign up: off** (or
**Authentication → Settings → Allow new users to sign up: off**).

### Owner login (username + password)

The app signs in with a username and password, not email links. Username `maaraquel24` maps to
`maaraquel24@ledger.local` (`src/lib/cloud/auth.tsx`); that address never receives mail. Create the
Owner once in **Authentication → Users → Add user → Create new user**: email
`maaraquel24@ledger.local`, a password only you know, **Auto Confirm User** on. To change the
password later: same screen → the user → **Reset password** is email-based, so instead use
**SQL Editor**: `update auth.users set encrypted_password = crypt('new password', gen_salt('bf')) where email = 'maaraquel24@ledger.local';`

### Who may sign up

The database also refuses every sign-up whose email is not in `private.allowed_emails`
(migrations `20261029001500_signup_allowlist.sql` and `20261029001600_username_login.sql`; the only
allowed address is `maaraquel24@ledger.local`, the username login), so the lock holds
even if the dashboard setting is switched back on. To change it, in **SQL Editor**:

```sql
insert into private.allowed_emails (email) values ('someone@example.com');  -- lower-case
delete from private.allowed_emails where email = 'someone@example.com';
select * from private.allowed_emails;
```

Changing an existing user's email to one that is not listed is refused too.

## 4. Secrets for the edge functions

```sh
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      # Claude, server-side only
supabase secrets set OPENAI_API_KEY=sk-...             # voice transcription
npx web-push generate-vapid-keys                       # prints a public and a private key
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions
automatically. The app needs the VAPID **public** key too (as `VITE_VAPID_PUBLIC_KEY`).

## 5. Vault secrets for the schedules

The cron jobs call the `insights-run` function through `pg_net`; they read two secrets from Vault.
In **SQL Editor**, run once (replace the values):

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service_role key>', 'service_role_key');
```

Until they exist each run logs a warning and does nothing. Check the schedules with
`select jobname, schedule from cron.job;` and runs with
`select * from cron.job_run_details order by start_time desc limit 20;`.

| job | UTC | Manila |
|---|---|---|
| `ledger-insights-daily` | `0 13 * * *` | every day 21:00 |
| `ledger-insights-weekly` | `0 12 * * 0` | Sunday 20:00 |
| `ledger-insights-monthly` | `5 12 * * 0` (runs only when day ≤ 7) | first Sunday 20:05 |
| `ledger-insights-alerts` | `0 * * * *` | hourly |

If `db push` reported "pg_cron / pg_net not available; schedules not created", enable both under
**Database → Extensions** and run `supabase/migrations/20261029000800_cron.sql` in the SQL Editor.

## 6. Deploy the functions

```sh
supabase functions deploy capture
supabase functions deploy chat
supabase functions deploy insights-run
supabase functions deploy notify
```

## 7. Point the app at the project

Create `.env.local` in the repo root (git-ignored):

```sh
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_VAPID_PUBLIC_KEY=<VAPID public key>
```

Run `npm run dev`, sign in, and accept the offer to move your on-phone ledger to the cloud
(`import_state`: safe to run twice; balances come across exactly).

## Changing the schema

Add a new file `supabase/migrations/<yyyymmddhhmmss>_<what>.sql` (never edit one that has been
pushed), update `CONTRACT.md`, run `npm test`, then `supabase db push`.
