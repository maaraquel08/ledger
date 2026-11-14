---
type: fact
status: draft
updated: 2026-11-14
related: [D-0022, D-0021, accounts, glossary, system-map, product, D-0007, D-0014, D-0020, analytics, activity]
---

# Subscriptions

**Purpose.** Lets the Owner see what they still have to pay this month and when (Netflix, rent, plus a reminder to pay a credit card), log each payment in one tap, and know it is paid without marking anything.

Specs: `docs/superpowers/specs/2026-11-14-subscriptions.md`, amended by `2026-11-14-card-reminders.md` (replaces its card sections) and `2026-11-14-card-payments.md` (card payments by month, the drawer). Logic: `src/lib/subscriptions.ts`. Owner decisions 2026-11-14: lives on Money; cards are opt-in (a card reminder, no amount); the Owner's own entries link automatically; local and cloud.

## Scope
- In: add, edit, delete a subscription; **Upcoming** on Money (30-day subscription total); full Upcoming screen; Mark paid; add, edit, remove a **card reminder**; Pay a card; both modes.
- Out: due badges on Analytics' calendar; payments before a subscription's `startsOn`; card months before its first due date; yearly or weekly cycles (monthly only); push; skipping a month; linking or unlinking an entry by hand; M8 answers about bills; card statement amounts; "mark done" without an entry; minimum-payment chips; reminders for non-credit accounts; price-change history.

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | Upcoming, all subscriptions and card reminders, what paid each | Add, edit, delete, Mark paid, add or remove a card reminder, Pay a card | Link or unlink an entry; skip a month |
| M8 | `recurring_items` in its capture knowledge base, the server's `recurring_missed` alert | Nothing here | Create, edit or pay a subscription; answer questions about bills (yet) |

