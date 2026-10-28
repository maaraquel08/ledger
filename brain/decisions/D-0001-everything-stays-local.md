---
type: decision
area: product
status: superseded
updated: 2026-10-29
related: [rules/rule-nothing-leaves-the-phone, constraints, features/receipt-scan]
supersedes: []
superseded_by: D-0012
---

# D-0001 Everything stays on the phone

> Superseded by D-0012 on 2026-10-29. Kept as history; do not apply.

**Context.** A money app needs trust before it needs features. The prototype had to work with no backend and no credentials.

**Decision.** All state lives in localStorage on the device. Receipt OCR runs on-device (Tesseract.js). There is no sign-up, login, sync or bank connection.

| Option | Outcome |
|---|---|
| Local only (chosen) | Zero setup, strong privacy story; no backup, quota risk from photos |
| Cloud accounts | Needs auth, server, privacy policy; contradicts "never connects to your bank" |
| Bank aggregation | Out of scope; copy promises the opposite |

**Consequences.** "Erase all data" is irreversible. First receipt scan needs a connection to fetch the OCR engine. Welcome copy ("Sign in", "Create an account") reads like cloud accounts and should be reconciled.
**Revisit when.** Users ask for a second device or lose data to a cleared browser.
