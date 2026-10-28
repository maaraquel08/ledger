---
type: index
status: active
updated: 2026-10-29
---

# Changelog

Reverse chronological. One line per meaning change so an AI can answer "what was true on date X" and "what changed since". Kinds: **shipped** (reached users), **decided** (new or superseded D-*), **changed** (an active file's meaning changed), **added** (new file), **feedback** (new FB-* or status change), **brain** (structure, conventions, templates, CLAUDE.md). Every change to any file gets a line; see *Write protocol* in `CLAUDE.md`.

Format: `- kind — what, in one sentence — files`

## 2026

### 2026-10-29
- decided — D-0018 removes the Review tab (Owner request): three tabs Today / Money / Analytics, Review opens from Today's "things to review" row, which also counts balance gaps; supersedes D-0017 — `decisions/D-0018-review-has-no-tab.md`, `decisions/D-0017-four-tabs.md`, `features/review.md`, `system-map.md`
- decided — D-0017 four tabs Today · Money · Analytics · Review on the Owner's request ("Why we don't have analytics page?"); supersedes D-0015 — `decisions/D-0017-four-tabs.md`, `decisions/D-0015-three-tabs.md`
- shipped — Analytics tab (`/analytics?p=week|month|year&at=`): period stepping, like-for-like and trailing-average headline, trend chart with table view, habits, recurring bills, income, deterministic "What this means" cards with tap-through to the exact entries, cloud review for the period; `/insights` redirects there — `features/analytics.md` (added), `features/insights.md` (superseded), `system-map.md`, `src/screens/analytics.tsx`, `src/lib/analytics.ts`
- shipped — Today drops the week / month / year analysis for a "This month so far" row into Analytics and an "N entries to review" row; tab screens pad by `--tab-clearance` so the Add button no longer covers the last goal row — `features/home.md`, `system-map.md`
- changed — Glossary adds Analytics, Like for like, Trailing average, Savings rate, Recurring bill; Today no longer holds the period analysis — `glossary.md`
- changed — Daily allowance prorates the first, partial month from the ledger's start; over-budget wording is "over pace" / "₱X over budget" — `rules/rule-daily-allowance.md`, `glossary.md`
- changed — Copy no longer promises the photo stays on the phone: receipt-scan permissions, add-entry Camera label and onboarding copy now say it stays only in local mode and is uploaded in cloud mode — `features/receipt-scan.md`, `features/add-entry.md`, `features/onboarding.md`
- changed — Brain re-pointed at the CFO direction: principle 2 is now "Every number is provable", non-goals drop backend / real AI / cloud accounts (bank sync stays out), users lose "cannot call a network", constraints add Supabase, Edge Functions, Claude, push and local vs cloud mode, system map gains the planned cloud objects, events, EC-011–012 and three-tab navigation, and each affected feature gets a "Planned" section — `product.md`, `users.md`, `constraints.md`, `system-map.md`, `rules/rule-signed-money.md`, `features/{home,accounts,activity,review,insights,budgets-and-goals,chat,add-entry,receipt-scan,onboarding}.md`
- changed — Glossary adds Synced, Cloud mode, Local mode, Snapshot, Adjustment, Move, Insight, Fact, Raw input, Rule (learned rule), Today, Money; Account, Review, Receipt, Queued and M8 updated — `glossary.md`
- decided — Owner-approved CFO direction (spec `docs/superpowers/specs/2026-10-29-cfo-agent-design.md`): D-0012 Supabase holds the ledger with sync states (supersedes D-0001, D-0011, `rule-nothing-leaves-the-phone`); D-0013 M8 runs on Claude with deterministic numbers (supersedes D-0002, `rule-ai-is-rules`); D-0014 balances are derived, snapshots + Adjustment; D-0015 three tabs Today / Money / Review; D-0016 proactive cadence and push limits (follows D-0008) — `decisions/D-0012` … `D-0016`, `decisions/D-0001`, `D-0002`, `D-0011`, `rules/rule-nothing-leaves-the-phone`, `rules/rule-ai-is-rules`
- shipped — AddSheet now has a Manual / Voice / Camera switch: Manual draws the entry as its Activity row with gold missing parts over the same pickers (sentence removed), Voice is the Home hold-to-talk orb with one or many entries, Camera reads a receipt in the sheet into one split entry; the typed field is gone and the camera hook and orb are shared with /scan and Home — `features/add-entry.md`, `features/receipt-scan.md`, `system-map.md`, `src/components/ledger/{add-sheet,entry-draft,orb,camera}.tsx`, `src/lib/camera.ts`

### 2026-10-24
- shipped — Add entry form mode is now a tappable sentence (Study B): ranked category and account pickers in one panel, whole-peso keypad, "GCash ·8871" account names, four-line sentence box that scrolls with edge fades — `features/add-entry.md`, `src/components/ledger/{add-sheet,sentence-entry}.tsx`

### 2026-10-20
- added — sc1m `Switch` installed from the registry (`src/components/ui/switch/`), exported from the design-system barrel with a doc stub; not yet used by a screen, not yet re-synced to Claude Design — `design/design-system.md`

### 2026-10-19
- shipped — Ledger components synced to Claude Design project "Ledger Design System" (68 components, 46 authored previews, brain files shipped as guidelines); DS entry `src/ds/`, build `npm run build:ds`, sync inputs in `.design-sync/` — `design/design-system.md`, `../README.md`
- shipped — Home receipt card enters and exits with the transitions.dev toast recipe tuned to a pure slide (up 28px in, down out; open 350 ms, close 250 ms, reduced-motion guard) — `features/home`, `design/design-system`
- decided — Owner questions from the 2026-10-19 critique answered: one daily formula, merchants never transfers, no question cap, refund restores balance, Invest is a linked move, "saved on your phone" copy — `decisions/D-0006` … `D-0011`
- changed — Rules, glossary and system map updated for D-0006–D-0011; Conflicts closed; EC-005 handled, EC-008–010 added — `rules/rule-daily-allowance`, `rules/rule-signed-money`, `glossary.md`, `system-map.md`
- shipped — Home treats "show me / tell me / explain …" as questions for M8 (`src/lib/parse.ts` `isQuestion`) — `features/home`
- shipped — Follow-ups from the brain sync: Home routes questions and opens The math offline (D-0008), one storage banner in `App.tsx`, failed photo writes reach the banner — `features/home`, `constraints.md`
- shipped — Blockers 1–9 from the critique implemented in `src/` with a persistence layer (`src/lib/persistence.ts`) ready to swap localStorage for an API — see `design/work/critique-2026-10-19.md`
- brain — Brain re-pointed from the ecoportal scaffold to Ledger; ecoportal example feature, rule, decisions D-0001–3, FB-1, RN-1, RI-1 removed — `CLAUDE.md`, `features/`, `rules/`, `decisions/`, `feedback/`, `research/`
- changed — Product, glossary, users, constraints, system map and screen inventory drafted from `src/` (all `status: draft`) — `product.md`, `glossary.md`, `users.md`, `constraints.md`, `system-map.md`, `design/screens.md`
- added — One feature file per shipped feature: onboarding, home, add-entry, receipt-scan, activity, review, accounts, insights, budgets-and-goals, chat — `features/*`
- added — Four rules drafted from code invariants — `rules/rule-nothing-leaves-the-phone`, `rule-signed-money`, `rule-daily-allowance`, `rule-ai-is-rules`
- decided — Five draft decisions inferred from code and README, pending Owner confirmation — `decisions/D-0001` … `D-0005`
- added — Code audit notes: copy the code does not back up, unhandled money edge cases, parse quirks, design drift — `research/RN-1-code-audit-2026-10-19`
- changed — Design system pointer now names sc1m + Ledger brand layer and the `ledger-design-taste` skill; `ds:` refs mapped — `design/design-system.md`
- brain — Sova wiring: the design pack lives in `design/` (`product.md` is config only: sources → this brain, `slots.taste: ledger-design-taste`; taste skill at `design/ledger-design-taste/`, working files at `design/work/`); the root `CLAUDE.md` names it with `design_pack:`, `.claude/skills/ledger-design-taste` is a symlink; pack `decisions|system-map|edge-cases.md` dropped, cross-feature edge cases EC-001–007 moved into `system-map.md` — `system-map.md`, `design/*`, `CLAUDE.md`
- brain — Changelog made mandatory for every change; added Write protocol and `added` kind — `CLAUDE.md`, `CHANGELOG.md`
- brain — Brain restructured to flat layout; added `feedback/`, `system-map.md`, this changelog — `CLAUDE.md`, all
