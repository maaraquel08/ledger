---
type: decision
area: product
status: active
updated: 2026-10-29
related: [features/accounts, features/activity, rules/rule-signed-money, glossary, system-map, D-0009, D-0010, D-0012]
supersedes: []
superseded_by: null
---

# D-0014 Balances are derived; reported balances are snapshots

**Context.** Account balances were manual numbers that the Edit sheet could overwrite with no entry, breaking the tie between entries and balances (`features/accounts`, `rule-signed-money`). A source of truth (D-0012) cannot have two answers for one balance. Decided by the Owner on 2026-10-29.

**Decision.** An account's balance is always derived: opening balance + the effect of every posted entry (credit sign flipped, refunded entries contribute nothing, D-0009). When the Owner reports what an account actually holds, it is stored as a **snapshot** (account, as of, amount); it never changes the balance. A gap between the derived balance and the latest snapshot is shown, and it is closed only by an explicit **Adjustment** entry (category Adjustment) that the Owner confirms. Direct balance edit is removed.

| Option | Outcome |
|---|---|
| Derived + snapshots + Adjustment (chosen) | One answer per balance; every peso has an entry; gaps are visible |
| Manual balance overwrite | Simple; balances drift from entries silently |
| Auto-adjust on every report | Hides missing entries the Owner should log |

**Consequences.** The account Edit sheet loses the balance field (planned); "report balance" and "record adjustment" replace it. Adjustment is neither spending nor income in totals. Onboarding balances become opening balances. Holdings are reported as holding snapshots; investments value = market value from holdings.
**Revisit when.** The Owner finds closing gaps one Adjustment at a time too slow.
