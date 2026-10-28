---
type: decision
area: design
status: superseded
updated: 2026-10-29
related: [design/work/critique-2026-10-19, rules/rule-daily-allowance, rules/rule-signed-money, rules/rule-ai-is-rules, glossary]
supersedes: []
superseded_by: D-0012
---

# D-0011 Copy says "saved on your phone", never "sync", until a sync exists

> Superseded by D-0012 on 2026-10-29. Kept as history; do not apply.

**Context.** Offline entries were labelled "waiting to sync" and "sync later", but nothing syncs (critique Q6, D-0001).

**Decision.** While Ledger is local-only, copy says "saved on your phone" / "On phone". The `queued` flag and the reconnect flush stay in the model so a future API can turn them into a real sync without a migration. Storage failure is shown as "Couldn't save on this phone." and never masked by a success toast.

| Option | Outcome |
|---|---|
| Honest local copy now (chosen) | No promise the product cannot keep |
| Keep "sync" | Reads as a lie until the backend ships |

**Consequences.** Glossary "Queued" updated. When the API ships, this decision is superseded by one that defines sync states.
**Revisit when.** The backend exists.
