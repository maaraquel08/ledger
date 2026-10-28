---
type: fact
status: draft
updated: 2026-10-29
related: [D-0012, D-0013, D-0014, D-0015, D-0016, features/home, features/add-entry, features/receipt-scan, features/activity, features/review, features/accounts, features/insights, features/budgets-and-goals, features/chat, features/onboarding, design/screens]
---

# System map

Source of truth for how features interact. Each feature file declares its own **Interactions** section; this file is the aggregate. When they disagree, fix the feature file first, then this. Drafted from `src/lib/store.tsx`, `types.ts` and the screens on 2026-10-19.

## Objects
Shared nouns. Every object has exactly one owning feature; others read or trigger.

| Object | Owned by | Lifecycle states | Also read by |
|---|---|---|---|
| Entry | activity | Logged → (Needs category / account → Review → Filed) · Queued → synced flag cleared · Refunded (flag) · Deleted | home, add-entry, receipt-scan, review, accounts, insights, budgets-and-goals, chat |
| Account | accounts | Added (balance 0 in onboarding) → balance moves with entries → Removed (entries orphaned) | every feature that shows an entry; onboarding creates the first set |
| Profile (income, frequency, side income, budgets, goals, holdings) | budgets-and-goals (budgets, goals); onboarding (income); holdings seed-only | Set in onboarding → edited in Budgets | home, insights, chat, accounts (holdings %) |
| Receipt (image + items, inside an Entry) | receipt-scan | Read → Reviewed or auto-logged → attached to an Entry | activity (photo, split), home (receipt card) |
| Chat transcript | chat | sessionStorage only; cleared on tab close or "Clear conversation" | — |
| Onboarding draft | onboarding | sessionStorage; cleared on finish | — |
| `questionsToday` counter | chat | increments on each answered question; reset only by `reset` / `load-demo` | home (none) |

## Feature interaction matrix
R = reads, W = writes, T = triggers something in, E = exposes to.

| From ↓ / To → | activity (Entry) | accounts | budgets-and-goals (Profile) | review | chat | home |
|---|---|---|---|---|---|---|
| onboarding | — | W (initial accounts) | W (income, budget, goals) | — | — | T (`/home` on finish) |
| home | W (add, update, delete, flush-queue) | R | R (budget) | E (ONE QUESTION resolves account) | T (`/chat?q=`) | — |
| add-entry | W (add: Manual, Voice, Camera receipt) | R | — | T (null fields land in queue) | — | — |
| receipt-scan | W (add; attach to existing) | R (paid-with match) | — | T (unsure items) | — | T (sessionStorage `ledger:handoff` → receipt / duplicate card) |
| activity | — (owner) | R | R (category budget row) | T (banner "N entries to review") | — | — |
| review | W (update category/account) | R | — | — | — | — |
| accounts | W (transfer = two entries; remove orphans entries) | — (owner) | R (holdings %) | T (orphaned entries) | — | — |
| insights | R | R | R (budget) · T (link to Budgets) | — | — | T (AddSheet "Log today") |
| budgets-and-goals | R (spend by category) | — | — (owner) | — | — | — |
| chat | R | R | W (goal via offer) | — | — (owner) | — |

## Events
Things one feature emits that others react to. Reducer actions in `src/lib/store.tsx:7-18`; sessionStorage handoffs by key.

| Event | Emitted by | When | Consumers |
|---|---|---|---|
| `add-entry` / `add-entries` | home, add-entry, receipt-scan, accounts (transfer, both legs) | an entry is logged | account balance delta; Review if null fields; every total |
| `update-entry` | home (ONE QUESTION, attach receipt), review, activity (edit, split, refund) | fields change | balances reversed and re-applied |
| `delete-entry` | home (Undo), activity | delete | balance reversed |
| `flush-queue` | home | back online with queued entries | clears `queued` chips |
| `upsert-account` / `remove-account` | accounts, onboarding | account edits | entries orphaned on remove |
| `update-profile` | budgets-and-goals, chat (offer) | budget / goal change | today's number, Insights, ring |
| `ask` | chat | an answered question | 20/day limit |
| `load-demo` / `reset` / `complete-onboarding` | onboarding, home (Profile sheet) | sign in, erase, finish setup | replaces all state |
| `ledger:handoff` (sessionStorage) | receipt-scan | logged or possible duplicate | home receipt / duplicate card |
| `ledger:onboarding`, `ledger:chat`, `ledger:insights-period`, `ledger:math-seen` | onboarding, chat, insights, home | drafts and per-session memory | same feature |

## Shared surfaces
Any feature that creates or changes an object must define its entry in each:
| Surface | Rule |
|---|---|
| Activity list | every Entry appears, grouped by day; chips for Needs category / Queued; searchable by desc, raw, category, account |
| Review queue | every Entry with null category or account, no exceptions |
| Account balance | every Entry moves exactly one account by its signed amount (credit inverted) |
| Today's number + The math | every spend Entry this month changes them; Investments and Transfer never do |
| M8 surfaces | each feature may add one AI card, gold-marked (D-0003); local mode: fixed rule templates; cloud mode: Claude prose with numbers only from facts (D-0013) |
| Exports / search / notifications | none exist today; planned: insight inbox + Web Push for the weekly review and material alerts (D-0016) |

