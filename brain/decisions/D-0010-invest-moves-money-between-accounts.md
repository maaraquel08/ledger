---
type: decision
area: product
status: active
updated: 2026-10-19
related: [design/work/critique-2026-10-19, rules/rule-daily-allowance, rules/rule-signed-money, rules/rule-ai-is-rules, glossary]
supersedes: []
superseded_by: null
---

# D-0010 Invest is a linked move from a source account to an investments account

**Context.** The Add sheet's "Invest" kind only recorded an outflow; nothing ever credited an investments account, so invested balances drifted from entries (critique Q5).

**Decision.** When an investments account exists, Invest creates two linked legs (−amount from the source, +amount to the investments account, both category Investments, same `linkId`), exactly like a transfer. Without an investments account it stays a single outflow and the form says so.

| Option | Outcome |
|---|---|
| Linked legs (chosen) | Invested balance follows entries; delete removes both |
| Outflow only | Investments balance stays manual |

**Consequences.** Holdings remain seed-only display; the investments account balance is the number that moves.
**Revisit when.** Holdings become editable.
