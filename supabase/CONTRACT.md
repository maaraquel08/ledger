# Ledger database contract

The reference the edge-function and client code is written against. Source of truth is
`supabase/migrations/` (tested in `tests/db/`, `npm test`). If this file and the SQL disagree,
the SQL wins and this file is the bug.

## Ground rules

- **Owner scoping.** Every user table has `user_id uuid not null default auth.uid()` and RLS
  `user_id = auth.uid()` (role `authenticated`). Never send `user_id` from the client.
- **Ids** are uuids made by the caller (`crypto.randomUUID()`). Re-sending the same id is safe:
  `post_entries` returns the existing row instead of creating a second one.
- **Writes go through RPCs** (`supabase.rpc(name, args)`). The money tables (`entries`, `moves`,
  `entry_splits`, `receipt_items`, `accounts`, `balance_snapshots`, `holding_snapshots`) and the
  quota tables (`chat_usage`, `capture_usage`) are **select-only** for `authenticated`: a direct
  insert/update/delete fails with `42501 permission denied` (migrations 001200, 001300). Only
  `profiles`, `goals`, `recurring_items`, `account_aliases`, `rules`, `corrections` (insert only),
  `raw_inputs`, `insights`, `push_subscriptions`, `notification_log`, `fx_rates` are written directly.
- **Money** is `numeric(14,2)`. Through PostgREST, numeric **columns** arrive as JSON numbers;
  numbers inside **jsonb** RPC results are JSON numbers. Entry `amount` is signed:
  negative = money out (`brain/rules/rule-signed-money.md`).
- **Balances are never stored.** Read `account_balances`. There is no way to overwrite a balance:
  report it (`report_balance`), then close any gap with `record_adjustment`.
- **Status.** `posted` | `review` | `void`. An entry missing `account_id` or `category_code` is
  forced to `review` on save. `review` entries are real money: they count in metrics and, when they
  have an account, in its balance. `void` entries count nowhere. Nothing is automatically promoted
  back to `posted`: send `status: "posted"` in `update_entry` when the Owner resolves it.
- **Timezone.** Metric periods are half-open `[start, end)` `timestamptz`. Send ISO strings with an
  offset (`2026-10-01T00:00:00+08:00`) or get them from `period_bounds`. Functions that need "today"
  use `profiles.timezone` (default `Asia/Manila`).
- **Service role** (cron / `insights-run`): `auth.uid()` is null, so every read RPC takes an optional
  last parameter `p_user uuid` naming the Owner. A signed-in caller passing someone else's id gets
  error `42501`. Write RPCs have no `p_user`: call them with the Owner's JWT.
- **Facts.** Every metric number is a *fact*: `{ "value": number|null, "entry_ids": uuid[] }`.
  `entry_ids` are the entries that produced the number; cite them, never recompute.

### Errors (Postgres SQLSTATE in `error.code`)

| code | when |
|---|---|
| `28000` | not authenticated (no JWT and no `p_user` under service role) |
| `42501` | `p_user` is not the caller; permission denied (e.g. anon) |
| `P0002` | entry / account / event not found (or not yours) |
| `22023` | bad argument (unknown patch key, bad status, refund on income, empty query, …) |
| `23505` | id already used by another user |
| `23514` | move legs do not sum to zero / do not share status |
| `23503` | foreign key: account, move or category does not exist for you |
| `40001` | `undo_event`: the entries changed after that event; undo the newer change first |

## Tables

`auth.users(id)` is the Owner. All `user_id` columns reference it `on delete cascade`.
Columns marked † have defaults and can be omitted.

### categories (global, read-only)
| column | type | notes |
|---|---|---|
| code | text pk | **exactly the TS `Category` string**, plus `'Adjustment'` |
| label | text | same as code today |
| kind | text | `expense` \| `income` \| `transfer` \| `invest` \| `adjustment` |
| is_spend | bool | negative unrefunded entry in this category is spending |
| is_fixed | bool | `Rent & bills`, `Subscriptions` (selectors.ts `FIXED`; never paced) |
| is_monthly | bool | `Rent & bills`, `Subscriptions`, `Groceries`, `Household` (today.ts `MONTHLY`) |
| sort | int | display order |

