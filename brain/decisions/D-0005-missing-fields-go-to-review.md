---
type: decision
area: product
status: draft   # inferred from code; confirm to activate
updated: 2026-10-19
related: [features/review, features/add-entry, features/home, features/receipt-scan, rules/rule-signed-money]
supersedes: []
superseded_by: null
---

# D-0005 An entry saves without a category or account and goes to Review

**Context.** Principle 1: one line is a whole entry. Forcing the Owner to pick a category or account at log time would make voice and text logging slower than the thing it replaces.

**Decision.** Only an amount is required to log. Missing category or account saves anyway; the entry shows "Needs category" / "ACCOUNT?" and appears in the Review queue with suggestions. Home asks "ONE QUESTION" (which account?) for a single spoken entry only.

| Option | Outcome |
|---|---|
| Save, then Review (chosen) | Logging stays one step; totals include unfiled spend |
| Block until complete | Slower, more abandoned entries |
| Guess silently | Wrong categories poison insights |

**Consequences.** Null category still counts as spending (`rule-signed-money`). Review is the only screen with bulk action ("Accept suggestions"). Removing an account orphans its entries into Review by design.
**Revisit when.** Review queues grow past a handful and users stop clearing them.
