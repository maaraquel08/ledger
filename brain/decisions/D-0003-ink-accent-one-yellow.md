---
type: decision
area: design
status: draft   # inferred from ledger.css comments; confirm to activate
updated: 2026-10-19
related: [design/design-system, features/home, rules/rule-ai-is-rules]
supersedes: []
superseded_by: null
---

# D-0003 Espresso ink is the accent; yellow is for add and live; gold is for M8

**Context.** sc1m ships an orange accent. Ledger wanted a calmer, paper-and-ink feel with one signal colour.

**Decision.** `--accent` is the espresso ink `#252017`, carrying every CTA, active nav and hero number. `--highlight` yellow `#fcc305` is reserved for the add button and the live voice state (orb rings, waveform). AI text and marks use gold ink `#7a6300`, and AI panels use the espresso-and-gold paint palette. Money in is success green, money out is danger red, goals are info blue. (`src/styles/brands/ledger.css:24-64`)

| Option | Outcome |
|---|---|
| Ink accent + one yellow (chosen) | Calm surfaces, the yellow reads as "act now" |
| sc1m orange | Louder, generic |
| Yellow as full accent | Yellow on white fails contrast for text |

**Consequences.** Yellow must never carry text. The code currently uses `bg-highlight` beyond the FAB (voice stage, rings); treat that as the "live" use, not a licence for decoration. Dark values exist but no toggle is wired.
**Revisit when.** A second brand moment needs colour, or dark mode ships.