Seed: Food & drink, Groceries, Transport, Shopping, Rent & bills, Subscriptions, Gifts, Household,
Health, Other (`expense`, spend); Salary, Income (`income`); Investments (`invest`); Transfer
(`transfer`); Adjustment (`adjustment`). Only `expense` categories are spend.

### profiles (pk user_id)
`user_id`†, `name`† text, `initials`† text, `income`† numeric (per payday), `frequency`† text
(`Twice a month`|`Monthly`|`Weekly`|`Irregular`), `side_income`† jsonb (`SideIncome[]`),
`monthly_budget`† numeric (0 = suggested), `category_budgets`† jsonb `{ "<category code>": number }`,
`timezone`† text = `'Asia/Manila'`, `onboarded`† bool, `push_enabled`† bool = false,
`push_quiet_start`† time = 22:00, `push_quiet_end`† time = 07:00, `push_max_per_week`† int = 3 (0–3),
`created_at`†, `updated_at`†. Insert/update directly (`upsert` on `user_id`).

### accounts
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid† | |
| name | text | "Daily wallet" |
| provider | text† | `gcash`,`bpi`,`bdo`,`maya`,`maribank`,`rcbc`,`unionbank`,`ibkr`,`cash`,`other` |
| provider_label | text† | "GCash", "RCBC JCB" |
| type | text | `bank`\|`investments`\|`ewallet`\|`cash`\|`credit` |
| kind | text† | mono subtitle: SAVINGS, WALLET, … |
| last4 | text | 4 digits or null |
| rate | text | "4.5% p.a." |
| due_date | date | credit only |
| currency | text† | `PHP` |
| opening_balance | numeric† | display terms (credit = amount owed). Fixed after creation |
| opening_date | timestamptz† | informational; all entries count regardless of date |
| archived_at | timestamptz | archived accounts are excluded from `net_worth` |
| legacy_id | text | localStorage id when imported |
| created_at, updated_at | timestamptz† | |

### account_aliases
`id`, `user_id`†, `account_id` (cascade), `alias` (unique per user, case-insensitive), `created_at`†.
The capture gate resolves an account only by exact alias.

### moves
`id` uuid pk, `user_id`†, `kind` `transfer`|`invest`, `legacy_id`, `created_at`†.
Created by `post_entries`; legs are the `entries` with that `move_id`.

### entries
| column | type | notes |
|---|---|---|
| id | uuid pk | client-generated |
| user_id | uuid† | |
| account_id | uuid null | must be one of your accounts; account deletion sets null (→ review) |
| category_code | text null | FK categories.code; null = needs category (still spend if negative) |
| amount | numeric(14,2) | signed, ≠ 0 |
| currency | text† | `PHP` |
| occurred_at | timestamptz† | `Entry.date` |
| description | text† | `Entry.desc` |
| merchant | text | normalised merchant, optional |
| status | text† | `posted`\|`review`\|`void` |
| review_question | text | the one targeted question for Review |
| refunded_at | timestamptz | non-null = refunded. Only `amount < 0` and not a move leg |
| move_id | uuid | the move this leg belongs to |
| raw_input_id | uuid | FK raw_inputs |
| raw | text | `Entry.raw`, what the Owner typed/said |
| source | text | `voice`\|`receipt`\|null |
| created_by | text† | `owner`\|`claude`\|`rule` |
| rule_id | uuid | the learned rule that filed it |
| auto | bool† | auto-debit |
| method | text | "Contactless" |
| receipt_image_path | text | `<user_id>/<file>` in bucket `receipts` |
| legacy_id | text | localStorage id when imported |
| created_at, updated_at | timestamptz† | |

Invariants (enforced): missing account or category ⇒ `review`; legs of a move share one status
(changing one changes all, which is how `void_entry` cascades); live (non-void) legs of a move sum
to zero, checked at commit.

### entry_splits / receipt_items
- `entry_splits`: `id`, `user_id`†, `entry_id` (cascade), `category_code`, `amount` (> 0),
  `items` text[], `position` int. Spend is counted per split when an entry has splits.
