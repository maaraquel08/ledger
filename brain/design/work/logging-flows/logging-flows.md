# Logging flows (critique of the shipped prototype)

## Brief
**Request.** Critique the current Ledger prototype as shipped, first half: everything that gets money *into* the ledger. Features: onboarding (Welcome, Sign in, Create an account), home (today's number, hold-to-talk, text bar, ONE QUESTION, receipt card, duplicate card, The math, Profile/erase, offline), add-entry (Add sheet, parse grammar), receipt-scan, review.
**Problem underneath.** Grounded: principle 1 "Type it like you'd say it" (brain/product.md). Does one line reliably become a correct entry, and when it doesn't, can the Owner recover without losing the entry or trust?
**Roles.** Owner (single local user) and M8 (brain/users.md).
**Constraints.** brain/rules/* and brain/decisions/D-0001…D-0005. Code is the artifact: src/screens/{welcome,onboarding,home,home-sheets,scan,activity (Review section)}.tsx, src/components/ledger/add-sheet.tsx, src/lib/{parse,receipt,today,store}.ts.
**Scope.** In: the five features above as they exist. Out: the money views (activity list, accounts, insights, budgets, chat) which are critiqued in `../money-views/`.
**Success criteria.** 1. A first entry can be logged within one screen of Home by voice, text or receipt. 2. Every mis-parse has a visible, one-tap correction. 3. Nothing the Owner logs is silently lost (offline, quota, duplicates, undo). 4. Today's number and its explanation agree.
**Open questions.** See brain/system-map.md › Conflicts and brain/research/RN-1-code-audit-2026-10-19.md.

## Critique
Reviewed: `src/screens/{welcome,onboarding,home,home-sheets,scan}.tsx`, `src/screens/activity.tsx:636-747` (Review), `src/components/ledger/add-sheet.tsx`, `src/lib/{parse,receipt,today,store,selectors,providers,types,router}.ts`, `src/App.tsx:20-60` · Method: source (not run; regex behaviour reasoned, not executed) · Gaps: no `## States` section (quick pass from `states-axes.md` below); no `study/` folder; `brain/*` is `status: draft` so every rule cited is unconfirmed; `src/lib/voice.ts` and `ocr.ts` only grepped; no screenshots, so taste calls are from classes, not pixels.

Verdict: The one-line promise mostly holds: a first entry can be logged from Home by voice, text or receipt with no required decisions, and missing fields fall through to Review as D-0005 intends. What fails is the second half of the brief's question, recovery without loss: an entry disappears if the Owner leaves Home or sends a second line during the 1.1 s "Reading" phase, storage failures are swallowed behind "saved" toasts, "paid Meralco 3,100" is filed as a transfer that never touches today's number, and the hero and The math still compute different numbers. Fix first: commit the entry before the Reading animation (B3); it is a small change that closes the only silent-loss path in the core gesture. Then reconcile the formula (B1).

### Blockers
B1. Today's number and its explanation disagree — Systemic · grounded (`home.tsx:63` uses `todayBudget`; `home.tsx:247,343` and `home-sheets.tsx:86-92` use `verdict`; `today.ts:20-28` vs `selectors.ts:91-94`) · Home › tap hero › The math · Under / Over, any day with spend today · Owner
    Problem: the hero deducts only today's day-to-day spend from an allowance computed on spend *before* today; the sheet subtracts *all* month spend including today's, then divides. Worked example, 19 Oct, budget ₱63,000, ₱30,000 spent before today, ₱500 coffee today: hero shows ₱2,038 left; the sheet tapped from that number shows ₱2,500/day, and its own sentence ("spread evenly over the 13 days remaining including today") describes the sheet's formula, not the hero's. This is the Conflict already logged in `brain/system-map.md`; new evidence is that the sheet's explanatory copy and "− Spent so far" row contradict the hero's deliberate exclusion of groceries/bills from today. Success criterion 4 fails on any day with spend.
    Consequence: the Owner opens "the math" to check the number and finds a different number with no mention of why.
    Direction: The math should render `todayBudget()`'s rows (Budget − spent before today ÷ days left = allowance; − spent today on day-to-day = left) and keep `verdict().perDay` for Budgets and chat where it is the month pace. Owner decides which formula is the product; until then, the sheet must at least show the same number it was tapped from.

B2. "paid Meralco 3,100" is filed as a Transfer and excluded from spending — Systemic · grounded on the typed Home path (`parse.ts:113-116`; `home.tsx:133` runs `parseSpoken` on typed text too; `selectors.ts:5,10` exclude Transfer from `isSpend`) · inferred for voice (en-PH transcripts commonly capitalise proper nouns; unverified) · Home › Reading › receipt card · Under / Over · Owner
    Problem: any capitalised word after paid / sent / gave / transferred / to becomes a transfer to a person. "Paid Meralco 3100", "Paid Grab 248 gcash", "sent Lazada 1,200" all commit with `category: "Transfer"`, amount forced negative, and the card reads "TRANSFER · NOT SPENDING". Today's number, Insights and budgets never see the bill. The glossary's own Transfer definition ("paid to a person") does not cover merchants, and the KEYWORDS table knows Meralco is Rent & bills, but the transfer branch returns before category is consulted.
    Consequence: wrong money on the hero after a correct-looking entry; the entry is complete (category set), so Review never surfaces it.
    Direction: only treat as a transfer when the captured name matches no KEYWORDS/provider/merchant regex, or when `paid … back` is present; otherwise keep the keyword category. If it is still ambiguous, reuse the ONE QUESTION shell: "Bill to Meralco, or a transfer?" One tap, no redesign.

B3. An entry is dropped if the Owner leaves Home or sends another line during "Reading" — UX · grounded (`home.tsx:143-147`: the commit timer lives in an effect keyed on `phase`; `home.tsx:137` replaces `phase`; `Screen tabbed` at `home.tsx:252` keeps the tab bar live during Reading) · Home › Reading · Interruption: navigated away mid-edit, double submit · Owner
    Problem: nothing is written until `READ_MS + items×250` ms elapse. Tapping Activity, Accounts, Insights or the scan button in that window unmounts Home and the cleanup clears the timer; typing a second line in that window replaces the phase and clears the first timer. Either way the first entry never reaches the store, no error shows, and the text bar was already cleared (`home.tsx:213`). The brain's home.md notes "Reading: no cancel" but not that leaving *is* a cancel.
    Consequence: success criterion 3 fails on the core gesture; the Owner saw "Reading", trusts it, and the entry is gone.
    Direction: dispatch `add-entry` in `process()` and let Reading animate over an already-saved entry (Undo on the card already covers regret). If the animation must precede the write, commit in the effect cleanup when leaving the reading phase for any reason other than cancel.

B4. Storage failure is silent while every surface says "saved" — Systemic · grounded (`store.tsx:95-101` swallows `setItem`; `receipt.ts:180,198` stores a 720 px JPEG data URL inside every receipt entry in the same key; `add-sheet.tsx:135`, `scan.tsx:57`, `home.tsx:753` confirm success unconditionally) · all logging surfaces · Data: error (not recoverable) · Owner
    Problem: once `ledger:v1` exceeds the quota, state stays in memory and every later entry, filing and balance change is lost on the next reload. RN-1 flagged this as unverified; the code path is unambiguous. Receipt photos make the quota reachable in normal use, and the first sign the Owner gets is a reload that forgets a day.
    Consequence: silent loss (criterion 3) with a money trail (balances) that reverts.
    Direction: catch the throw into a `storageFailed` flag and show it with the offline banner pattern ("Couldn't save on this phone. Free up space or delete receipt photos."); keep images under a separate key with a cap so an entry can persist without its photo.

### Major
M1. Home's no-budget state names an action that does not set a budget — UX · grounded (`home.tsx:457-459` "Try “Salary 45,000 to BPI”… M8 sets up the rest"; `today.ts:15` and `selectors.ts:73-78` derive the budget from `profile.income` only, never from entries; `onboarding.tsx:567` "set one anytime from Home" with no Home entry point) · Home › No budget · new user who skipped step 3 · Owner
    Problem: logging the suggested salary line leaves "₱— no budget yet" unchanged; the only editor is Insights › Budgets, two tabs away and unnamed. EC-003 requires every surface to name the action that sets a budget.
    Consequence: the first useful result never arrives from Home; the north-star streak starts with a dead number.
    Direction: when there is no budget and a Salary/Income entry is logged, M8 offers (does not apply) "Use ₱45,000 as your payday? I'd budget ₱59,000." as a card with one tap; otherwise change the hint to link to Budgets.

M2. A wrong category has no one-tap correction anywhere in the flow — UX · grounded (`providers.ts:66-67`: Transport wins over Food & drink, so "grab food 320" → Transport; Review filters `category == null` only, `activity.tsx:41`; the Home card's category is text, `home.tsx:708,762`, and tapping the row opens the detail) · Home › receipt card, Review · typical · Owner
    Problem: a mis-parse that produces a *wrong* value, not a missing one, is complete in the system's eyes. Fixing it is row → detail → Edit → pill → Save, inside an 8 s window or later via search.
    Consequence: success criterion 2 fails for the most common PH case (GrabFood, Shopee "load"); wrong categories poison Insights, which D-0005 explicitly tries to avoid.
    Direction: make the category label on the Home card a tappable pill that opens the same four-pill strip Review uses; order KEYWORDS so the longest or latest match wins, or test "grab food" before "grab".

M3. ONE QUESTION cannot be answered "none of these" and hides accounts past the top three — UX · grounded (`home.tsx:717-720` slice 3; `home.tsx:82,161` the asking card never auto-dismisses and survives a new hold; `home.tsx:728` copy "Which account paid?" even for income) · Home › ONE QUESTION · Owner with 4+ accounts, or a rarely used card
    Problem: the card stays until answered; if the paying account is not ranked, the only exits are tapping a wrong account or logging something else. Income copy asks which account "paid" for a salary.
    Consequence: wrong account balances from a forced answer, or a persistent nag the Owner learns to dismiss by tapping the yellow one.
    Direction: add a fourth pill "Other…" (opens the full picker in a Sheet) and a quiet "Skip" (entry stays in Review, card falls back to the normal 8 s receipt). Vary copy by sign: "Which account received it?"

M4. Doubt-free receipts log with no confirmation and no undo at the point of logging — UX · grounded (`scan.tsx:80-81` auto-log; `scan.tsx:236-243` the toast has no action; Undo exists only on Home after Done, and `home.tsx:787` offers only "Undo all" for several receipts) · Scan › Reading → camera · typical · Owner
    Problem: the 900 ms field fill-in is the only moment the Owner sees merchant, total, paid-with and category before the entry and its balance effect are committed. Doubts cover ambiguity M8 detected, not misreads it did not (wrong total line, "CASH" tender line on a card receipt, `receipt.ts:76`). The open question in `features/receipt-scan` ("Intended?") is undecided, so this is raised as a finding.
    Consequence: a misread total moves an account balance with no visible undo until the Owner returns to Home, and for a batch only all-or-nothing.
    Direction: give the scan toast an Undo (same 8 s), and per-row Undo in the Home multi-receipt card. Keep auto-log; make it reversible where it happens.

M5. Browser back after onboarding can wipe every account — Systemic · grounded (`onboarding.tsx:529-530` clears the draft then `replace`s Ready with Home, so back lands on `/onboarding/income` with an empty draft; Done → Ready → "Go to Home" dispatches `complete-onboarding` with `accounts: []`, `store.tsx:34`; entries keep their old `accountId`, which `needsReview` at `activity.tsx:41` never catches) · Onboarding › Ready › Home · Interruption: browser back · new Owner
    Problem: Android back from the first Home lands on a blank step 3 that looks like the app forgot the setup; the natural next taps replace accounts and balances with nothing and leave any logged entries pointing at ids that no longer exist (they show "ACCOUNT?" but never enter Review).
    Consequence: balance data loss two taps past a confusing screen; orphaned entries that cannot be filed.
    Direction: guard `/onboarding/*` when `onboarded` is true (redirect to Home, or ask "Start over? This replaces your accounts"), and have `complete-onboarding` null out `accountId`s that no longer resolve, as `remove-account` already does.

### Minor
m1. Yellow carries text and fills non-add, non-live controls — ledger-design-taste · grounded (`home.tsx:765,787` Undo in `text-highlight`; `scan.tsx:349` total in `text-highlight`; `home.tsx:684,738` Attach and the top account pill in `bg-highlight`; `scan.tsx:403,409` Next/Retake in `bg-highlight`) · D-0003 says yellow never carries text and is reserved for add and live voice. Direction: Undo and the total in `text-accent-fg`; Attach/Next/Retake as `Cta`; the ranked pill as a selected `Pill`.
m2. One account, four names — UX · grounded (`home.tsx:40,741` "GCash ··8871"; `add-sheet.tsx:292` "GCASH ·8871" chip vs `add-sheet.tsx:211` picker uses `a.name`; `activity.tsx:727` Review pills use `a.name`; `scan.tsx:467,532` providerLabel) · the Owner answers ONE QUESTION with a brand and files in Review with a nickname. Direction: one `accountLabel()` everywhere, nickname first, brand second.
m3. Flipping a typed entry to Income keeps its spend category — Systemic · grounded (`add-sheet.tsx:104-109,231`; `selectors.ts:11` counts +₱248 Transport as income) · "grab gcash 248" → sign chip → Income saves +₱248 Transport. Direction: on flip to Income, set category to null (Review) unless it is Salary/Income.
m4. The "Today" chip in Reading is permanently `ok: false` (`home.tsx:541`), so the date reads as a missing field beside "Category?". Direction: mark it ok, or drop it.
m5. Offline copy differs by surface — grounded (`scan.tsx:57` no "waiting to sync"; `add-sheet.tsx:135` has it; `home.tsx:702` labels every card entry WAITING TO SYNC while offline even if it is not queued). Direction: one `queued` label driven by the entry flag only.
m6. Welcome tape colours a transfer green and an investment red (`welcome.tsx:15,19`), contradicting rule-signed-money's "not in/out" the moment the Owner reaches Home. Direction: show them neutral or drop those rows.
m7. A duplicate match ends the scan session (`scan.tsx:76-79` navigates to Home mid-batch); "Done · N" and the camera are gone. Direction: resolve the duplicate in a Sheet on Scan and keep the loop.
m8. Duplicate "Discard" is the only destructive action in the flow with neither scope nor undo (`home.tsx:690,236`): the photo is gone. Direction: "Discard photo" label and a 8 s Undo like the rest.
m9. "Attach to that entry" silently replaces the Owner's own category with the receipt's largest split (`home.tsx:229`). Direction: keep a non-null user category unless it was null; say what changed in the card.
m10. Typed amounts keep centavos ("lunch 150.50" → 150.5, `parse.ts:22-25`) while receipts round (`receipt.ts:176`) and `peso()` hides both; totals can drift from the rows by rounding. Direction: round at `add-entry`.
m11. Entries beginning with is / do / am / where… go to chat on Home but log in the Add sheet (`parse.ts:80-86`; `add-sheet.tsx:91` never calls `isQuestion`). Known in `features/home` edge cases; cited here because it is a second way to do the same thing with a different outcome. Direction: route to chat only when the line has no amount.

### Questions
Q1. Is bill payment a Transfer? The glossary's "paid to a person" and the parser's capitalised-name rule disagree on merchants (B2). Owner decides the boundary; the fix differs by answer.
Q2. "Waiting to sync" / `flush-queue`: nothing syncs (`store.tsx:58-59` clears a flag). Keep the sync vocabulary as a promise for a future backend, or say "saved on phone" and stop there? (Open in `features/home`; unanswered.)

### Cause and effect
- Home voice/text → `add-entry` (`home.tsx:96`) → account balance via `applyBalance` (`store.tsx:39`) → Accounts, net worth → OK
- Home voice/text → `category: "Transfer"` from capitalised name (`parse.ts:113`) → `isSpend` false → hero, The math, Insights, Budgets unchanged → B2
- Home Reading (1.1 s+) → unmount or second line → timer cleared → no `add-entry` → nothing anywhere → B3
- Home commit → `queued: !navigator.onLine` → chip in Activity → cleared only while Home mounted and online (`home.tsx:73-75`) → Activity shows "Queued" for AddSheet entries until Home is visited → m5 / Q2
- Home ONE QUESTION → `update-entry accountId` → balance re-applied (`store.tsx:45-46`) → Accounts → OK; wrong forced answer → wrong balance → M3
- Home Undo → `delete-entry` per id → balances reversed → OK; after 8 s → Activity detail only → OK
- Home hero → `todayBudget().left`; The math → `verdict()` → Budgets ring and chat "daily" also `verdict()` → B1
- Home Profile erase → `reset` → EMPTY_STATE → `/` → sessionStorage chat/onboarding draft survive (known) → OK for this scope
- AddSheet Save → `add-entry` with `date = <day>T12:00 local` → `inRange` month totals → OK; past-date entries shift `before` in `todayBudget` → hero moves retroactively → OK by rule
- AddSheet sign flip → +amount with spend category → `isIncome` true → Insights income totals include "Transport" → m3
- Scan auto-log → `add-entry` + balance → Home card only after Done → M4
- Scan duplicate → handoff → Home card → attach: `update-entry {split, receipt, category}` → balance unchanged, category replaced → m9; new: second `add-entry` → double balance hit by design → OK (Owner chose)
- Scan image → data URL in entry → `ledger:v1` grows → `setItem` throws → swallowed → every later write lost on reload → B4
- Review pill → `update-entry {category|accountId}` → balance reversed and re-applied with same amount → net zero → OK; Review never patches amount, so no sign flip → OK
- Review "Accept suggestions" → `suggestCategory ?? "Other"` on every null-category entry → Insights "Other" bucket grows; no undo → known open question, not re-raised
- Onboarding finish → `complete-onboarding` replaces accounts, keeps entries → dangling `accountId` not null → Review blind → M5
- Onboarding income → `profile.income` → `suggestedBudget` → hero; entries never feed it → M1
- Remove account (Accounts, out of scope) → `accountId: null` → Review → OK, matches D-0005
- Chat goal offer (out of scope) → `update-profile goals` → no effect on hero → OK

### States coverage: 14 of 21 high-priority states handled; unhandled: storage write failure (B4), navigated away / second line during Reading (B3), browser back after onboarding (M5), two tabs open (no `storage` listener, `store.tsx:81-89`; last writer wins silently, assumed), ONE QUESTION with the payer unranked (M3), wrong-but-complete category (M2), scan session interrupted by a duplicate (m7).
Axes kept: Data (none ever, loading, error, partial, very many), Content shape (long values, special characters, zero/negative, dates across boundaries), Record lifecycle (queued, deleted while viewing), Time (month boundary, future receipt date), Concurrency (two tabs), Interruption (all five), Environment (reduced motion, keyboard), Cross-feature (accounts removed, budget edited). Dropped: Role & access (single Owner; M8 marks present on every computed surface), approval/locked lifecycle states (none exist), timezone (PH only, no DST), 200 % zoom and screen reader (full pass belongs to `better-accessibility`).

### What works
The Home frame never changes shape: number, orb, bar, and the dark receipt card above the bar for every outcome, so a one-handed Owner always knows where the result lands. Voice has a typed twin in every error state with specific copy (EC-007), and the Owner's own words are kept as `raw` and quoted back in the duplicate card. Review is honest and fast: sparkle pill for M8's guess, plain pills for the rest, rows leave as they are filed, and filing never touches the amount, so the sign rule is safe there. The receipt pipeline's doubts are specific sentences, not confidence bars, and "Type the total" is always one tap from an unreadable photo.

Offer: I can add the new edge cases (reading-phase interruption, storage failure, onboarding back, unranked payer) and the two system-map gaps (no `storage` event across tabs; `complete-onboarding` orphaning) via `design-context` if you want them in `brain/`.
