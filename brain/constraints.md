---
type: fact
status: draft
updated: 2026-10-29
related: [design/design-system, features/receipt-scan, D-0008, D-0012, D-0013, D-0014, D-0016]
---

# Constraints

Only what changes a design decision. The repo is the source of truth for the rest.

| | |
|---|---|
| Platforms | Mobile browser only; 430px column (`Screen` primitive). Above 520px the page sits on a canvas colour. Installable meta present, no manifest. |
| Frontend | React 19, Vite, Tailwind v4, Base UI via sc1m registry, hash router (`src/lib/router.ts`). TypeScript. |
| Prototype / production repo | This repo is the prototype and the only implementation. `dist/` is a built copy. Backend lives in `supabase/` (migrations, Edge Functions, `CONTRACT.md`). |
| Modes (D-0012) | **Local mode** when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are absent: everything below about localStorage, regex parsing and canned chat applies. **Cloud mode** when they are set (planned): auth gate, Supabase data, M8 on Claude. The demo persona is local-only. |
| Backend (cloud mode, planned) | Supabase: Postgres is the source of truth with row-level security per user; Auth by email magic link, single Owner; private Storage buckets for receipt photos and voice clips; Edge Functions (Deno) for `capture`, `chat`, `insights-run`, `notify`; `pg_cron` + `pg_net` for schedules. Client-generated UUIDs make retries idempotent. Balances are derived views (D-0014). |
| AI (cloud mode, planned) | Claude, server-side only; keys in function secrets. Every number comes from SQL; prose uses fact placeholders and a digit validator (D-0013). Voice is transcribed server-side by a pluggable STT provider *(Claude's call)*. Not verifiable yet: no Supabase project, Anthropic or STT key exists. |
| Session | Local mode: none; "Sign in" loads a demo persona. Cloud mode (planned): email magic link for one Owner. |
| Storage (local mode) | All persistence goes through `src/lib/persistence.ts`: a `LedgerRepository` (load / save / clear) and a `PhotoStore` interface, with a localStorage implementation (`ledger:v1` for state, `ledger:photos:v1` for receipt photos, JPEG data URLs, max edge 720px, newest 40 kept). Load migrates legacy goal dates ("Jan 2027" to "YYYY-MM") and photos embedded in entries. `src/lib/store.tsx` is the only caller, so an API-backed repository swaps in there. A failed state or photo write shows one `role="alert"` storage banner (rendered once, in `App.tsx`) ("Couldn't save on this phone. Free up space or delete receipt photos."); nothing retries silently. sessionStorage holds onboarding draft, scan handoff, Insights period, chat transcript. |
| Offline | Local mode (shipped): everything is saved on the phone; copy says "saved on your phone", never "sync". Entries made offline are flagged `queued` (chip "On phone") and the flag is cleared when Home is next open and online. Questions never need a connection (D-0008). Only the first receipt scan (OCR engine download) and voice input depend on the network. Cloud mode (planned, D-0012): offline entries are "Saved on this phone" until the server acknowledges them, then "Synced"; M8's open questions, Claude parsing and receipt vision need a connection. |
| Limits | Chat input 500 chars; no Owner-facing daily question limit (D-0008); any cap on Claude calls is enforced server-side (D-0016); entry text 160 chars; note 80 chars; receipt OCR English only. |
| Notifications (planned, D-0016) | In-app insight inbox; Web Push only for an installed PWA (needs a manifest and service worker, not present today); max 3 pushes a week, no amounts, quiet 22:00–07:00 Asia/Manila; no email. |
| Money | ₱ primary, whole pesos in UI; `numeric(14,2)` in the database; currency per entry and holding, `fx_rates` for investments. |
| Voice | Web Speech API, `en-PH`, hold-to-talk. Unsupported on some browsers; copy covers denied / unsupported / network. |
| Camera | `getUserMedia` rear camera, or file picker fallback. |

## Integrations
| System | For | Sync | Failure users see | Design consequence |
|---|---|---|---|---|
| Tesseract.js (CDN) | On-device receipt OCR (local mode) | Engine + English data downloaded on first scan, then browser-cached | "COULDN'T START THE READER … Connect to the internet and retake, or type the total." | First scan needs a connection; always offer "Type the total" |
| Web Speech API | Hold-to-talk on Home, mic in Add sheet and Chat | Live | "Voice isn't available here" / "Microphone is off" | Every voice surface has a typed path |
| Supabase (planned) | Ledger data, auth, photos and clips, schedules | Each write acknowledged by an RPC; queued writes retry | "Saved on this phone" until synced; sign-in errors | Never show "synced" before the acknowledgement (D-0012) |
| Claude via Edge Functions (planned) | Capture parsing, receipt vision, chat, insights | Per request; insights on cron | Low-confidence capture lands in Review; failed answer needs copy (open) | Numbers only from facts (D-0013) |
| STT provider (planned) | Voice clip transcription in cloud mode | Per clip | Transcription failure falls back to typed path | Provider is swappable *(Claude's call)* |
| Web Push (planned) | Weekly review and material alerts | Per insight | None if not installed or denied | Inbox always holds the same insight (D-0016) |
| Provider logos (`public/assets`) | Account tiles | Static | Mono "?" fallback | New providers need a logo or icon |