- `receipt_items`: `id`, `user_id`†, `entry_id` (cascade), `name`, `amount` (≥ 0), `category_code`
  (null ok), `unsure` bool, `position` int.
Write both through `post_entries` / `update_entry` (`splits`, `receipt_items` arrays).

### raw_inputs
`id`, `user_id`†, `kind` `text`|`voice`|`photo`, `text`, `storage_path` (`<user_id>/<file>`),
`transcript`, `model`, `parsed` jsonb, `gate` jsonb, `created_at`†. Insert directly (capture function).

### balance_snapshots / holding_snapshots / fx_rates
- `balance_snapshots`: `id`, `user_id`†, `account_id`, `as_of`†, `reported` (display terms; credit = owed),
  `raw_input_id`, `created_at`†. Write with `report_balance`.
- `holding_snapshots`: `id`, `user_id`†, `account_id` (investments), `as_of`†, `symbol`, `name`†,
  `qty` numeric(20,6), `price` numeric(20,6), `value` numeric(14,2) (market value in `currency`),
  `change_pct`, `currency`† `PHP`, `created_at`†. The latest `as_of` per account is "current holdings".
  Write with `report_holdings`.
- `fx_rates`: pk (`user_id`†, `currency`, `as_of` date), `rate_to_php`. Latest rate is used.

### Knowledge base
- `goals`: `id`, `user_id`†, `name`, `saved`†, `target`, `by_month`† (`'YYYY-MM'` or `''`),
  `archived_at`, `legacy_id`, `created_at`†, `updated_at`†.
- `recurring_items`: `id`, `user_id`†, `description`, `merchant`, `category_code`, `account_id`,
  `amount` (signed), `cadence` `monthly`|`weekly`, `day_of_month` (monthly, 1–31, clamped to month
  end), `weekday` (weekly, 0 = Sunday), `starts_on`† date, `active`†, timestamps†.
- `rules`: `id`, `user_id`†, `match` jsonb, `set` jsonb, `hits`† int, `source_correction_id`,
  `active`† bool, `last_hit_at`, timestamps†. Shapes of `match`/`set` are owned by the capture function.
- `corrections` (append-only: insert + select only): `id`, `user_id`†, `entry_id`, `raw_input_id`,
  `before` jsonb, `after` jsonb, `created_at`†. `entry_id` is a soft reference (no FK since
  migration 001400): it keeps the id after the entry is deleted, e.g. by an undo.

### entry_events (append-only, written only by trigger; select only)
`id` uuid, `seq` bigint (global order), `user_id`, `batch_id` (one per transaction = one RPC call),
`entry_id`, `op` `insert`|`update`|`void`|`refund`|`delete`, `before` jsonb (row before),
`after` jsonb (row after), `reverts_batch_id` (set on events written by `undo_event`), `actor`
(auth.uid() or null), `created_at`.

### insights / push_subscriptions / notification_log
- `insights`: `id`, `user_id`†, `kind` `daily`|`weekly`|`monthly`|`alert`|`answer`, `period_start`,
  `period_end`, `fingerprint` (unique per user+kind — use `detect_anomalies` fingerprints for
  alerts), `metrics` jsonb (the facts used), `narrative` text, `cited_entry_ids` uuid[], `stale`†,
  `read_at`, `dismissed_at`, `pushed_at`, `created_at`†. Service role must set `user_id` explicitly.
- `push_subscriptions`: `id`, `user_id`†, `endpoint` (unique), `p256dh`, `auth`, `user_agent`,
  `created_at`†, `last_used_at`.
- `notification_log`: `id`, `user_id`†, `insight_id`, `channel`† `push`, `status`
  `sent`|`skipped`|`failed`, `reason`, `sent_at`†. Count `sent` rows in the last 7 days for the
  3-per-week limit.

## Views (read-only, caller's RLS applies)

