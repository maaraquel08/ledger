---
type: fact
status: draft
updated: 2026-11-14
related: [accounts, glossary, system-map, product, D-0007, D-0014, D-0020, analytics, activity]
---

# Subscriptions

**Purpose.** Lets the Owner see what they still have to pay this month and when (Netflix, rent, every credit card bill), log each payment in one tap, and know it is paid without marking anything.

Spec: `docs/superpowers/specs/2026-11-14-subscriptions.md`. Logic: `src/lib/subscriptions.ts`. Owner decisions 2026-11-14: lives on Money; cards appear automatically; the Owner's own entries link automatically; local and cloud.

## Scope
- In: add, edit, delete a subscription; **Upcoming** on Money (next 30 days total); Subscriptions screen; Mark paid; credit card bills from card accounts; Pay a card; both modes.
- Out: yearly or weekly cycles (monthly only); reminders and push; skipping a month; linking or unlinking an entry by hand; M8 answers about bills; card statement balances; price-change history.

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | Upcoming, all subscriptions, what paid each | Add, edit, delete, Mark paid, Pay a card | Link or unlink an entry; skip a month |
| M8 | `recurring_items` in its capture knowledge base, the server's `recurring_missed` alert | Nothing here | Create, edit or pay a subscription; answer questions about bills (yet) |

## Rules
- A subscription is a row in `recurring_items` (D-0020): name, amount (shown positive, stored signed), day 1–31 clamped to month end, `startsOn`, usual account, category (default Subscriptions). Monthly only. Delete sets `active = false`; the row stays.
- **Paid is derived, never stored.** An entry pays a subscription when it is spending (amount < 0, not refunded, not a move leg, not in Review, not an Adjustment), its description or raw text contains the subscription's name or the name contains the description (case ignored, description at least 3 letters), its amount is within 50–150% of the subscription's, and it is dated no earlier than 10 days before `startsOn`.
- One entry pays one subscription: the longest name wins ("Apple One" before "Apple"), then the lowest id.
- **Next due** = the cycle date at index N, counting from `startsOn`, where N = number of paying entries. Each payment moves it one month on; deleting the entry moves it back. **Overdue** = next due is before today; shown with days late.
- **Mark paid** logs one entry with the subscription's name as description (so it matches), its category, the chosen account and date (default today).
- **Card rule.** A credit account with a due date and an amount owed above 0 is an Upcoming item. Due = its stored due date while that is today or later, else the next time its day comes round; amount = owed now. Paid = a transfer went into the card (a move leg, amount > 0) since the day after its last due date; an Adjustment or other credit doesn't count. Cards are never overdue: Ledger cannot see the statement. **Pay** opens Transfer with the card as destination and the amount owed filled in; it stays a Transfer, not spending (D-0007).
- Upcoming order: overdue first, then by due date, paid cards last. Total NEXT 30 DAYS = everything still unpaid due within 30 days, overdue included, paid cards not.
- Subscription payments are ordinary spending in totals; Mark paid is not a Transfer.

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Empty | no subscriptions, no card bills | one-line prompt on Money, "Add a subscription" | Add |
| Upcoming | at least one unpaid item | `UPCOMING · ₱X NEXT 30 DAYS`, up to 5 rows (name, `DUE 18 NOV · BPI`, amount, Mark paid or Pay), "See all" | Mark paid, Pay, row tap |
| Overdue | next due before today | `OVERDUE · 3 DAYS` in red, listed first | an entry that pays it |
| Paid card | transfer in since last due date | "Paid", last in the list, excluded from the total | next cycle |
| Card without due date | credit account, no due day | not listed | set "Due day" in Edit account |

## Flow
Money → Upcoming → Mark paid sheet (amount, account, date; "Log ₱549") or Pay (Transfer sheet) · See all → Subscriptions → Add / row → subscription sheet (edit, PAID WITH last 6, Delete with confirm).

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Upcoming section | `/money` (above net worth) | Mark paid / Pay | Eyebrow, flat card rows |
| Subscriptions | `/money/subscriptions` (matched before `/money/:id`) | "Add" | SUBSCRIPTIONS and CARDS groups, each by due date |
| Subscription sheet | sheet | Save | Sheet, account picker, Cta |
| Mark paid sheet | sheet | `Log ₱549` | Sheet, Cta |

## Interactions
| | |
|---|---|
| Owns | Subscription (`recurring_items`) |
| Reads | entries (matching, PAID WITH), accounts (card bills, pickers), categories |
| Writes | `upsert-subscription`, `remove-subscription` (`recurring_items`, active false on delete), `add-entry` (Mark paid) |
| Triggers | Transfer sheet from accounts (Pay, preset destination and amount); entry detail from PAID WITH |
| Exposes | Upcoming list and 30-day total on Money; `recurring_items` to M8's capture knowledge base and the server's `recurring_missed` |
| Depends on | accounts (`dueDate`, Transfer), activity (entries are the proof of payment), add-entry (any logging path), D-0007, D-0014 |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Entry logged by typing, voice, receipt or server capture | counts as paid if it matches | D-0020 |
| Entry renamed so it no longer matches | stops counting; next due moves back | D-0020 |
| Two subscriptions with overlapping names | longest name takes the entry | spec |
| Due day 31 in a short month | clamped to month end (30 Nov, 28/29 Feb) | spec |
| Entry within 10 days before the first due date | counts for it | spec |
| Same-name charge outside 50–150% of the amount | not a payment | spec |
| Money into a card that isn't a transfer (Adjustment) | doesn't count as paid | handled |
| Card due date stored as a full date | used as set while ahead; once past, its day rolls forward monthly | code |

## Open questions
- Add Upcoming to M8's daily line and bill answers in chat.
- Yearly cycles.
