# Spec: Subscriptions and upcoming payments

Status: approved by the Owner 2026-11-14 · implemented on `feat/subscriptions`

## Objective

The Owner wants to see **what they still have to pay this month and when**: Netflix, Apple, Spotify, rent, and every credit card bill, and to have each payment tied to the account and the entry that paid it.

User stories:
1. I add a subscription (name, amount, due day, account, category) and can edit or delete it later.
2. On Money I see **Upcoming**: what's due next, overdue first, with a total for the next 30 days.
3. I tap **Mark paid** on one, confirm the amount and account, and Ledger logs the entry and moves the due date to next month.
4. If I log the payment myself ("netflix 549 bpi", by voice, or from a receipt), Ledger counts it as paid without me tapping anything.
5. Each credit card with a due date shows up in Upcoming on its own with the amount owed. **Pay** opens a transfer from a bank or e-wallet into the card.

Decisions the Owner made (2026-11-14): it lives on the **Money tab** · credit cards are **added automatically from card accounts** · entries the Owner logs **link automatically** · **local and cloud** in this first pass.

## Design

### Data: reuse `recurring_items` (no migration)
`public.recurring_items` already exists with RLS `owner_all`, the client may write it directly (CONTRACT.md), the capture function already reads it into M8's knowledge base, and `detect_anomalies` already raises `recurring_missed` from it. A subscription *is* a row there.

```ts
// src/lib/types.ts
export interface Subscription {
  id: string;
  name: string;            // recurring_items.description: "Netflix"
  amount: number;          // positive pesos; the row stores it signed (−549)
  day: number;             // recurring_items.day_of_month, 1–31 (clamped to month end)
  startsOn: string;        // recurring_items.starts_on, "YYYY-MM-DD": the first due date tracked
  accountId: string | null;// the account it's usually paid from
  category: Category;      // default "Subscriptions"
}
// LedgerState.subscriptions?: Subscription[]   (absent = none)
```
- Monthly only (`cadence = 'monthly'`). Yearly and weekly are out of scope (the table has no yearly; the UI writes no weekly).
- Delete = `active = false` (the row stays, like archived goals). Cloud loads `active = true` only.