| view | columns |
|---|---|
| `entry_facts` | entry columns `id, user_id, account_id, category_code, amount, currency, occurred_at, description, merchant, status, refunded_at, move_id` + `category_kind`, `affects_balance` bool, `effect` numeric (amount, or 0 if void/refunded/no account), `is_spend` bool, `is_income` bool |
| `spend_parts` | `entry_id, user_id, occurred_at, category_code, amount` (positive; splits, or `coalesce(category,'Other')`) |
| `account_balances` | `account_id, user_id, name, type, currency, opening_balance, archived_at, balance, entry_count, last_entry_at` — `balance` = opening + Σeffect, **credit: opening − Σeffect (amount owed)** |
| `reconciliation` | `account_id, user_id, name, type, snapshot_id, as_of, reported, derived, gap` — latest snapshot per account; `derived` = balance counting entries with `occurred_at <= as_of`; `gap = reported − derived` |
| `investment_values` | `account_id, user_id, derived_balance, holdings_as_of, holdings_value, fx_missing, market_value` — latest holdings (in PHP) + effects after that snapshot; derived balance if no holdings |
| `net_worth` | `user_id, cash, invested, credit_owed, total` — `cash` = bank+ewallet+cash balances, `invested` = Σ market_value, `total = cash + invested − credit_owed`; archived accounts excluded |

Spending / income (selectors.ts, with the `is_spend` flag):
`is_spend = status≠void ∧ amount<0 ∧ refunded_at is null ∧ (category null ∨ category.is_spend)`;
`is_income = status≠void ∧ amount>0 ∧ (category null ∨ kind ∉ {transfer, invest, adjustment})`.

## RPCs

The write RPCs (`post_entries`, `update_entry`, `void_entry`, `mark_refunded`, `undo_event`,
`report_balance`, `record_adjustment`, `report_holdings`, `upsert_account`, `import_state`,
`erase_my_data`, `chat_quota_take`, `capture_quota_take`) are `security definer` with
`search_path = ''`: they are the only way to write the locked tables, act only for `ledger_uid()`
and filter every row by it. Read and metric RPCs are `security invoker` (RLS applies). All are
granted to `authenticated` and `service_role`, not to `anon`.
Call as `supabase.rpc('<name>', { p_x: … })`.

### Mutation result
Returned by `post_entries`, `update_entry`, `void_entry`, `mark_refunded`, `record_adjustment`:
```json
{ "batch_id": "uuid|null", "undo_event_id": "uuid|null", "entries": [EntryJson, ...] }
```
`undo_event_id` → pass to `undo_event` for the Undo toast. Null when nothing changed.

**EntryJson** = every `entries` column + `move_kind` (`transfer`|`invest`|null) +
`splits: [{category_code, amount, items}]` + `receipt_items: [{name, amount, category_code, unsure}]`.
Also available as `entry_json(p_id uuid) → jsonb` (null if not found).

### post_entries(p_entries jsonb) → mutation result + `{created: uuid[], existing: uuid[]}`
One object or an array, all-or-nothing. Each element (only `amount` required):
```json
{ "id": "uuid", "account_id": "uuid|null", "category_code": "Transport|null", "amount": -248,
  "currency": "PHP", "occurred_at": "2026-10-29T08:42:00+08:00", "description": "Grab",
  "merchant": "Grab", "status": "posted|review", "review_question": null,
  "raw_input_id": null, "raw": "grab gcash 248", "source": "voice|receipt|null",
  "created_by": "owner|claude|rule", "rule_id": null, "auto": false, "method": null,
  "receipt_image_path": null,
  "move_id": "uuid", "move_kind": "transfer|invest",
  "splits": [{"category_code": "Groceries", "amount": 1000, "items": ["rice"]}],
  "receipt_items": [{"name": "rice", "amount": 600, "category_code": "Groceries", "unsure": false}] }
```
- Legs: give every leg the same `move_id`; `move_kind` defaults to `invest` when the category is
  `Investments`, else `transfer`. Legs must sum to zero (error `23514`).
- Replay with the same ids: nothing is created, `existing` lists them, and `undo_event_id` points at
  the original insert. Splits/items on a replay are ignored.

