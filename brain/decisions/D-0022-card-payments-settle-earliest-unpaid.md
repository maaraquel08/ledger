---
type: decision
area: product
status: draft
updated: 2026-11-14
related: [D-0021, D-0020, D-0007, features/subscriptions, features/activity, glossary]
supersedes: []
superseded_by: null
---

# D-0022 Card payments settle the earliest unpaid due date

**Context.** A card reminder's due date rolled forward and "paid" meant any transfer into the card inside a window. Tapping Pay on a past month (a calendar badge, an unpaid November) could not settle that month: the payment landed in the current one. The Owner wanted Pay on a past month to settle that month (2026-11-14).

**Decision.** The reminder's stored `dueDate` is the card's **first** due date: the month it was set in, even if that day has passed. It never rolls forward. Due date `k` is that day `k` months on, clamped to month end. Payments are moves into the card (amount > 0) dated from the day after the month before the first due date, taken oldest first. A payment settles the **earliest unpaid** due date when that one is behind the payment's own month; otherwise its own month. Several payments in a month add up. Only the earliest unpaid due date has **Pay** and the owed hint; later unpaid ones show Pay disabled with "Pay 13 Nov first". A card is never overdue (D-0021): a past unpaid month reads NOT PAID, not red. Spec: `docs/superpowers/specs/2026-11-14-card-payments.md`.

| Option | Outcome |
|---|---|
| (chosen) First due date stored; payments settle the earliest unpaid | Pay on a past month settles it; history is derived, nothing stored (D-0020) |
| Due date rolls forward, paid by a time window | A skipped month can never be settled; the calendar can't show it paid |
| Store a paid flag per month | Needs a new column and upkeep; breaks "paid is derived" |

**Consequences.** Existing reminders keep their stored date as their first due date. A skipped month stays unpaid until paid or the reminder is re-set (save a different day, then back, to make this month the first). A new reminder can show earlier months as unpaid at once.

**Revisit when.** The Owner wants to skip a month, or a statement amount per month (D-0021).
