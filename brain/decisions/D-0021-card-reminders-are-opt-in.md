---
type: decision
area: product
status: draft
updated: 2026-11-14
related: [D-0020, D-0007, D-0014, features/subscriptions, features/accounts, glossary]
supersedes: []
superseded_by: null
---

# D-0021 Card reminders are opt-in and carry no amount

**Context.** The first cut of Upcoming listed every credit card with a due date as a bill, with the amount owed as its amount. The Owner pointed out that not every card needs paying, and how much to pay a card is their call each month. Netflix is a subscription; a card isn't.

**Decision.** A card is in Upcoming only when the Owner adds a **card reminder** for it, from Upcoming. The reminder is the card's `dueDate` (`accounts.due_date`): setting it reminds, clearing it stops. A card reminder has no amount: its row says "You decide" and shows what the card owes only as a hint. It is never counted in the 30-day total, which covers subscriptions only. Pay opens Transfer to the card with the amount blank and a "Pay in full" chip. Spec: `docs/superpowers/specs/2026-11-14-card-reminders.md`.

| Option | Outcome |
|---|---|
| (chosen) Opt-in reminder = due date, no amount | Same storage as before, no migration; the Owner decides each payment |
| Every card with a due date, owed as the amount | Reminds about cards that need nothing; implies Ledger knows the bill |
| Stored statement amount per month | Accurate total, but needs a new column (migration) and monthly upkeep |

**Consequences.** Cards don't count in the total, so it understates what leaves the bank. Due day is no longer on Edit account; there's one place to manage a reminder. A newly added reminder can show Paid at once if a transfer into the card landed after the previous due date.

**Revisit when.** The Owner wants a statement amount or a minimum payment in Upcoming, or reminders for accounts other than cards.
