---
type: decision
area: product
status: active
updated: 2026-10-29
related: [features/chat, features/add-entry, features/receipt-scan, features/review, features/insights, users, glossary, rules/rule-ai-is-rules, D-0008, D-0012, D-0016]
supersedes: [D-0002, rules/rule-ai-is-rules]
superseded_by: null
---

# D-0013 M8 runs on Claude, and every number is computed, not written

**Context.** Regex intents and fixed templates cannot give the Owner tangible analysis or understand free-form capture (spec 2026-10-29). D-0012 makes a server available. The anti-goal: a number on screen or in an M8 sentence that disagrees with the database. Decided by the Owner on 2026-10-29.

**Decision.** In cloud mode M8 is Claude, called only server-side from Edge Functions (keys in function secrets, never in the app). M8 keeps its name, first-person voice and gold treatment (D-0003).
- **Numbers are deterministic.** Every number shown or cited is computed in SQL. Claude writes prose with **fact** placeholders; the server substitutes the numbers; a digit validator rejects any digit in the prose that did not come from a fact.
- **Capture confidence gate.** A captured entry saves instantly (with Undo) only when a code-side gate passes: amount literally in the input or receipt text; account resolved by exact alias; category from a learned rule or Claude agrees with the regex parser; date parses and is not in the future; no likely duplicate (same amount and merchant within 48 h); amount ≤ 3× the category median; no ambiguous fields. Otherwise the entry lands in Review with one targeted question (D-0005 still holds). Corrections become learned **rules**.
- **Chat tools are read-only.** Chat may only call read tools (metrics, entries matching, goal progress). Captured text, receipts and transcripts are data, never instructions.
- **M8 never moves money** and never edits entries on its own; creating a goal still needs the Owner's tap.
- Local mode keeps the deterministic rules, regex parsers and canned chat of D-0002.

*(Claude's call)*, recorded in the spec, not confirmed line by line: `claude-haiku-5-5` for text parsing and the daily one-liner, `claude-sonnet-5-5` for receipt vision, chat and weekly/monthly reviews; voice clips transcribed by a pluggable server-side STT provider (first: OpenAI transcription) because Claude does not take audio.

| Option | Outcome |
|---|---|
| Claude with fact placeholders and a gate (chosen) | Open questions and real analysis; numbers stay provable |
| Keep rules (D-0002) | Honest but narrow; no tangible analysis |
| Claude writes numbers freely | Fastest to build; violates the anti-goal |

**Consequences.** `rules/rule-ai-is-rules` is superseded. In cloud mode chat and capture parsing need a connection, so D-0008's "answers offline" holds only in local mode; capture still saves offline as "Saved on this phone" (D-0012). Limits on Claude calls (e.g. chat questions per day) are a server concern (D-0016). Receipt OCR moves from on-device Tesseract to Claude vision in cloud mode.
**Revisit when.** The validator rejects many answers, or the gate sends more than 10% of entries to Review.