Example (real output, trimmed):
```json
{ "created": ["9f1e2d3c-…"], "existing": [], "batch_id": "b8843e3e-…",
  "undo_event_id": "530f7fb9-…",
  "entries": [{ "id": "9f1e2d3c-…", "account_id": "5d2f7e90-…", "category_code": "Transport",
    "amount": -248, "currency": "PHP", "occurred_at": "2026-10-29T00:42:00+00:00",
    "description": "Grab", "merchant": "Grab", "status": "posted", "review_question": null,
    "refunded_at": null, "move_id": null, "move_kind": null, "raw": "grab gcash 248",
    "source": null, "created_by": "owner", "auto": false, "method": null,
    "splits": [], "receipt_items": [], "...": "other columns" }] }
```

### update_entry(p_id uuid, p_patch jsonb) → mutation result
Patch keys (any subset): `account_id, category_code, amount, currency, occurred_at, description,
merchant, status (posted|review), review_question, method, auto, source, raw, receipt_image_path,
splits, receipt_items` (arrays replace). Any other key → `22023`. On a two-leg move, `amount` and
`occurred_at` are mirrored onto the other leg (it gets `-amount`); `entries` then holds both legs.
Setting a voided move leg back to `posted` revives both legs.

### void_entry(p_id uuid) → mutation result
Sets `void`; the other leg(s) of a move follow. Idempotent. Entries are never deleted by the app.

### mark_refunded(p_id uuid, p_refunded boolean default true) → mutation result
Expenses only (`amount < 0`, not a move leg). Refunded = no balance effect, not spend (D-0009).
`false` un-refunds.

### undo_event(p_event_id uuid) → jsonb
Reverts the whole batch the event belongs to (both legs; a void and its cascade; an import):
insert → deleted, update/void/refund → restored to the state before the batch, delete → re-inserted.
```json
{ "batch_id": "uuid", "reverted_batch_id": "uuid", "already_undone": false,
  "entries": [EntryJson], "deleted_ids": ["uuid"] }
```
Twice → `already_undone: true`, nothing changes. Undoing an undo → `22023`. If a later,
not-undone change touched the same entries → `40001`. Restores entry columns only (splits/items of
an updated entry are not rolled back).

### report_balance(p_account_id uuid, p_reported numeric, p_as_of timestamptz default now(), p_raw_input_id uuid default null, p_id uuid default null) → jsonb
Records a snapshot only; never edits entries. `p_reported` in display terms (credit = owed).
```json
{ "snapshot_id": "uuid", "account_id": "uuid", "as_of": "2026-10-29T05:00:00+00:00",
  "reported": 23500, "derived": 23652, "gap": -152 }
```

### record_adjustment(p_account_id uuid, p_amount numeric default null, p_note text default null, p_id uuid default null) → mutation result + `{adjusted, gap_before, gap_after}`
`p_amount` null: closes the latest snapshot's gap with one `Adjustment` entry dated at that snapshot
(credit: amount = −gap). `p_amount` given: a signed `Adjustment` entry dated now. `Adjustment` is
never spend or income. Gap already 0 → `{adjusted: false, entries: []}`. Same `p_id` twice → replay.
```json
{ "adjusted": true, "gap_before": -152, "gap_after": 0, "batch_id": "…", "undo_event_id": "…",
  "entries": [{ "category_code": "Adjustment", "amount": -152, "description": "Balance adjustment",
                "occurred_at": "2026-10-29T05:00:00+00:00", "...": "…" }] }
```

### report_holdings(p_account_id uuid, p_holdings jsonb, p_as_of timestamptz default now()) → jsonb
`p_holdings`: `[{symbol, name?, qty, price?, value?, change_pct?, currency?}]` (give `price` or
`value`; the other is derived). Returns `{account_id, as_of, holdings: [holding_snapshots row], market_value}`.

### upsert_account(p_account jsonb) → account row + `{balance}`
Keys = `accounts` columns (`id` optional on create). On update only keys present change;
changing `opening_balance` → `22023` (use report_balance + record_adjustment). Archive with
`{"id": …, "archived_at": "<now>"}`.

