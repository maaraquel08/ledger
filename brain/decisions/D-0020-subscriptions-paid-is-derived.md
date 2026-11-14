---
type: decision
area: product
status: draft
updated: 2026-11-14
related: [features/subscriptions, features/accounts, glossary, system-map, D-0014, D-0012, D-0013, D-0007]
supersedes: []
superseded_by: null
---

# D-0020 Subscription paid status is derived from entries, never stored

**Context.** The Owner wants Upcoming bills on Money, and a bill counted as paid when they log the payment themselves, however they log it (typed, voice, receipt, server capture). Decided by the Owner on 2026-11-14.

**Decision.** A subscription is a row in the existing `recurring_items` table (monthly only; delete sets `active = false`). Whether a month is paid is never stored: an entry pays it when it is spending, matches the subscription's name, and is within 50–150% of its amount (rule in `features/subscriptions`). Next due = the cycle date after the number of paying entries. Card bills are derived from credit accounts with a due date. Nothing links an entry to a subscription in the data.

| Option | Outcome |
|---|---|
| Derived by matching, reuse `recurring_items` (chosen) | Works for every logging path including server capture; no migration; deleting an entry un-pays; same idea as D-0014; same amount band as the server's `recurring_missed` |
| Store a paid flag or `entries.subscription_id` | Needs a migration and every capture path to set it; can drift from entries |
| New subscriptions table | Duplicates `recurring_items`, which M8 and `detect_anomalies` already read |

**Consequences.** No manual link or unlink: to uncount a payment, rename or delete the entry. A payment renamed to something unrelated may not count; Mark paid always writes the subscription's name. Matching is a client rule that the server does not run.
**Revisit when.** False matches or misses become common, or yearly cycles need an explicit link.
