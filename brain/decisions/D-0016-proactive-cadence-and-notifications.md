---
type: decision
area: product
status: active
updated: 2026-10-29
related: [features/insights, features/home, features/chat, constraints, glossary, D-0008, D-0012, D-0013]
supersedes: []
superseded_by: null
---

# D-0016 M8 speaks on a cadence, and pushes rarely

**Context.** The Owner wants proactive summaries and suggestions; the anti-goal is an assistant that nags. D-0008 left limits to "a server concern" once a real API exists; this is that decision. Decided by the Owner on 2026-10-29.

**Decision.**
- **Cadence.** A daily one-liner (in-app only), a weekly review on Sunday, a monthly close on the first Sunday of the month, and anomaly alerts. Deterministic triggers decide whether anything is worth saying before Claude is called; "nothing to flag" is a valid result. Each output is an **Insight** in the in-app inbox.
- **Push.** Web Push only for an installed PWA, and only for the weekly review and material alerts. Max 3 pushes a week. No amounts in push text. Quiet hours 22:00–07:00 Asia/Manila. No email.
- **Limits are server-side.** Any cap on Claude calls (e.g. chat questions per day, insight runs) is enforced in Edge Functions, never as UI scarcity. D-0008's "no question cap" stays the Owner-facing rule until a server limit is decided and named in copy.

*(Claude's call)*: the notifications channel (in-app inbox + Web Push, reviewers split 2 of 3 for push).

| Option | Outcome |
|---|---|
| Inbox + rare push (chosen) | Proactive without nagging; works on an installed PWA |
| In-app only | Weekly review is missed if the app isn't opened |
| Email | Another channel to keep honest; rejected |

**Consequences.** Push copy is written without numbers ("Your weekly review is ready"). The Owner can turn push off. Insight inbox replaces the chat "SAVE TO INSIGHTS" flag (planned).
**Revisit when.** The Owner dismisses most pushes unread, or asks for email.
