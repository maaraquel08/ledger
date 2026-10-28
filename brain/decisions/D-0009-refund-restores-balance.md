---
type: decision
area: product
status: active
updated: 2026-10-19
related: [design/work/critique-2026-10-19, rules/rule-daily-allowance, rules/rule-signed-money, rules/rule-ai-is-rules, glossary]
supersedes: []
superseded_by: null
---

# D-0009 Marking an entry refunded restores the account balance

**Context.** "Mark as refunded" excluded the entry from spending but left the balance spent (critique M4, RN-1).

**Decision.** A refunded entry contributes nothing to its account: the reducer treats its effect as zero on add, update and delete. Refund is only offered on expenses; income is deleted or edited instead.

| Option | Outcome |
|---|---|
| Refund = reverse the balance, keep the entry (chosen) | Balance and spending agree; history kept, struck through |
| Refund as a new positive entry | Clutters Activity; sign rules get murky |

**Consequences.** Entry detail says what a refund puts back and where.
**Revisit when.** Partial refunds are needed.
