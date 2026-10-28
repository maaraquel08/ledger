---
type: rule
status: superseded
updated: 2026-10-29
related: [D-0001, constraints, features/receipt-scan, features/chat]
superseded_by: D-0012
---

# Nothing leaves the phone

> Superseded by D-0012 on 2026-10-29. Kept as history; do not apply.

**Rule.** *No entry, balance, photo or question is ever sent to a server.* All state lives in localStorage; OCR and the assistant run on the device.
**Authority.** Product principle 2 (`product.md`); README "the photo never leaves the phone"; "Ledger never connects to your bank" (`src/screens/accounts.tsx:99`).
**Enforced by.** Architecture: there is no network code except the one-time Tesseract engine download.
**On violation.** N/A today. Any future feature that needs a network must say so in its copy before the action.
**Design consequence.** No sync status, no "last synced", no account recovery. "Erase all data" is final and says so. Offline copy talks about the phone ("Entries save on your phone"), never a cloud. Copy that implies cloud accounts ("Create an account", "Sign in") is a known tension; see `research/RN-1-code-audit`.
