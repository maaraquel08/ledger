---
type: decision
area: product
status: active
updated: 2026-10-19
related: [design/work/critique-2026-10-19, rules/rule-daily-allowance, rules/rule-signed-money, rules/rule-ai-is-rules, glossary]
supersedes: []
superseded_by: null
---

# D-0008 M8 has no daily question cap and answers offline

**Context.** Chat enforced 20 questions per install while promising "RESETS TOMORROW", and refused to answer offline although nothing is fetched (critique B5, M8).

**Decision.** No cap. M8 answers whether or not the phone is online; the counter stays as telemetry and resets per local day. Only voice input and The math's first-open skeleton may still mention a connection.

| Option | Outcome |
|---|---|
| No cap, works offline (chosen) | Honest with D-0001 and D-0002; nothing to explain |
| Daily cap with real reset | Fake scarcity for a local function |

**Consequences.** Chat loses the offline banner, the failed-message card and the limit footer. When a real API exists, limits are a server concern and get their own decision.
**Revisit when.** M8 moves to a hosted model.
