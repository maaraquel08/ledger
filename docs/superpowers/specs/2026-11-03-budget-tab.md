# Spec: Budget tab, budgets for every category, category CRUD

Status: approved 2026-11-03 (Owner answers below). Owner request: "remove budget and goals from Analytics, put the Budget in another tab, do the core feature for budget. It should reflect all categories, more detailed. Add CRUD for categories under Budget."

## Objective
A **Budget** tab that answers "how much can I still spend, and where?" for the month, across **every** spending category, and lets the Owner manage the categories themselves.

User stories
- I open Budget and see this month: left to spend, spent of budget, pace (ahead/behind), days left, ₱ left today (+ the math).
- I see **every** spending category, not only budgeted ones: spent this month, its budget (or "No budget"), a bar with a pace marker, and "₱X left" / "₱X over".
- I tap a category: set or clear its budget; see spent this month, last month and the 3-month average; see this month's entries; rename it; delete it (choosing where its entries move, "Other" preselected).
- I add a new category (spending or income), optionally with a budget. It shows up everywhere categories are picked (Add, Edit, filters, Analytics).
- I see how much of the monthly budget is allocated to categories and how much is unallocated.
- I step to past months to see how each ended.
- Goals live here too (New, edit, Add money).

## Decisions (Owner, 2026-11-03)
1. Goals move to the Budget tab.
2. Deleting a category with entries asks where they move; "Other" preselected. Its budget is removed.
3. Every spending and income category can be renamed/deleted, built-ins included, except the system ones: **Transfer, Investments, Adjustment, Other**.
4. Tabs: **Chat · Money · Budget · Analytics**. Analytics loses the budget & goals block (keeps the review row and profile).