## Navigation
Shipped (local mode):
Hash routes (`src/App.tsx:37-50`). Tab bar (Home, Activity, Accounts, Insights) only on exact tab roots. FAB only on Activity. Chat has no tab: reached from Home (typed or spoken question) or The math "Ask a follow-up". Scan is full-screen from Home. Budgets from Insights. Review from the Activity banner. Welcome/onboarding are public; everything else redirects to `/` until onboarded.

Planned (D-0015): three tabs **Today** (home + insights + budgets-and-goals; chat and the insight inbox open from it), **Money** (accounts + activity; account detail = filtered ledger), **Review**. Add stays global; Scan is Add's Camera mode, not a route.

## Planned: cloud mode (approved 2026-10-29, not shipped)
Source: `docs/superpowers/specs/2026-10-29-cfo-agent-design.md`, schema in `supabase/CONTRACT.md`. Local mode keeps everything above.

| Object | Owned by | Lifecycle states | Also read by |
|---|---|---|---|
| Entry (cloud) | activity | Captured → posted (gate passed) or review (gate failed, one question) → void; sync: Saved on this phone (`queued`) → Synced (D-0012) | all |
| Move | activity | Two legs summing to zero, same status; void cascades (D-0007, D-0010) | accounts |
| Snapshot | accounts | Reported → shown against derived balance → gap closed by an Adjustment entry (D-0014) | review (open) |
| Raw input | add-entry | text / voice / photo → parsed → linked to its entries | activity, review |
| Learned rule | review | Created from a correction → applied before Claude's guess; hit count | add-entry, receipt-scan |
| Insight | insights | Triggered → written (or "nothing to flag") → unread → read / dismissed; stale when entries change; may be pushed (D-0016) | home (Today), chat |

| Event (planned) | Emitted by | Consumers |
|---|---|---|
| `capture` function call | add-entry, home | Entry posted or sent to Review; raw input stored; learned rules applied |
| server acknowledgement | Supabase RPC | clears `queued`; copy may say "Synced" |
| `report_balance` / `record_adjustment` | accounts | reconciliation view; account balance (via Adjustment only) |
| `insights-run` (cron) | server | insight inbox; `notify` within push limits |
| correction | review, activity | learned rule; `corrections` log |

**Cross-feature rule (D-0013).** Any number shown or cited, on any surface, comes from SQL; Claude never writes a digit of its own. M8 has read-only tools and never moves money.

## Cross-feature edge cases
Recurring across features; feature-specific ones stay in each feature file. Format: trigger · affects · what goes wrong · expected handling · status.

- **EC-001 Entry missing category or account** — any log path, or a removed account · home, add-entry, receipt-scan, activity, review, accounts · totals include unfiled spend; "Needs category" / "ACCOUNT?" chips · saves anyway and lands in Review (D-0005) · draft
- **EC-002 Offline** — `navigator.onLine` false · home, add-entry, receipt-scan, chat · entries flagged `queued` · local mode: "saved on your phone", questions still answered (D-0008); cloud mode (planned): "Saved on this phone" until acknowledged, then "Synced"; Claude answers and parsing wait for a connection (D-0012, D-0013) · draft
- **EC-003 No budget yet** — income never entered · home, insights, budgets, chat · hero "₱—", The math will not open, chat asks to set a budget · every surface names the action that sets one · draft
- **EC-004 Fewer than 7 logged days** — new user · insights · gate screen with mini bars · "Log today" CTA · draft
- **EC-005 Negative balance** — spend beyond balance · accounts, activity · shown signed in red via `balance()`; transfers from a non-credit account are blocked when they would go under · handled · draft
- **EC-008 Storage write fails** — localStorage full or unavailable · every logging surface · state stays in memory only · `persistError` banner "Couldn't save on this phone."; photos live under their own capped key so entries still save · handled · draft
- **EC-009 Leaving Home during Reading** — tab tap or second line within the 1.1 s animation · home · used to drop the entry · entries are committed before Reading starts · handled · draft
- **EC-010 Goal without a date** — blank month in the goal form · chat, budgets · pace maths skip it and say so · handled · draft
- **EC-011 Derived balance disagrees with a snapshot** — Owner reports a balance · accounts, review · a gap appears · shown, closed only by an Owner-confirmed Adjustment entry; never a silent overwrite (D-0014) · planned
- **EC-012 Capture gate fails** — low confidence, duplicate, outlier amount · add-entry, home, receipt-scan, review · entry not posted · lands in Review with one question; nothing blocks logging (D-0005, D-0013) · planned
- **EC-006 Reduced motion** — OS setting · every animated surface · orb rings, AI paint, screen-in, skeleton · all guarded; SMIL removed · draft
- **EC-007 Voice unavailable** — unsupported browser, mic denied, no speech, network · home, add-entry, chat · hold-to-talk fails · typed path always present with specific copy per error; in AddSheet, Manual is the fallback · draft

## Conflicts
Resolved 2026-10-19 by D-0006 (one daily formula), D-0008 (no question cap), copy fix (Insights gate), D-0007/D-0010 (linked legs). None open.

## Change checklist
A change is fully designed when the feature's Interactions section answers what it **reads**, **writes**, **triggers**, and **exposes**, and this matrix is updated to match.
