---
type: decision
area: product
status: active
updated: 2026-10-19
related: [design/work/critique-2026-10-19, rules/rule-daily-allowance, rules/rule-signed-money, rules/rule-ai-is-rules, glossary]
supersedes: []
superseded_by: null
---

# D-0006 Today's number has one formula: todayBudget

**Context.** Home showed `todayBudget().left` while The math, the Budgets ring and the chat "daily math" answer explained `verdict().perDay`; they only agree on a day with no spend (critique 2026-10-19, B4/B1).

**Decision.** `todayBudget()` (`src/lib/today.ts`) is today's number everywhere it is called "today": the Home hero, The math, the chat header and the chat "daily math" answer, with the same rows (budget − spent before today ÷ days left = allowance; − spent today on day-to-day = left). `verdict().perDay` survives only as the **month pace** on the Budgets ring and is labelled as pace, never as today's number.

| Option | Outcome |
|---|---|
| todayBudget everywhere "today" (chosen) | Hero and its explanation agree; bills and groceries still come out of the pool from tomorrow |
| verdict everywhere | Simpler maths, but today's coffee would not lower today's number |

**Consequences.** `rules/rule-daily-allowance` loses its "two formulas" caveat. Any new surface that says "today" calls `todayBudget`.
**Revisit when.** Users ask why groceries bought today do not lower today's number.