## Rules
- A subscription is a row in `recurring_items` (D-0020): name, amount (shown positive, stored signed), day 1–31 clamped to month end, `startsOn`, usual account, category (default Subscriptions). Monthly only. Delete sets `active = false`; the row stays.
- **Paid is derived, never stored.** An entry pays a subscription when it is spending (amount < 0, not refunded, not a move leg, not in Review, not an Adjustment), its description or raw text contains the subscription's name or the name contains the description (case ignored, description at least 3 letters), its amount is within 50–150% of the subscription's, and it is dated no earlier than 10 days before `startsOn`.
- One entry pays one subscription: the longest name wins ("Apple One" before "Apple"), then the lowest id.
- **Next due** = the cycle date at index N, counting from `startsOn`, where N = number of paying entries. Each payment moves it one month on; deleting the entry moves it back. **Overdue** = next due is before today; shown with days late.
- **Mark paid** logs one entry with the subscription's name as description (so it matches), its category, the chosen account and date (default today).
- **Card reminder rule** (D-0021, D-0022). Cards are opt-in. A **card reminder** is a credit account's `dueDate` (`accounts.due_date`); no migration. The stored date is the card's **first** due date and never rolls forward: a new reminder gets this month's occurrence of the day, even if it has passed; editing to the same day keeps it, a new day resets it to this month's. Due date `k` = that day `k` months on, clamped to month end. A credit account without a due date is never in Upcoming; one with it always is, even when nothing is owed. No amount: the row says "You decide" and its meta shows `OWED ₱X` or `NOTHING OWED`. Cards are never overdue: Ledger cannot see the statement, so a past unpaid month reads NOT PAID, not red.
- **Card payments.** A payment is a move into the card (amount > 0; an Adjustment or other credit doesn't count), dated from the day after the month before the first due date, taken oldest first. It settles the **earliest unpaid** due date if that is behind the payment's own month, else its own month. Several payments in one month add up (`amount` is their sum; `payments` lists each). `next` = the earliest unpaid due date: what Upcoming shows, the only one with Pay, the only one with the owed hint.
- **Pay** opens Transfer with the card as destination and the amount **blank**. A chip "Pay in full · ₱X" under the amount fills the amount owed; no chip when nothing is owed. From defaults to the first bank, e-wallet or cash account. It stays a Transfer, not spending (D-0007).
- Upcoming order: overdue first, then by due date, paid cards last. The 30-day total counts **subscriptions only**: unpaid, due within 30 days, overdue included. Cards are never counted.
- **Per occurrence (Activity calendar).** `dueInMonth` lists every due date in a month, each with a status. Subscription due date `i` is paid by the `i`-th matching entry, oldest first (same rule as Upcoming); with none it is overdue if before today, else due. Only the first unpaid occurrence is **actionable**, because Mark paid always pays the earliest unpaid month. `paidFrom` is the paying entry's account. A month before `startsOn` has nothing; a future month lists every subscription as due.
- **Card occurrences** (only cards with a reminder): every due date from the first on, one per month, paid or not. Status follows Card payments above. `entry` is the latest payment, `paidFrom` the account on its other leg. Only `next` is actionable and shows the owed hint; an unpaid card shows no amount. Never overdue. Paid status is still never stored.
- Subscription payments are ordinary spending in totals; Mark paid is not a Transfer.

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Empty | no subscriptions, no card reminders | "Nothing due yet. Add a subscription like Netflix, or a reminder to pay a card." and **Add** on Money; the full Upcoming screen has only the title-bar **Add**, its empty sections show just a line of text | Add |
| Upcoming | at least one unpaid item | `UPCOMING · ₱X SUBSCRIPTIONS, 30 DAYS`, up to 5 rows (name, `DUE 18 NOV · BPI`, amount or "You decide", Mark paid or Pay), "See all" | Mark paid, Pay, row tap |
| Overdue | next due before today | `OVERDUE · 3 DAYS` in red, listed first | an entry that pays it |
| Card reminder | credit account with a due date | `DUE 15 DEC · OWED ₱18,240` or `NOTHING OWED`, "You decide", Pay | Pay, row tap (drawer) |
| Paid card | its earliest due date has a payment | `PAID` for that month; Upcoming moves to the next unpaid | next cycle |
| Card without reminder | credit account, no due date | not listed | Add › Card reminder |
| No credit account | Add › Card reminder | "Add your credit card on Money first.", no form | Add the card on Money |

## Payment drawer
Spec: `docs/superpowers/specs/2026-11-14-card-payments.md`. Tapping a row opens the drawer for that due item (`dueInMonth(state, due).get(day)`), not an edit form. It shows the amount due or paid, the account paid from, and one primary CTA. **Edit subscription** / **Edit reminder** is a secondary text link. The row's trailing Mark paid or Pay stays on the earliest unpaid item.
| State | Shows | CTA |
|---|---|---|
| Subscription, not paid | `DUE 18 NOV · NOT PAID` (or `OVERDUE · 3 DAYS`, red), amount, cycle and usual account | Mark paid |
| Subscription, paid | `PAID ✓`, amount, "Paid 14 Nov from <account>" (tap opens the entry) | none |
| Card reminder, not paid | `DUE 13 NOV · NOT PAID`, "You decide", `Owes ₱385 now` (earliest unpaid only) | Pay (Transfer, amount blank) |
| Card reminder, paid | `PAID ✓`, sum of payments, one line per payment with account and amount (tap opens the entry) | none |
An unpaid due date that isn't the earliest unpaid shows the CTA disabled with "Pay 13 Nov first" or "Mark 18 Nov paid first".

## Flow
Money → Upcoming → Mark paid sheet (amount, account, date; "Log ₱549") or Pay (Transfer sheet, amount blank) · Add → switch **Subscription | Card reminder** (only when adding; reminder = CARD of credit accounts with no reminder yet, DUE DAY 1–31, "Remind me") · row tap → payment drawer (below); drawer › Edit reminder (due day, Save, "Remove reminder", no confirm) · See all → Upcoming → row → drawer › Edit subscription (PAID WITH last 6, Delete with confirm).

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Upcoming section | `/money` (above net worth) | Mark paid / Pay | Eyebrow, flat card rows |
| DUE block | Activity tab, above the picked day's entries | Mark paid / Pay | `DueOnDay`, same sheets as Upcoming |
| Upcoming (full) | `/money/subscriptions` (matched before `/money/:id`), titled "Upcoming" | "Add" | SUBSCRIPTIONS and CARD REMINDERS groups, each by due date, each with its own empty line |
| Payment drawer | sheet, from Upcoming, the full screen and Activity's DUE block | Mark paid / Pay | Sheet, Cta, text link to edit |
| Subscription sheet | sheet | Save | Sheet, account picker, Cta |
| Mark paid sheet | sheet | `Log ₱549` | Sheet, Cta |
| Add sheet, Edit reminder | sheet | Remind me / Save | Sheet, two-way switch, account picker, Cta |

## Interactions
| | |
|---|---|
| Owns | Subscription (`recurring_items`) |
| Reads | entries (matching, PAID WITH), accounts (card reminders, owed, pickers), categories |
| Writes | `upsert-subscription`, `remove-subscription` (`recurring_items`, active false on delete), `add-entry` (Mark paid), `upsert-account` (`dueDate` = add, edit or remove a card reminder) |
| Triggers | Transfer sheet from accounts (Pay, preset destination, blank amount, "Pay in full" chip); entry detail from PAID WITH |
| Exposes | Upcoming list and 30-day subscription total on Money; per-day due items (`dueInMonth`, `DueOnDay`) to Activity's spend calendar; `recurring_items` to M8's capture knowledge base and the server's `recurring_missed` |
| Depends on | accounts (`dueDate` as the card reminder, Transfer), activity (entries are the proof of payment), add-entry (any logging path), D-0007, D-0014 |

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
| Card due date stored as a full date | it is the first due date, never rolls forward; existing reminders keep theirs | D-0022 |
| Pay on a past unpaid month | settles that month; a payment while behind goes to the earliest unpaid | D-0022 |
| Skipped card month | stays unpaid until paid or the reminder is re-set | D-0022 |
| Card with a reminder and nothing owed | still listed, `NOTHING OWED`, Pay has no chip | spec |
| Remove reminder | clears `dueDate`; nothing is lost | spec |

## Open questions
- Add Upcoming to M8's daily line and bill answers in chat.
- Yearly cycles.