## Assumptions
- Category identity stays its name (entries store the name; the DB `categories.code` is that name). Renaming moves *my* entries, splits, receipt items and budget to the new name; it never changes another user's data.
- A custom category behaves like a built-in of its kind: spending categories count as spend and can be budgeted; income categories count as income. Custom spending categories are paced (not "fixed bills"); a renamed built-in keeps its fixed/monthly flags.
- AI receipt/text capture keeps suggesting built-in categories; custom ones are picked by hand. (Later: teach capture the user's list.)
- No rollover of unspent budget between months.

## Contracts

**Client (`src/lib/categories.ts`, new)**
```ts
export type CategoryKind = "expense" | "income";
export interface CategoryDef { name: Category; kind: CategoryKind }
export const SYSTEM_CATEGORIES: Category[] = ["Transfer", "Investments", "Adjustment", "Other"];
export function userCategories(s: LedgerState): CategoryDef[]; // s.categories ?? defaults (built-ins in today's order)
export const spendCategories = (s: LedgerState): Category[]; // expense defs + "Other" last
export const incomeCategories = (s: LedgerState): Category[];
export function categoryNameError(name: string, defs: CategoryDef[], except?: Category): string | null; // empty, too long (>32), duplicate (case-insensitive), system name
```
- `type Category = string` (built-in names stay listed as constants).
- `LedgerState.categories?: CategoryDef[]` (absent = defaults; persisted locally; cloud loads it).
- Reducer actions: `{type:"add-category", def}`, `{type:"rename-category", from, to}`, `{type:"delete-category", name, moveTo}`. Rename/delete also rewrite entries (category, split[].category, receipt.items[].category) and `profile.categoryBudgets` keys. Budgets keep using `update-profile {categoryBudgets}`.

**Cloud (new migration `20261103000200_user_categories.sql`)**
- `user_categories(user_id, code → categories(code) on update cascade, kind 'expense'|'income', sort int, created_at, primary key(user_id, code))`, RLS owner-only. No rows = the defaults.
- Security-definer RPCs scoped to `ledger_uid()`, each first materialising the defaults for a user with no rows, each returning `{categories:[{code,kind}]}`:
  - `add_category(p_name, p_kind)` — adds a `categories` row (is_spend = kind='expense', sort 100) if the name is new; errors if the name exists with another kind or is a system name.
  - `rename_category(p_from, p_to)` — ensures `p_to` exists (copying kind/is_spend/is_fixed/is_monthly from `p_from`); moves the caller's entries, entry_splits, receipt_items, rules and `profiles.category_budgets` key; replaces the row in `user_categories`.
  - `delete_category(p_name, p_move_to)` — moves the caller's rows to `p_move_to`, drops the budget key, removes the `user_categories` row. The global `categories` row stays.
- `loadState` reads `user_categories` (order by sort); the outbox maps the three actions to the RPCs and reloads after rename/delete.

## Commands
Dev `npm run dev -- --host` · Test `npx vitest run` · Types `npx tsc -b` · Lint `npm run lint` · Build `npm run build` · Vendor sync `node supabase/functions/_shared/vendor/sync.mjs` · Deploy `supabase db push` → `supabase functions deploy` (if changed) → push `main`.

## Project Structure
- `src/lib/categories.ts` (new), `src/lib/types.ts`, `src/lib/store.tsx`, `src/lib/persistence.ts`, `src/lib/cloud/{api,map,outbox}.ts`, pickers in `add-sheet.tsx`, `activity.tsx`, `entry-rules.ts`, `ledger-list.tsx`
- `src/screens/budget.tsx` (new), `src/screens/plan.tsx` (reused), `src/screens/analytics.tsx` (block removed), `src/App.tsx`, `src/components/ledger/{chrome,icons}.tsx`
- `supabase/migrations/20261103000200_user_categories.sql`, tests in `tests/client`, `tests/db`

## Testing Strategy
- Client: reducer add/rename/delete (entries, splits, receipt items, budgets move; system names refused); `categoryNameError`; budget rows for every category (spent, budget, left/over, pace); defaults when `categories` is absent.
- DB (pglite): RPCs scope to the caller; rename moves only the caller's rows; delete reassigns; system names refused; kind clash refused; defaults materialised.
- Browser (demo mode): Budget tab end to end.

## Boundaries
- Always: new numbered migrations; vendor sync after `types.ts` changes; tests/types/build green before commit.
- Ask first: deploying; removing a built-in for everyone.
- Never: rename/delete another user's data; allow deleting Transfer/Investments/Adjustment/Other.

## Success Criteria
1. Tab bar: Chat · Money · Budget · Analytics; Analytics has no budget/goals block.
2. Budget shows every spending category for the month with spent, budget/no budget, bar, pace and left/over; overall left to spend, allocation and left today.
3. Category sheet: set/clear budget, 3 comparisons, this month's entries, rename, delete with move-to.
4. New category appears in Add/Edit pickers, filters and Analytics immediately; works in demo and cloud.
5. Goals work in Budget.
6. All tests, types, lint, build pass.

## Plan
Three parallel tracks against the contracts above, then integration:
1. **Server**: migration + RPCs + pglite tests.
2. **Client data**: `categories.ts`, type change, state, reducer, persistence, seed, cloud load/outbox, pickers.
3. **Budget UI**: `budget.tsx`, tab + route, Analytics block removal, goals.
Integration: wire UI to the real store, browser check, vendor sync, docs.

## Tasks
- [x] Server: user_categories + 3 RPCs + RLS — Verify: tests/db
- [x] Client: categories.ts + reducer actions + state/persistence — Verify: tests/client
- [x] Client: cloud load + outbox + pickers use the user's list — Verify: tests/client, tsc
- [x] UI: Budget tab overview + every-category list + pace — Verify: browser
- [x] UI: category sheet (budget, comparisons, entries, rename, delete+move) + New category — Verify: browser
- [x] UI: goals in Budget; Analytics block removed; 4 tabs — Verify: browser
- [x] Integrate, vendor sync, all checks green, commit
