# Ledger as a real CFO agent — design

Status: approved direction (Owner, 2026-10-29: "do what you recommend"). Calls marked *(Claude's call)* were made on the Owner's behalf after they asked not to be asked again.

## Intent

Ledger becomes the Owner's personal CFO. The UI stays light; the value is underneath: one trusted record of all money (source of truth), a clean data architecture, and an AI knowledge base Claude reasons over. Everything is logged by hand through chat, voice or camera. No bank connections.

The Owner wants:
1. Every account and investment, every entry, typed: income, expense, transfer, invest (+ refund).
2. Quick-glance analytics for the past week, month and year.
3. Tangible analysis — plain conclusions with numbers and the entries behind them, not just charts.
4. Proactive summaries and suggestions.
5. A consolidated view of all accounts (net worth).

## Non-goals and anti-goals

- Non-goals: bank/statement sync, moving money, specific stock advice, multiple users/households, budgeting rules engine beyond today's budgets and goals.
- Anti-goal: a number on screen or in a Claude sentence that disagrees with the database. If that happens the product has failed even if it "works".
- Anti-goal: an assistant that nags.

## Decided

| Area | Decision |
|---|---|
| Backend | Supabase: Postgres (source of truth), Auth (email magic link, single owner), Storage (private buckets for receipts/voice), Edge Functions (Deno), `pg_cron` + `pg_net` for schedules. |
| AI | Claude, server-side only (Edge Functions; keys in function secrets). Models: `claude-haiku-5-5` for text parsing and the daily one-liner, `claude-sonnet-5-5` for receipt vision, chat and weekly/monthly reviews. *(Claude's call)* |
| Voice | Claude doesn't take audio. Clip is recorded in the browser, uploaded to Storage, transcribed server-side by a pluggable STT provider (first implementation: OpenAI transcription, key `OPENAI_API_KEY`), then parsed as text. In local mode the existing Web Speech path remains. *(Claude's call)* |
| Capture policy | Save instantly with Undo when the **code-side confidence gate** passes; otherwise the entry lands in Review with one targeted question. Corrections become learned rules. |
| Numbers | Every number shown or cited is computed in SQL. Claude writes prose with fact placeholders; the server substitutes numbers; a validator rejects any digit in prose that didn't come from a fact. |
| Balances | Always derived from entries (opening balance + effects). Owner-reported balances are `balance_snapshots`; a gap is shown and closed only by an explicit Adjustment entry. Direct balance overwrite is removed. |
| Knowledge base | Plain tables (goals, recurring items, account aliases, rules, corrections, insights) + `pg_trgm`. No vector store. |
| Proactive | Daily one-liner (in-app only), Sunday weekly review, monthly close (first Sunday of month), anomaly alerts. Deterministic triggers decide if anything is worth saying before Claude is called. "Nothing to flag" is valid. |
| Notifications | In-app inbox (`insights` table) + Web Push for an installed PWA, only for the weekly review and material alerts; max 3 pushes/week; no amounts in push text; quiet hours 22:00–07:00 Asia/Manila; no email. *(Claude's call; reviewers split, 2 of 3 for push)* |
| UI | Three tabs: **Today** (M8 sentence + key number, period switch week/month/year with analysis cards, chat opens from here), **Money** (accounts + net worth on top, full typed ledger below with type filters; account detail = filtered ledger), **Review**. Add stays global. Insights and Budgets fold into Today; Scan becomes a capture mode only. |
| Modes | If `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are absent the app runs in **local mode** exactly as today (localStorage, regex parsers, canned chat). With them it runs in **cloud mode** (auth gate, Supabase data, Claude). Demo persona stays local-only. |
| Currency | ₱ primary, whole pesos in UI; `numeric(14,2)` in DB; `currency` column on entries/holdings + `fx_rates` for investments. |
| Brain | One new decision supersedes D-0001, D-0002, D-0011 and `rule-nothing-leaves-the-phone`, `rule-ai-is-rules`; new decisions for the IA change and notification limits (D-0008 follow-up). |

## Database contract (owned by `supabase/migrations`; full detail in `supabase/CONTRACT.md`)

All tables have `user_id uuid not null default auth.uid()` and RLS `user_id = auth.uid()`. IDs are `uuid`, generated client-side (`crypto.randomUUID()`) so retries are idempotent.

- `profiles` (user_id pk, name, initials, income, frequency, monthly_budget, category_budgets jsonb, timezone default 'Asia/Manila', push settings)
- `accounts` (id, name, provider, provider_label, type bank|investments|ewallet|cash|credit, kind, last4, rate, due_date, currency, opening_balance, opening_date, archived_at)
- `categories` (code pk, label, is_spend, kind) — seeded with the 14 existing categories + `Adjustment`
- `moves` (id, kind transfer|invest) — legs must sum to zero and share status (deferred constraint trigger)
- `entries` (id, account_id, category_code, amount signed, currency, occurred_at, description, merchant, status posted|review|void, review_question, refunded_at, move_id, raw_input_id, created_by owner|claude|rule, rule_id, auto, method, created_at, updated_at)
- `entry_splits` (entry_id, category_code, amount, items text[]), `receipt_items` (entry_id, name, amount, category_code, unsure)
- `raw_inputs` (id, kind text|voice|photo, text, storage_path, transcript, model, parsed jsonb, gate jsonb, created_at)
- `balance_snapshots` (account_id, as_of, reported, raw_input_id), `holding_snapshots` (account_id, as_of, symbol, name, qty, price, currency), `fx_rates`
- Knowledge base: `goals`, `recurring_items`, `account_aliases`, `rules` (match jsonb, set jsonb, hits, source_correction_id), `corrections` (append-only before/after)
- `entry_events` (append-only, trigger-written; backs undo and audit)
- `insights` (id, kind daily|weekly|monthly|alert|answer, period_start, period_end, fingerprint, metrics jsonb, narrative, cited_entry_ids uuid[], stale, read_at, dismissed_at, pushed_at)
- `push_subscriptions`, `notification_log`
- Views: `account_balances` (derived, credit sign flipped), `reconciliation` (derived vs latest snapshot), `net_worth` (cash + investments market value − credit owed).
- RPCs (security invoker): `post_entries(jsonb)` (one or many; atomic; legs → move), `update_entry`, `void_entry` (cascades to linked leg), `mark_refunded`, `undo_event`, `report_balance`, `record_adjustment`, `report_holdings`, `upsert_account`, `import_state(jsonb)` (one-time migration of localStorage state), and metric functions `metrics_period(start, end)`, `compare_periods`, `spend_by_category`, `entries_matching`, `goal_progress`, `today_budget` (mirrors `src/lib/today.ts`), `detect_anomalies`.

## Edge Function contract (owned by `supabase/functions`)

All require the Owner's JWT; all treat captured text as data, never instructions.

- `POST /capture` `{client_id, kind: "text"|"voice"|"photo", text?, storage_path?, tz}` → `{raw_input_id, entries: Entry[] (posted or review), gate: {passed, failed_check?, question?}, undo_event_id?}`
- `POST /chat` `{messages, tz}` → the existing `Answer` shape from `src/screens/chat.tsx` with numbers rendered from facts and `sources` = entry ids.
- `POST /insights-run` (cron, service role) `{kind: "daily"|"weekly"|"monthly"|"alerts"}` → writes `insights`, calls `notify` when warranted.
- `POST /notify` (internal) sends Web Push within the limits above.

Confidence gate (pure TS, unit tested): amount literally in input or receipt text; account resolved by exact alias; category from a learned rule or Claude agrees with the regex parser; date parses and is not in the future; no likely duplicate (same amount + merchant within 48h); amount ≤ 3× category median; `ambiguous_fields` empty.

## Builder's latitude

Component structure, file names inside the new folders, exact prompt wording, SQL style, test harness (PGlite + Vitest chosen because Docker isn't available here).

## Not verifiable here

No Supabase project, Anthropic key or STT key exists yet, and Docker isn't installed. SQL is tested in PGlite; functions' pure logic in Vitest; the app is verified in local mode. Deploying needs the Owner's credentials (see `supabase/README.md`).