### Paid status is derived, not stored (same idea as D-0014)
An entry **pays** a subscription when all of these are true (`src/lib/subscriptions.ts`, pure):
- it is spending: `amount < 0`, not refunded, not a move leg, not in Review;
- its description (or raw text) contains the subscription name, or the name contains the description, ignoring case;
- `|amount|` is within 50–150% of the subscription amount (the same band the server's `recurring_missed` uses);
- it is dated on or after `startsOn − 10 days`;
- it pays at most one subscription (the first match by name length, then id).

`paid = number of matching entries`; **next due = the cycle date at index `paid`**, counting from `startsOn` (day clamped to month end). Each payment moves it forward one month. Deleting the entry moves it back. **Overdue** = next due before today.

That gives the auto-link for every kind of logging (typed, voice, receipt, server capture) with no change to entries or RPCs. A subscription's detail lists the entries that paid it, and each one opens its entry detail. The trade-offs: the link can't be undone by hand (rename the entry instead), and a payment with an unrelated description won't be counted, so **Mark paid** always writes the subscription's name as the description.

### Credit cards (derived from accounts)
Each `type: "credit"` account with a `dueDate` and an amount owed above 0 is an Upcoming item:
- **Due** = the stored due date while it's today or later; once it has passed, the next time its day of the month comes round.
- **Amount** = the amount owed now.
- **Paid this cycle** = a transfer has gone into the card (a move leg, amount > 0) since the month before the due date. An Adjustment doesn't count. A paid card shows "Paid" and drops to the bottom.
- **Pay** opens the existing Transfer sheet with the card as the destination and the amount owed filled in. It stays a move, not spending (D-0007).
- Cards are never overdue: Ledger can't see the statement.
- **Edit account** gets a "Due day" field for credit accounts (1–31). It stores the next due date in the existing `dueDate`, which already syncs as `accounts.due_date`.

### Screens (ledger-design-taste: flat bordered cards, mono eyebrows, bottom sheets)
- **Money tab, above net worth:** `UPCOMING · ₱X NEXT 30 DAYS` with up to 5 rows, overdue first and then by due date. Each row shows the name, `DUE 18 NOV · BPI` (or `OVERDUE · 3 DAYS`, red) and the amount, with a trailing **Mark paid** or **Pay** button. **See all** opens `/money/subscriptions`. When there's nothing to show, a one-line prompt and **Add a subscription**.
- **`/money/subscriptions`** (it must be matched before `/money/:id`): an **Add** button, then a SUBSCRIPTIONS group and a CARDS group, each sorted by next due date. Tapping a subscription opens its sheet.
- **Subscription sheet** (add/edit): name, amount, due day (1–31), account picker, category (default Subscriptions). Edit adds the PAID WITH list (the last 6 linked entries) and **Delete subscription** with a confirm step.
- **Mark paid sheet:** amount (prefilled), account (prefilled, can change), date (today). The button reads `Log ₱549`. It dispatches one `add-entry` with `desc = name`, `category`, `amount = −value`, `accountId`.

### Store and sync
- Actions `upsert-subscription` and `remove-subscription` in `src/lib/store.tsx`.
- Outbox (`callsFor`): upsert writes to the `recurring_items` table (`onConflict: id`); remove sets `active: false`. That's the same pattern as goals.
- `loadState` reads `recurring_items` where `active` (and `cadence = 'monthly'`); map functions live in `src/lib/cloud/map.ts`.
- `import_state` and erase-my-data already handle `recurring_items`, so nothing changes there.
- The demo seed gets Netflix, Spotify and iCloud+ so the demo shows the feature.

### Out of scope
Yearly or weekly cycles, reminders and push notifications, skipping a cycle, linking or unlinking by hand, M8 chat answers about bills, statement balances for cards, and price-change history.

## Tech stack
React 19, Vite 8, Tailwind v4, sc1m primitives in `src/components/ledger/primitives.tsx`, Supabase JS 2. No new dependencies.

## Commands
```
npm test                         # vitest run (client + db via PGlite + functions)
npx vitest run tests/client/subscriptions.test.ts
npm run lint                     # oxlint
npm run build                    # tsc -b && vite build
npm run dev -- --host            # manual check on phone width
```

## Project structure (touched)
```
src/lib/types.ts               Subscription, LedgerState.subscriptions
src/lib/subscriptions.ts       NEW pure logic: cycle dates, matching, nextDue, upcoming list, cards
src/lib/store.tsx              actions + reducer
src/lib/cloud/{map,api,outbox}.ts  row mapping, load, outbox calls
src/lib/seed.ts                demo subscriptions
src/screens/subscriptions.tsx  NEW: Upcoming section, list screen, sheets
src/screens/money.tsx          mount Upcoming
src/screens/accounts.tsx       Due day on Edit (credit); Transfer sheet takes a preset destination + amount
src/App.tsx                    /money/subscriptions route
tests/client/subscriptions.test.ts  NEW
tests/db/subscriptions.test.ts      NEW (RLS + upsert/deactivate as the client does it)
brain/features/subscriptions.md NEW; system-map, glossary, accounts.md, CHANGELOG, D-0020
```

## Code style
Follow the surrounding code: pure functions in `src/lib/*` with short doc comments explaining *why*, screens built from Ledger primitives (`Sheet`, `Eyebrow`, `Cta`, `ActionButton`), `peso()` for money, `localDay()` for dates. Copy follows the glossary: "entry", never "transaction"; "Log ₱549".

## Testing strategy
- **Unit (vitest):** cycle dates with month-end clamping (31 → 30 Nov, 28/29 Feb), matching (name both ways, amount band, refunded, moves, Review), one entry pays one subscription, next due moves forward and back, overdue, card due date and paid this cycle, upcoming sort and the 30-day total, reducer actions, `callsFor` payloads, map round-trip.
- **DB (PGlite harness):** the client can upsert and deactivate its own `recurring_items` and can't touch another Owner's.
- **Manual (browser, 430px):** add, edit, mark paid, entry appears, due date advances, delete the entry and it moves back, a card's Pay creates a transfer, delete a subscription.
- The existing suite stays green.

## Boundaries
- **Always:** run `npm test`, lint and build before calling a task done; follow the brain write protocol (CHANGELOG line); use glossary words.
- **Ask first:** any new migration or RPC change; new dependencies; pushing or deploying.
- **Never:** edit applied migrations; store a derived paid status; let M8 create or pay subscriptions.

## Success criteria
1. CRUD works in local and cloud mode; a cloud subscription survives a reload (it's read from `recurring_items`).
2. Mark paid logs exactly one entry on the chosen account, and that account's balance changes by the amount.
3. Logging "netflix 549" by hand moves Netflix's next due date forward one month; deleting that entry moves it back.
4. Upcoming lists overdue first, then by date, and its 30-day total equals the sum of the rows due within 30 days.
5. Each credit card with a due date and an amount owed appears automatically; Pay records a transfer that isn't counted as spending.
6. `npm test`, `npm run lint` and `npm run build` pass.

## Open questions
None blocking. Later: yearly cycles; Upcoming in M8's daily verdict.
