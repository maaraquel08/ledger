---
type: decision
area: product
status: superseded
updated: 2026-10-29
related: [rules/rule-ai-is-rules, features/chat, users]
supersedes: []
superseded_by: D-0013
---

# D-0002 M8 is a named voice over deterministic rules

> Superseded by D-0013 on 2026-10-29. Kept as history; do not apply.

**Context.** The product wants the feel of an assistant that reads your money, but D-0001 forbids network calls and a local model is too heavy for a mobile prototype.

**Decision.** The assistant is called **M8**, speaks in first person, and every utterance is a rule: today's number, M8's note on an entry, weekly and yearly insight lines, receipt doubts, and eight chat intents with a fixed fallback. M8 may create a goal when offered and tapped. It never edits entries or moves money.

| Option | Outcome |
|---|---|
| Rules with a persona (chosen) | Predictable, testable, honest copy; limited question range |
| Hosted LLM | Breaks D-0001; non-deterministic money advice |
| No persona | Loses the "one sentence, then the math" feel |

**Consequences.** Fallback copy must list what M8 can do. The 20-questions-a-day limit is a design affordance, not a cost control. All AI surfaces use the gold eyebrow + espresso paint treatment (D-0003).
**Revisit when.** A local on-device model becomes viable, or users hit the fallback more than the intents.
