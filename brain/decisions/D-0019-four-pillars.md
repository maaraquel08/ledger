---
type: decision
area: product
status: draft
updated: 2026-11-03
related: [features/add-entry, features/accounts, features/analytics, features/chat, features/budgets-and-goals, D-0010, D-0014, D-0016]
supersedes: [D-0016]
superseded_by: null
---

# D-0019 Four pillars: entries, accounts, analytics, chat; extras removed

**Context.** On 2026-11-03 the Owner set four non-negotiables: Expense / Income / Transfer entries, account tracking (cash, e-wallet, bank, investments, credit card), analytics, and an AI chat that answers from their history and advises. They asked to remove what doesn't serve them.

**Decision.**
- Add opens on an **Expense | Income | Transfer** switch. A Transfer picks From and To; into an investments account it files as Investments (D-0010), otherwise Transfer. Account detail's Transfer uses the same rule (`moveLegs`).
- Account types the Owner can create: cash, e-wallet, bank, investments, and credit card (the Owner reversed the credit removal on 2026-11-03). Holdings and side income are gone.
- Removing (or archiving, in the cloud) an account drops its legs of moves; the twin on the surviving account stays as a plain entry (`detachAccounts`). Other entries go to Review.
- Removed: voice logging, the insight inbox, the stored M8 review card, push notifications and the scheduled insight runs (migration `…002000`). Receipt scanning stays.
- Goals get **Add money**: a number on the goal, no account moves.
- Chat gains `top_entries` and `budget_status`, any-year `monthly_spend`, and a category filter on `find_entries`. Advice may run to ~5 sentences plus 2–4 actions. An answer that didn't come from the AI says so.

| Option | Outcome |
|---|---|
| Four pillars, extras removed (chosen) | Less surface; every screen serves one of the four jobs |
| Keep everything | Voice, push and insights kept costing AI calls and attention for unused features |

**Consequences.** `features/insights.md` and D-0016 describe removed behavior. Server tables for insights, push and holdings stay for history and export.
**Revisit when.** The Owner asks for proactive nudges again.
