---
type: rule
status: draft
updated: 2026-10-29
related: [features/activity, features/accounts, features/add-entry, glossary, D-0007, D-0009, D-0010, D-0014]
---

# Signed money

**Rule.** *An entry's amount is signed: negative is money out, positive is money in. Spending is a negative entry whose category is not Investments or Transfer and that is not refunded. Income is a positive entry whose category is not Investments or Transfer.* (`src/lib/selectors.ts:4-11`)
**Authority.** Code invariant; every total, insight and verdict derives from it.
**Enforced by.** System: `add-entry` applies the amount to the account balance; `update-entry` and `delete-entry` reverse the old effect first (`src/lib/store.tsx:35-57`). Credit accounts invert: a spend raises the amount owed (`store.tsx:20-25`).
**On violation.** Not possible through the reducer. Today the account Edit sheet can still overwrite a balance without an entry; D-0014 removes that (planned): a balance is opening balance + entry effects, an owner-reported balance is a snapshot, and a gap is closed only by an Adjustment entry.
**Design consequence.**
- Display sign with the typographic minus "−" and colour: out = danger red, in = success green; `peso()` itself is unsigned.
- Changing an entry's category can flip its sign (Income/Salary → positive, anything spendable → negative), so category pickers on edit must make that visible.
- Adjustment entries (D-0014) move a balance but are neither spending nor income.
- A refunded entry contributes nothing to its account balance (D-0009). Transfers and investments are two legs joined by `linkId`; deleting one deletes both (D-0007, D-0010). A null category still counts as spending.
