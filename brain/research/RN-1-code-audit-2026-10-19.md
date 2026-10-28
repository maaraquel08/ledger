---
type: research
status: draft
updated: 2026-10-19
related: [system-map, rules/rule-daily-allowance, rules/rule-signed-money, features/chat, features/insights, features/accounts, design/design-system]
---

# RN-1 Code audit, 2026-10-19

Raw notes from reading `src/` to bootstrap this brain. Two passes: features (routes, store, screens, parsing, OCR, chat rules) and design surface (tokens, primitives, motion, copy). Not run; regex behaviour marked (unverified). Each item is a hypothesis for the Owner to confirm or decide.

## Copy that the code does not back up
| Where | Copy | Code | File |
|---|---|---|---|
| Chat footer | "RESETS TOMORROW" | `questionsToday` only ever increments | `src/lib/store.tsx:77` |
| Insights gate | "Monthly needs 30 days" | gate is 7 logged days for every period | `src/screens/insights.tsx:580` |
| Chat answer | "SAVE TO INSIGHTS" | flips a flag on the message; Insights never reads it | `src/screens/chat.tsx` |
| Onboarding Ready | "set one anytime from Home" | budget editor is Insights › Budgets | `src/screens/onboarding.tsx:563` |
| Home vs The math | one number, its explanation | `todayBudget().left` vs `verdict().perDay`, different formulas | `src/lib/today.ts:14-32`, `selectors.ts:86-112` |
| Welcome | "Sign in", "Create an account" | no credentials; demo loader and local setup | `src/screens/welcome.tsx:74-84` |
| Welcome tape | "+₱52,000 salary" etc. | static marketing rows, not the persona's numbers | `welcome.tsx:6-39` |

## Unhandled edge cases (money)
- `peso()` drops the sign, so a non-credit balance below zero renders as positive (`src/lib/format.ts:1-4`, `accounts.tsx:55`).
- Transfers have no balance guard and the two legs are not linked; deleting one unbalances (`accounts.tsx:450-515`).
- "Mark as refunded" excludes the entry from spend but does not restore the balance.
- Editing an entry's category flips its sign (`activity.tsx:586`).
- Goals with a `by` that is not "Mon YYYY" (e.g. "No date") give NaN in the goal-pace answer (unverified).
- Many receipt photos can exceed the localStorage quota; the failed write is swallowed and nothing persists after that (`store.tsx:98-100`).
- `daysLogged` keys by UTC date, not local day; a 06:00 payroll lands on the previous day (`selectors.ts`).
- Erase all data leaves sessionStorage (chat, onboarding draft).
- `/onboarding/*` reachable when onboarded; finishing would overwrite accounts.
- Typed duplicates are never detected; only receipt-vs-existing (±₱1, 3h).

## Parse quirks (unverified until run)
- Last number wins: "5kg rice 300" → 300, but "7-Eleven" with no amount → ₱7.
- A last4-only string ("gcash 8871") makes 8871 the amount.
- `isQuestion` routes anything starting with "is / do / where…" to chat, so "Is cream 120" never logs.
- Transfer-to-person needs a capitalised name; transcripts may not capitalise.

## Design drift (details in `ledger-design-taste/references/interaction-and-motion.md` › Known drift)
Yellow used beyond the FAB; 25 arbitrary type sizes; radius 18/26/27/28px off-ramp; no `focus-visible` on custom controls, `outline-none` ×9; placeholder `#b5b5b5` ~2:1; dark tokens unwired and some hex would break dark; gutters px-4/5/6/8; sc1m Button/Badge/Banner/Input/Progress/Avatar/Toggle installed but unused; literal durations 150/200/220/250/300/500ms; second SpeechRecognition implementation in `add-sheet.tsx:90-123`; literal "↑" send glyph; `@import` of the brand file mid-`index.css`.

## Not determined
Tesseract CDN pinning and offline behaviour after first use; real localStorage quota impact; whether Date parsing of "1 Jan 2027" holds in every browser; intended behaviour for every copy/code mismatch above.