### import_state(p_state jsonb) → jsonb
Takes the app's `LedgerState` JSON as-is (camelCase, `src/lib/types.ts`). Idempotent; never
overwrites existing cloud rows (a profile is filled only while `onboarded = false`).
```json
{ "accounts": {"inserted": 6, "total": 6}, "entries": {"inserted": 712, "total": 712},
  "moves": {"inserted": 0}, "goals": {"inserted": 3, "total": 3},
  "holdings": {"inserted": 4, "total": 4}, "skipped": [],
  "id_map": { "accounts": {"a-bpi": "uuid"}, "entries": {"e1": "uuid"}, "goals": {"g1": "uuid"} } }
```
Mapping: non-uuid legacy ids → `legacy_uuid(user, kind, id)` (md5-based, per user); uuid ids are
kept. `Account.balance` → `opening_balance` chosen so the derived balance equals it. `linkId` groups
of ≥ 2 legs summing to 0 → one move (otherwise imported unlinked and listed in `skipped`).
Unknown category → null (review). `refunded` → `refunded_at = date`. `split` → `entry_splits`,
`receipt.items` → `receipt_items` (`receipt.image` is not imported; upload it to Storage and set
`receipt_image_path`). `profile.goals` → goals, `profile.holdings` → holding_snapshots on the first
investments account. `queued`, `demo`, `questionsToday` are dropped.

### Metric functions (read-only)

`period_bounds(p_period text, p_anchor timestamptz default now(), p_user uuid default null)` —
`p_period` `day|week|month|year` (weeks start Monday) in the Owner's timezone:
`{"period":"month","timezone":"Asia/Manila","start":"2026-09-30T16:00:00+00:00","end":"2026-10-31T16:00:00+00:00"}`

`metrics_period(p_start timestamptz, p_end timestamptz, p_user uuid default null)`:
```json
{ "start": "…", "end": "…", "currency": "PHP",
  "income": {"value": 60000, "entry_ids": ["…"]},
  "spend": {"value": 24865, "entry_ids": ["…"]},
  "net": {"value": 35135, "entry_ids": ["income ids", "spend ids"]},
  "savings_rate": {"value": 59, "entry_ids": ["…"]},
  "invested": {"value": 8000, "entry_ids": ["negative Investments legs"]},
  "entry_count": {"value": 16, "entry_ids": ["every non-void entry in the period"]},
  "by_category": [{"category_code": "Rent & bills", "value": 18500, "share_pct": 74.4, "entry_ids": ["…"]}],
  "top_merchants": [{"merchant": "Rent", "value": 18500, "count": 1, "entry_ids": ["…"]}] }
```
`savings_rate` = round(net / income × 100), integer, JS rounding; `null` without income.
`by_category` sorted by value desc, split receipts counted per split. `top_merchants`: top 5 spend
groups by `merchant`, else `description` (case-insensitive).

`spend_by_category(p_start, p_end, p_user default null)` → the `by_category` array.

`compare_periods(p_start, p_end, p_prev_start default null, p_prev_end default null, p_user default null)`
— previous defaults to the same length immediately before:
```json
{ "current": metrics_period, "previous": metrics_period,
  "delta": {"income": {"value": 0, "pct": null}, "spend": {"value": 24465, "pct": 6116.3}, "net": {…}},
  "by_category": [{"category_code": "Rent & bills", "current": fact, "previous": fact, "delta": 18500}] }
```
`pct` is null when the previous value is 0. `by_category` sorted by |delta| desc.

`entries_matching(p_query text, p_start default null, p_end default null, p_limit int default 50, p_user default null)`
— substring or trigram word-similarity ≥ 0.6 over description, merchant, category and raw text:
```json
{ "query": "grab", "count": fact, "total": fact (signed sum), "spend": fact, "income": fact,
  "entries": [{"id","occurred_at","description","merchant","amount","category_code","account_id","status","score"}],
  "truncated": false }
```
Totals cover all matches; `entries` is the top `p_limit` by score.

`goal_progress(p_user default null)` →
`[{"goal_id","name","saved","target","remaining","pct","by_month","months_left","needed_per_month"}]`
(`months_left` counts this month and the target month; `null` fields when the goal has no date).

