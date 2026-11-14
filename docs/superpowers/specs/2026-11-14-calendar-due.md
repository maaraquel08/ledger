# Spec: Due payments on the spend calendar

Status: approved by the Owner 2026-11-14 · builds on `2026-11-14-subscriptions.md` and `2026-11-14-card-reminders.md`

## Objective
At a glance on Activity's spend calendar, the Owner sees which days have payments due and how many, and whether they're paid. Tapping a day lists what's due that day above that day's entries. A paid item says which account paid it.

Owner decisions (2026-11-14): a count badge in the cell · a DUE block above the day's entries · the calendar browses future months with no limit.

## Design

### Logic: `dueInMonth(state, month, today)` in `src/lib/subscriptions.ts` (pure)
Returns `Map<dayOfMonth, DueItem[]>` for every due date in the month:
```ts
type DueItem = {
  key: string;                 // `${kind}:${id}:${YYYY-MM-DD}`
  kind: "subscription" | "card";
  id: string;                  // subscription id or card account id
  name: string;
  due: Date;
  status: "paid" | "due" | "overdue";   // cards are never overdue
  amount: number | null;       // paid: what was paid; subscription due: its amount; card due: null
  owed?: number;               // card, current cycle only: hint
  entry?: Entry;               // paid: the entry that paid it (for a card, the leg into the card)
  paidFrom?: string | null;    // paid: account id the money came from
  actionable: boolean;         // the one occurrence Mark paid / Pay acts on
};
```
- **Subscriptions.** Due date `i` (`dueOn(sub, i)`) is paid by the `i`-th matching entry, oldest first (the same rule as Upcoming). If it has no matching entry, it's `overdue` when it's before today, otherwise `due`. Only the first unpaid due date is `actionable`, because Mark paid always pays the earliest unpaid month. `paidFrom` is the paying entry's account.
- **Cards** (only those with a card reminder):
  - **Which due dates:** the card's current due date (as on Upcoming), every month after it, and last month's due date when it falls earlier in the current month, paid or not: the month the reminder was set in is the first one shown (Owner, 2026-11-14).
  - **Paid:** a due date is paid when a transfer went into the card after the previous month's due date and on or before this one. `entry` is the latest such transfer; `paidFrom` is the account on the other side of that transfer.
  - **Pay button:** only on the card's current due date (`actionable`).
  - **Amount:** an unpaid card shows no amount. Only its current due date shows what's owed, as a hint.

### Calendar cell (`src/screens/charts/spend-calendar.tsx`)
- New optional prop `due?: Map<number, DueItem[]>`. Only the Activity tab passes it.
- **Badge** in the top-right corner (about 14px, mono 9px, `tnum`; ink, not yellow, per the Owner):
  - Ink fill with a light number: how many items are still to pay.
  - Red fill when any item that day is overdue.
  - Outlined with a ✓ when everything that day is paid.
  - Above 9 it shows `9+`.
- **Label:** the cell's `aria-label` adds ", 2 payments due, 1 paid".
- **Future days:** a future day with something due can be tapped; one with nothing due stays dashed and disabled.

### Activity tab (`src/screens/activity-tab.tsx`)
- The next-month arrow is always enabled, with no limit. Future months show only due badges, since there's no spending yet.
- The selected day keeps the same URL range (`from = to = day`).
- **DUE section** inside the ledger list (`LedgerList` `lead` slot), styled as a sibling of the day sections and placed before them; shown when the picked day has items (Owner, 2026-11-14):
  ```
  DUE · 18 NOVEMBER
  Netflix   PAID 14 NOV · RCBC JCB ·4402        ✓ ₱549
  Spotify   NOT PAID                       ₱194 [Mark paid]
  U Visa    NOT PAID · OWED ₱385         You decide  [Pay]
  ```
  - **Paid row:** meta `PAID <entry date> · <paidFrom account label>`, a ✓ with the amount, and a tap opens the entry.
  - **Overdue row:** meta `OVERDUE · N DAYS` in red.
  - **Buttons:** Mark paid or Pay only on an `actionable` item. Any other unpaid item shows no button.
  - **Tapping an unpaid row:** a subscription opens its edit sheet; a card opens its reminder sheet.
  - **Reuse:** the same sheets as Upcoming (`useBills` in `src/screens/subscriptions.tsx`), exported as a `DueOnDay` component.
- **Future day with no entries:** the ledger's empty message stays as it is today.

### Out of scope
Due badges on Analytics' calendar; payments in the past before a subscription's `startsOn`; card history before the current month; yearly cycles.

## Commands
`npm test` · `npx vitest run tests/client/subscriptions.test.ts` · `npm run lint` · `npm run build` · local browser check: `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5199`

## Files
`src/lib/subscriptions.ts`, `tests/client/subscriptions.test.ts`, `src/screens/charts/spend-calendar.tsx`, `src/screens/activity-tab.tsx`, `src/screens/subscriptions.tsx`; brain: `features/subscriptions.md`, `features/activity.md`, `system-map.md`, `CHANGELOG.md`.

## Testing
- **Unit `dueInMonth`:**
  - paid and unpaid due dates map to the right entries and `paidFrom`;
  - overdue before today;
  - only the first unpaid due date is actionable;
  - a month before `startsOn` has nothing;
  - a future month lists every subscription as due;
  - for cards: the current due date with `owed`, a paid due date with the source account from the other side of the transfer, a later month with no amount, and no card without a reminder;
  - month-end clamping (day 31 in February).
- **Browser:**
  - badges appear, with counts and states;
  - tapping a past day, today and a future day shows the DUE block;
  - Mark paid from the block turns it to Paid with the account;
  - next month can be opened.

## Boundaries
- Always: tests, lint and build green; glossary words ("entry", "Mark paid", "Pay"); brain write protocol.
- Ask first: migrations, pushing or deploying.
- Never: store paid status; assume a card amount.

## Success criteria
1. Every day with a due date shows a badge; the number is how many are still to pay, a ✓ means all paid, and red means overdue.
2. Tapping a day with due items, including a future one, shows the DUE block above that day's entries.
3. A paid item shows the account the money came from, and tapping it opens its entry.
4. Mark paid or Pay from the block works and the badge updates.
5. The calendar can go to any future month.
6. `npm test`, `npm run lint` and `npm run build` pass.

## Changes during build (2026-11-14)
- The DUE block moved into the ledger list as its own section.
- Card due dates are stored as a local `"YYYY-MM-DD"` and read with `dueDayOf`. Writing local midnight as an ISO time had saved the previous day in UTC+8 (a reminder for the 13th showed on the 12th).
