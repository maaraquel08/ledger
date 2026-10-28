---
type: decision
area: product
status: active
updated: 2026-10-19
related: [design/work/critique-2026-10-19, rules/rule-daily-allowance, rules/rule-signed-money, rules/rule-ai-is-rules, glossary]
supersedes: []
superseded_by: null
---

# D-0007 A bill paid to a merchant is never a Transfer

**Context.** `parseSpoken` turned "paid Meralco 3100" into a Transfer to a person, which `isSpend` excludes, so the bill never touched today's number and Review never caught it (critique B2).

**Decision.** A spoken or typed line is a transfer to a person only when no spending keyword and no account or provider word matched. If a keyword category was found, it wins. Transfers between the Owner's own accounts are made from the Accounts screen and always carry a `linkId` joining both legs.

| Option | Outcome |
|---|---|
| Keyword wins over the transfer verb (chosen) | Bills and merchants file correctly; "paid Ana back 500" still works |
| Ask every time | Slower logging for a rare case |

**Consequences.** Glossary "Transfer" = between own accounts or to a person, never a merchant. Both legs of an account transfer or investment are deleted together.
**Revisit when.** A person's name collides with a keyword (e.g. "Shell").
