---
type: fact
status: draft
updated: 2026-10-29
related: [review, add-entry, receipt-scan, accounts, budgets-and-goals, insights, users, system-map, D-0012, rules/rule-signed-money, D-0013, D-0005, D-0009, D-0010, D-0014, D-0015]
---

# Activity

**Purpose.** Lets the Owner find, read and correct every entry they have logged.

## Scope
- In: list, stats, filters/search/sort, paging, review banner, entry detail, M8's note, edit entry, edit split, refund, delete.
- Out: bank-statement import ("or import a bank statement · soon", disabled); recurring logic (`auto` flag is display only); duplicate detection for typed entries.

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | All entries (single local user) | Add, edit, split, refund, delete | Clear an entry's account once set; undo a delete |
| M8 | Entries, budgets | Writes the note on each entry (rules) | Edit or delete entries |

## Rules
- Route `/activity`; filters live in the URL hash query `?q=&acct=a,b&period=month|year|all&cat=&sort=new|old|large`, not persisted (`src/screens/activity.tsx:65-70`).
- Search is debounced 250 ms and matches desc + raw + category + account name + providerLabel (`activity.tsx:118-120`).
- Unfiltered: IN / OUT / NET for current month ("N deposits", "N entries"); entries grouped by day ("TODAY · 19 OCTOBER"), paged 60 day-groups (`DAY_PAGE`), "Show earlier". Filtered: "N match(es)" + sum of signed amounts, grouped by month, paged 100 entries (`ENTRY_PAGE`). Sort Largest = one ungrouped list.
- Filter sheet: Period (This month / This year / All time), Account multi-select, Category (`ALL_CATEGORIES`); button "Show N entries". Sort sheet: Newest, Oldest, Largest.
- `needsReview` = category null or accountId null (`activity.tsx:41`); banner "{n} entr(y|ies) to review / Review →", hidden while filtering.
- Row chips: "Needs category" (warn), "On phone" (`src/components/ledger/primitives.tsx:157-158`); account label `PROVIDER ·last4` or `ACCOUNT?`.
- Spend/income definitions: `isSpend` = amount < 0, not Investments/Transfer, not refunded; null category counts as spend (`src/lib/selectors.ts:4-11`).
- Detail Budget row (`activity.tsx:393-402`): default "No budget for this"; with category budget "<Category> · ₱X over|left"; no budget and amount > 0 "Income".
- M8's note, first match wins (`activity.tsx:404-437`): (1) same description (case-insensitive) >= 5 times this year and an expense -> "Your <ordinal> <desc> this year, ₱total so far. This one is a habit, not a decision."; (2) amount > 0 -> "Money in. ₱X added to <account or 'your account'>."; (3) has category -> "This is N% of what you spent on <category> in <Month>." (uses split part if present); (4) "This one has no category yet. File it so your insights stay accurate."
- Edit entry (`activity.tsx:580-660`): category pills are `ALL_CATEGORIES` (spend categories + Income, Salary, Investments, Transfer), plus the entry's current category if it isn't in that list. Sign rule on save: category Income/Salary -> positive; Transfer/Investments -> keep existing sign; any other -> negative. A live signed preview sits next to the amount (`activity.tsx:626`). When the sign would change, an inline note says "This becomes money in|out and moves <account> by ₱X." (`activity.tsx:653-657`). Linked entries (transfer or invest legs, `linkId` set) lock the category ("<Category> · linked") and keep their sign. Amount must be a positive number. Account pills cannot clear.
- Edit split (`activity.tsx:780-820`): re-pick each item's category from `SPEND_CATEGORIES`; saves `split` only if > 1 category; main category = largest split. Shown only if `receipt.items` non-empty; otherwise the button is "Mark as refunded" / "Unmark refunded".
- Refund toggles `refunded` (struck through, excluded from spend) and restores the balance (D-0009): a refunded entry has zero balance effect (`effect()`, `src/lib/store.tsx:23`), so the update reverses the outflow. The button is hidden for income (amount > 0, `activity.tsx:548`); helper under it "Puts ₱X back in <account>." or, with no account, "Removes ₱X from this month's spending." (`activity.tsx:554-557`).
- Update reverses the old balance effect and applies the new; delete reverses it (`src/lib/store.tsx:54-71`). Credit accounts: balance - amount.
- Delete of a linked entry removes every entry with the same `linkId` in the reducer (`store.tsx:62-71`). The confirm reads "Delete this transfer? Both legs go: −₱X from <A> and +₱X to <B>. You can't undo this." with button "Delete transfer" (`activity.tsx:524-538`).

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Empty | no entries | "No entries yet" / "Type it however you want. “grab gcash 248” is enough." CTA "Add an entry"; disabled "or import a bank statement · soon" | Add |
| No matches | filters match nothing | "No matches" / "Nothing fits those filters." + "Clear filters" | Clear |
| Review banner | any entry needs review | "{n} entries to review / Review →" | Tap |
| Detail not found | bad id | "Entry not found" / "It may have been deleted." | Back |
| Refunded | toggled | strikethrough desc, "Refunded" chip | Unmark |
| Receipt photo | receipt entry | tile "SAVED · READ BY M8" or "NOT SAVED" | Tap to view |
| Delete confirm | "Delete" | "Delete ‘desc’ (₱X)? You can't undo this." -> "Delete entry", then `back("/activity")` | Cancel |
| Delete confirm, linked | "Delete" on a transfer/invest leg | "Delete this transfer? Both legs go: −₱X from <A> and +₱X to <B>. You can't undo this." -> "Delete transfer" | Cancel |

