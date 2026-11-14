# Spec: Payment drawer, card payments by month, one CTA

Status: approved by the Owner 2026-11-14 · amends `2026-11-14-card-reminders.md` and `2026-11-14-calendar-due.md`

## Objective
1. **Tapping a row opens what was paid, not an edit form.** The drawer shows how much is due or was paid, and from which account, with one primary CTA (Mark paid or Pay). Editing becomes a secondary link.
2. **The drawer has a different state for a subscription than for a card reminder:** a subscription has a fixed amount, a card's amount is the Owner's call.
3. **Pay works on the month you tap.** The month a card reminder is set in is its first due date, and each payment settles the earliest unpaid one.
4. **One CTA on the empty Upcoming screen:** the title bar's **Add**; the empty sections show only their line of text.

Owner decisions (2026-11-14): earliest-unpaid for cards (re-save existing reminders once) · keep the header Add and drop the section buttons.

## Card payments (`src/lib/subscriptions.ts`, done)
- A card reminder's stored `dueDate` is its **first** due date and never rolls forward. Due date `k` = `cardDueOn(card, k)`, which clamps to the month's end.
- A new reminder's first due date is **this month's** occurrence of the day (`dueThisMonth`), even if it has already passed. Editing to the same day keeps it; a new day resets it to this month's.
- **Payments** are moves into the card dated from the day after the month before the first due date, taken oldest first. Each goes to the earliest unpaid due date if that one is behind its own month; otherwise it goes to its own month, the first due date on or after it. Several payments in one month add up there.
- `next` is the earliest unpaid due date. It's what Upcoming shows, the only one with Pay, and the only one with the owed hint.
- Cards are never overdue (D-0021), so a past unpaid month shows NOT PAID, not red.
- `DueItem.payments` lists every entry that paid a due date. `amount` is their sum.
- Existing reminders keep their stored date as their first due date. To make this month the first, re-save the reminder with a different day, then back again.

## Payment drawer (`src/screens/subscriptions.tsx`)
Rows on Upcoming, the Upcoming screen and the calendar's DUE section all open the drawer for a **due item** (a `DueItem`). From Upcoming that's the item's current due date, found with `dueInMonth(state, due).get(day)`.

**Subscription, not paid:**
```
Netflix                                   (sheet title)
DUE 18 NOV · NOT PAID            (or OVERDUE · 3 DAYS, red)
₱549                                      big number
Every month on the 18th · RCBC JCB ·4402
[ Mark paid ]                             Cta, primary, full width
Edit subscription                         text link
```
**Subscription, paid:**
```
DUE 18 NOV · PAID ✓
₱549
Paid 14 Nov from RCBC JCB ·4402     (tap → the entry)
Edit subscription
```
**Card reminder, not paid:**
```
U Visa
DUE 13 NOV · NOT PAID
You decide                                (in place of the number, muted)
Owes ₱385 now                             (earliest unpaid only)
[ Pay ]                                   Cta → Transfer (amount blank, Pay in full chip)
Edit reminder
```
**Card reminder, paid:**
```
DUE 13 NOV · PAID ✓
₱385                                      sum of payments
Paid 14 Nov from BPI ·2841 · ₱200         one line per payment (tap → the entry)
Edit reminder
```
- An unpaid due date that isn't the earliest unpaid shows the CTA disabled, with "Pay 13 Nov first" or "Mark 18 Nov paid first" under it.
- **Row buttons:** the row keeps its trailing Mark paid or Pay button on the earliest unpaid item, as now. Tapping anywhere else opens the drawer.

## Empty states
The Upcoming screen keeps the title-bar **Add** and drops the "Add a subscription" buttons in its sections. Money's Upcoming empty state keeps its single button, styled as the house secondary `ActionButton` at full width.

## Commands
`npm test` · `npx vitest run tests/client/subscriptions.test.ts` · `npm run lint` · `npm run build` · local browser check: `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5199`

## Testing
- **Unit (done, 26):**
  - a late payment settles the month it's behind on;
  - partial payments add up;
  - once caught up, an extra payment stays in its own month;
  - only moves count, dated from the right day;
  - `dueThisMonth` clamps to the month's end;
  - the calendar shows payments and sums.
- **Browser:**
  - the drawer in all four states;
  - Mark paid and Pay from the drawer;
  - Pay on a past month settles that month;
  - the empty Upcoming screen has only the title-bar Add.

## Boundaries
- Always: tests, lint and build green; glossary words; brain write protocol.
- Ask first: migrations, pushing or deploying.
- Never: store paid status; assume a card amount.

## Success criteria
1. Tapping any row opens the drawer with the right state and one primary CTA. Edit is a secondary link.
2. Pay on U Visa's November due date, then its badge and row show November paid, with the account.
3. Several payments in one month show as one paid month with each payment listed.
4. The empty Upcoming screen has one Add.
5. `npm test`, `npm run lint` and `npm run build` pass.
