---
type: fact
status: draft
updated: 2026-10-29
related: [activity, add-entry, onboarding, review, insights, users, system-map, D-0012, rules/rule-signed-money, D-0010, D-0014, D-0015]
---

# Accounts

**Purpose.** Lets the Owner keep the accounts they actually use, with balances they update by hand, and see net worth.

## Scope
- In: list groups, net worth, add account sheet, detail stats, edit, remove, transfer.
- Out: bank connection ("Ledger never connects to your bank."); editing provider/type after creation; editing credit due date (seed only); holdings editor (seed only).

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | All accounts, balances, net worth | Add, edit, remove, transfer between accounts | Connect a bank; change type/provider later |
| M8 | Net worth cash figure (chat) | Reads accounts | Create or change accounts, move money |

## Rules
- Account balance delta from an entry = entry amount; credit accounts use `balance - amount`, so spend raises amount owed and a payment lowers it (`src/lib/store.tsx:20-25`). Balance is a manual number, not derived from entries (seed balances hard-coded).
- Net worth = cash (bank + ewallet + cash) + invested - credit owed (`src/lib/selectors.ts:61-71`). Investments value = account balance, not recomputed from holdings.
- List (`src/screens/accounts.tsx:71-160`): TOTAL NET WORTH (red with "−" if negative); groups "CASH · ₱X" (bank, ewallet, cash; sub-meta `rate`), "CREDIT" (meta "due 15 Nov"), "INVESTED · ₱X" (meta = weighted average of ALL holdings' change, repeated on every investments account). Row mono line "PROVIDER · KIND ·last4", provider omitted if name already starts with it. Row balance is `balance()` (signed, `src/lib/format.ts:7`), red when < 0 (`accounts.tsx:55`).
- Add account sheet (`accounts.tsx:162-268`): provider grid (GCash, BPI, BDO, Maya, MariBank, RCBC, UnionBank, IBKR, Cash, Other); name defaults to provider label ("Cash on hand" for cash, blank for Other); type pills Bank / eWallet / Cash / Credit / Investments; last 4 optional (digits, max 4, no minimum); balance, or "AMOUNT OWED (₱)" for credit. Valid when provider chosen, name non-empty, balance >= 0 (blank = 0). `kind = TYPE_KIND[type]`; for Other `providerLabel` = typed name.
- Detail (`accounts.tsx:274-379`): balance via `balance()`, red when negative (`accounts.tsx:319`) (credit also "OWED · due 15 Nov"); StatGrid `IN · OCT`, `OUT · OCT`, `ENTRIES` (entries count includes transfers; IN/OUT excludes them); "RECENT HERE" last 8 ("See all" -> `/activity?acct=<id>` when more than 8).
- Edit (`accounts.tsx:381-448`): name, last4, balance (any finite number, may be negative); saving balance overwrites directly with no adjustment entry.
- Remove: `remove-account` clears `accountId` on its entries so they fall into Review; other balances untouched (`store.tsx:67-73`).
- Transfer (`accounts.tsx:450-520`): destination = any other account, amount > 0. One `add-entries` dispatch creates both legs at one timestamp with a shared `linkId`: `Transfer to <dest>` (-amt, from) and `Transfer from <src>` (+amt, to), category Transfer, excluded from spending (`accounts.tsx:471-477`). Preview "−₱X from A, +₱X to B." For non-credit sources, an amount over the balance shows "That would leave <A> at −₱X." and disables Transfer (`accounts.tsx:464-466, 509`); credit sources are not checked.
- Deleting either leg (from Activity) deletes both (`store.tsx:62-71`).
- `peso()` stays unsigned (`src/lib/format.ts`); balances use `balance()` instead, which prefixes "−" for negatives. Net worth total keeps its own red "−" handling.

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Empty | no accounts | "NO ACCOUNTS YET" / "Add the accounts you actually use." / "Balances are yours to keep updated. Ledger never connects to your bank."; quick picks GCash "Wallet", BPI "Debit or savings", RCBC "Credit card", "Cash on hand" "Physical" | Add |
| List | >= 1 account | net worth, groups | Row tap |
| Detail empty | no entries | "Nothing here yet." | Add entry here |
| Not found | bad id | "Account not found" / "It may have been removed." | Back |
| Remove confirm | "Remove account" | "Remove ‘name’? Its entries stay in Activity but lose their account." | Cancel |
| Transfer, one account | only 1 account | "Add another account to move money between them." | Add account |

## Flow
Accounts -> "Add" sheet -> row -> detail -> "Add entry here" (AddSheet prefilled) / "Transfer" / "Edit" / "See all".

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Accounts | `/accounts` | "Add" | Screen, TabBar, Sheet, Pill |
| Account detail | `/accounts/:id` | "Add entry here" | Screen, StatGrid, EntryRow, Sheet (Edit, Transfer), Cta |

## Planned (approved 2026-10-29, not shipped)
- Accounts and Activity merge into the **Money** tab (D-0015): accounts and net worth on top, the full typed ledger below; account detail = the ledger filtered to that account.
- Balances are derived (D-0014): opening balance + entry effects. The Edit sheet loses the balance field. "Report balance" saves a **snapshot**; a gap between derived balance and the latest snapshot is shown and closed only by an **Adjustment** entry the Owner confirms.
- Investments value = market value of holding snapshots (with `fx_rates`), not a typed balance. Holdings become reportable.
- Net worth = cash + investments market value − credit owed, from the `net_worth` view.
- Transfers and invests are **moves** whose legs sum to zero (D-0007, D-0010).

## Interactions
| | |
|---|---|
| Owns | Account |
| Reads | entries (stats, recent), `profile.holdings`, `netWorth` |
| Writes | `upsert-account`, `remove-account`, `add-entries` (transfer, two linked legs) |
| Triggers | AddSheet with `accountId`; `/activity?acct=<id>` |
| Exposes | Account list to parsing (name, last4, alias), AddSheet/Review/Scan pickers, chat cash figure |
| Depends on | add-entry, activity, review (orphans), onboarding (first accounts), providers |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Removing an account with entries | Entries kept, orphaned to Review | handled in code |
| Negative balance | Allowed (Edit balance, credit, invest outflow); shown signed in red | handled in code |
| Deleting one transfer leg | Both legs go | handled in code (D-0010) |
| Transfer over balance (non-credit) | Blocked with "That would leave <A> at −₱X." | handled in code |
| Credit limit / due date | No limit; due date seed-only; paying the card only via Transfer | unhandled |
| Editing balance | Overwrite, no entry, breaks tie to entries | decided D-0014: removed in favour of snapshot + Adjustment (planned) |
| Type/provider after creation | Not editable (onboarding Edit allows type) | unhandled |
| Two accounts, same provider | Parser picks first in list order | handled in code |
| Short last4 | Substring collision with typed amounts | unhandled |
| Invest entries | Linked two-leg move when an investments account exists (see `add-entry`); otherwise outflow only | handled in code (D-0010) |
| INVESTED % | One weighted figure on every investments account | unhandled |

## Open questions
- Goals and the MariBank "Emergency fund" account are unrelated objects; link them?
- Credit-card sources skip the overdraw check; intended (paying the card is the point)?