## Flow
List -> row -> detail (note, split, receipt) -> Edit / Edit split / Refund / Delete. FAB "Add entry" (Activity only) opens AddSheet. Banner -> `/review`.

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Activity | `/activity` | Yellow FAB "Add entry" | Screen, TabBar, EntryRow, StatGrid, Sheet (Sort by, Filter), Pill, CategoryChip |
| Entry detail | `/activity/:id` | Edit | Screen, AiCard (M8's note), Sheet (Edit entry, Edit split, Receipt photo), Cta |

## Planned (approved 2026-10-29, not shipped)
- Activity becomes the ledger half of the **Money** tab (D-0015), with type filters: income, expense, transfer, invest, refund.
- The Review banner goes away; Review is its own tab.
- Cloud mode: entries come from the server; delete becomes void (`void_entry`, cascades to the linked leg) and every change is an `entry_event`, which backs Undo and audit (D-0012). Each entry links to its **raw input** (what was typed, said or photographed).
- M8's note may come from Claude in cloud mode, with numbers only from facts (D-0013).
- Adjustment entries (D-0014) appear in the ledger, neither spending nor income.

## Interactions
| | |
|---|---|
| Owns | Entry (the whole list) |
| Reads | entries, accounts, profile budgets, month totals, URL query |
| Writes | `update-entry`, `delete-entry` (balance reversal), URL params (replace-navigate) |
| Triggers | `/review`, `/activity/:id`, AddSheet (`openAdd`), `/activity?acct=<id>` from accounts |
| Exposes | Filtered entry views to accounts ("See all") and insights day sheet; entry detail target for home receipt card and chat sources |
| Depends on | add-entry, receipt-scan (split/receipt), review, budgets-and-goals (Budget row), accounts |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Changing category flips sign | Any non-Income/Transfer/Investments category forces negative; the Edit sheet now shows the new sign and an inline note | handled in code (warns, does not block) |
| Clear account or restore "Needs category" | Not possible in edit | unhandled |
| Refund and balance | Refund restores the balance; unmarking re-applies the outflow | handled in code (D-0009) |
| Deleting one transfer leg | Both legs are deleted | handled in code (D-0010) |
| Refund on an entry with receipt items | Button is "Edit split" instead; no refund control there | unhandled |
| Future-dated seed entries | Nothing filters them (unverified) | unhandled |
| Delete | Inline confirm, irreversible | handled in code |
| Negative non-credit balance | Accounts screens show a signed red balance (see `accounts`); entry rows still use `peso()` | handled in code |
| Day keys | UTC date vs local day can disagree near midnight (affects insights gate, unverified impact) | unhandled |
| Habit rule | Counts same description in the year, so "Lunch" can be a "habit" | handled in code |

## Open questions
- "import a bank statement · soon" is a dead control; keep?