`today_budget(p_now timestamptz default now(), p_user default null)` — exact port of
`src/lib/today.ts` (D-0006; parity tested in four timezones):
```json
{ "has_budget": true, "budget": 63000, "budget_source": "profile|suggested",
  "date": "2026-10-29", "timezone": "Asia/Manila",
  "left": {"value": 20752, "entry_ids": ["before ∪ today"]},
  "allowance": {"value": 21000, "entry_ids": ["spent before today"]},
  "tomorrow": {"value": 31376, "entry_ids": ["all month spend"]},
  "tomorrow_date": "2026-10-30",
  "spent_before": {"value": 0, "entry_ids": []},
  "spent_today": {"value": 248, "entry_ids": ["…"]},
  "days_left": 3 }
```
or `{"has_budget": false}`. TS ↔ SQL: `left`, `allowance`, `tomorrow`, `spentBefore`,
`spentToday`, `daysLeft`, `budget` are the `.value` of the same-named keys.

`detect_anomalies(p_now timestamptz default now(), p_user default null)`:
```json
{ "as_of": "…", "anomalies": [
  {"kind": "category_spike", "severity": "warn", "fingerprint": "category_spike:Health:2026-10",
   "facts": {"category_code": "Health", "current": fact, "trailing_avg": fact, "ratio": 4.0}, "entry_ids": ["…"]},
  {"kind": "recurring_missed", "severity": "warn", "fingerprint": "recurring_missed:<item id>:2026-10-08",
   "facts": {"recurring_item_id": "…", "description": "Netflix", "amount": -549, "due_on": "2026-10-08", "days_late": 7}, "entry_ids": []},
  {"kind": "reconciliation_gap", "severity": "warn", "fingerprint": "reconciliation_gap:<snapshot id>",
   "facts": {"account_id": "…", "name": "Daily wallet", "as_of": "…", "reported": 23500, "derived": 23652, "gap": -152}, "entry_ids": []},
  {"kind": "likely_duplicate", "severity": "info", "fingerprint": "likely_duplicate:<id a>:<id b>",
   "facts": {"amount": -185, "first_id": "…", "second_id": "…"}, "entry_ids": ["…", "…"]} ] }
```
Rules: spike = month-to-date category spend > 1.5 × trailing 3-full-month average and ≥ ₱1,000
above it. Recurring = last due date > 3 days ago with no matching entry (same category, amount
within ±50%, similar text) since 3 days before it. Gap = latest snapshot gap ≠ 0. Duplicate = same
amount and account, same or similar text (trigram ≥ 0.6), ≤ 48 h apart, both in the last 14 days,
not move legs, not refunded. Empty `anomalies` is a valid answer.

