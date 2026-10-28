---
type: rule
status: superseded
updated: 2026-10-29
related: [D-0002, users, features/chat, features/activity, features/insights, features/receipt-scan]
superseded_by: D-0013
---

# M8 is rules, not a model

> Superseded by D-0013 on 2026-10-29. Kept as history; do not apply.

**Rule.** *Every sentence M8 says is produced by a deterministic rule over local data. M8 may create a goal when the Owner taps an offer, and nothing else.* (README; `src/screens/chat.tsx:33-207`)
**Authority.** Product principle 4; README "No model or network call is made."
**Enforced by.** Architecture. Chat intents are regex matches, first hit wins, no memory between turns.
**On violation.** N/A. Any future model call would break `rule-nothing-leaves-the-phone` and must be a decision.
**Design consequence.**
- Design M8 copy as fixed templates with one highlighted finding (`AiMark`), never free text.
- Unanswerable questions get the fallback that lists what M8 can do; do not design open-ended chat affordances.
- Every AI surface is visually marked (gold eyebrow with sparkle, espresso paint) so the Owner can tell computed text from their own.
- "I never move money" is a promise in the empty chat state; keep it true.