Helpers also exposed: `ledger_uid(p_user)`, `legacy_uuid(user, kind, legacy)`, `js_round(x)`,
`ledger_fact(value, ids)`, `ledger_timezone(user)`, `monthly_income(p_user)`, `snapshot_gap(id)`,
`mutation_result(ids)`, `current_batch_id()`, `set_entry_details(...)` (internal; don't call).

## TypeScript ↔ rows

| `src/lib/types.ts` | Database |
|---|---|
| `Account.id` | `accounts.id` (uuid; legacy id in `legacy_id`) |
| `Account.name / provider / providerLabel / type / kind / last4 / rate` | same, snake_case |
| `Account.balance` | `account_balances.balance` (read only; credit = owed) |
| `Account.dueDate` (ISO) | `accounts.due_date` (date) |
| `Entry.id` | `entries.id` |
| `Entry.desc` | `entries.description` |
| `Entry.accountId` | `entries.account_id` |
| `Entry.category` | `entries.category_code` (same strings) |
| `Entry.amount` | `entries.amount` (signed) |
| `Entry.date` | `entries.occurred_at` |
| `Entry.raw / method / auto / source` | `raw / method / auto / source` |
| `Entry.refunded` | `refunded_at is not null` |
| `Entry.queued` | — (client-only offline flag) |
| `Entry.linkId` | `entries.move_id` (+ `move_kind`) |
| `Entry.split[]` | `entry_splits` / EntryJson `splits` (`category` → `category_code`) |
| `Entry.receipt.items[]` | `receipt_items` / EntryJson `receipt_items` |
| `Entry.receipt.image` | `entries.receipt_image_path` (Storage `receipts/<uid>/…`) |
| needs Review (category or account null) | `entries.status = 'review'` |
| deleted entry | `status = 'void'` (`void_entry`) |
| `Profile.name / initials / income / frequency` | `profiles` same |
| `Profile.sideIncome` | `profiles.side_income` (jsonb, same shape) |
| `Profile.monthlyBudget / categoryBudgets` | `monthly_budget / category_budgets` |
| `Profile.goals[]` (`saved, target, by`) | `goals` (`saved, target, by_month`) |
| `Profile.holdings[]` (`ticker, name, shares, value, change`) | latest `holding_snapshots` (`symbol, name, qty, value, change_pct`) |
| `LedgerState.onboarded` | `profiles.onboarded` |
| `netWorth(accounts)` | `net_worth` view |
| `todayBudget()` | `today_budget()` |
| `totals()` / `byCategory()` | `metrics_period()` / `spend_by_category()` |

## Storage

Buckets `receipts` (images, 10 MB) and `voice` (audio, 25 MB), both private. Object names must
start with the Owner's id: `<auth.uid()>/<anything>`; policies allow select/insert/update/delete
only inside your own folder. Read with signed URLs.

## Cron

`private.invoke_insights(kind)` posts `{"kind": "daily"|"weekly"|"monthly"|"alerts"}` to
`<project_url>/functions/v1/insights-run` with `Authorization: Bearer <service_role_key>` (both
from Vault). Schedules (UTC): daily `0 13 * * *` (21:00 PHT), weekly `0 12 * * 0` (Sun 20:00),
monthly `5 12 * * 0` but only when the Manila day-of-month ≤ 7 (first Sunday), alerts `0 * * * *`.
`insights-run` runs once for all owners: list them with `select user_id from profiles`, then call
the metric RPCs with `p_user`.

## Added after the first contract (migrations 001000, 001100)

- `erase_my_data() → jsonb` (security definer, Owner JWT only): deletes every row the signed-in
  Owner has in every user table and returns `{table: deleted_count}`; keeps `auth.users`. The
  app removes the Owner's Storage objects (`receipts/<uid>/*`, `voice/<uid>/*`) separately.
  `corrections` stays append-only except inside this call.
- `chat_usage (user_id, day, count, updated_at)`, owner may select only (001300); written by `chat_quota_take`.
- `chat_quota_take(p_limit int, p_user uuid default null) → {allowed, used, limit, day}`: counts
  one chat question against the Owner-local day; nothing is counted once the limit is reached.
- `capture_checks(p_amount, p_merchant, p_category, p_at default now(), p_exclude uuid[] default '{}', p_user default null) → {duplicate, median}`:
  `duplicate` = the nearest non-void entry with the same signed amount and a similar merchant
  within 48 h (or null); `median` = `{category_code, value, sample}`, value null when sample < 3.

## Added by the review fixes (migrations 001200–001500)

- **001200** write RPCs → `security definer`, `search_path = ''`; INSERT/UPDATE/DELETE on the money
  tables revoked from `anon`/`authenticated`. `set_entry_details` is no longer executable by
  `authenticated`. `ledger_uid(p_user)` decides "service role may name the user" on the role the
  request runs as (`role` setting, else `session_user`), not `current_user`, so it stays correct
  inside definer functions. `post_entries` refuses a `move_id` owned by someone else (`23505`) and
  drops a `rule_id` that isn't the caller's; `report_balance` refuses another user's `p_id` (`23505`).
- **001300** `capture_usage (user_id, day, count, updated_at)`, owner select only;
  `capture_quota_take(p_limit int, p_user uuid default null) → {allowed, used, limit, day}`
  (same semantics as `chat_quota_take`, used by `/capture`, default 200/day).
- **001400** `corrections.entry_id` FK dropped (undo of a corrected entry no longer hits the
  append-only guard).
- **001500** `private.allowed_emails(email)` + trigger `ledger_signup_allowlist` (before insert or
  update of email on `auth.users`): any other email fails with `42501 sign-ups are closed`.
  Seeded with the Owner. See `README.md` §3.
