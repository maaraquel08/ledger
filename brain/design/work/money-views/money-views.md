# Money views (critique of the shipped prototype)

## Brief
**Request.** Critique the current Ledger prototype as shipped, second half: everything that reads the ledger back to the Owner. Features: activity (list, filters, entry detail, edit, split, refund, delete), accounts (list, add, detail, edit, remove, transfer), insights (gate, weekly, monthly, yearly, day sheet), budgets-and-goals, chat (M8).
**Problem underneath.** Grounded: principles 3 and 4 (brain/product.md): one number then the math, M8 proposes and never moves money. Do the numbers agree with each other and with the entries, and can the Owner trust and act on what M8 says?
**Roles.** Owner (single local user) and M8 (brain/users.md).
**Constraints.** brain/rules/* (signed money, daily allowance, M8 is rules) and brain/decisions/D-0001…D-0005. Code is the artifact: src/screens/{activity,accounts,insights,chat}.tsx, src/lib/{selectors,today,format,store}.ts.
**Scope.** In: the five features above as they exist. Out: logging flows (onboarding, home, add-entry, receipt-scan, review) critiqued in `../logging-flows/`.
**Success criteria.** 1. Every total on screen can be reconciled to entries by the Owner. 2. Every money-changing action states its scope and is reversible or confirmed. 3. M8's answers are correct for the data and say what they cannot do. 4. The same words mean the same thing on every screen.
**Open questions.** See brain/system-map.md › Conflicts and brain/research/RN-1-code-audit-2026-10-19.md.

## Critique
Reviewed: `src/screens/activity.tsx`, `accounts.tsx`, `insights.tsx` (incl. Budgets), `chat.tsx`; `src/lib/selectors.ts`, `today.ts`, `format.ts`, `store.tsx`, `types.ts`; `src/components/ledger/primitives.tsx` (Amount, EntryRow, Sheet, StatGrid, Delta); seed goals in `seed.ts`; `home.tsx` / `home-sheets.tsx` grepped only for which formula they call · Method: source (app not run, nothing rendered) · Gaps: no `## States`, no `study/` folder; every brain file is `status: draft`; `brain/constraints.md` and `brain/design/screens.md` not read; RN-1 read for its money list only. RN-1 already names several of the money edge cases below; they are raised here because no decision closed them and the code chains are worse than the one-line notes suggest.

Verdict: The views do not agree with each other on what a number means. Today's number is computed two ways and the chat screen shows both at once; unfiled spend is quietly relabelled "Other" everywhere it is summed; an account's IN/OUT ignores the transfers that moved its balance; and editing an entry can flip its sign and move a balance by twice the amount with no warning. Fix first: decide the single daily formula (B4). Until one number is canonical, no other reconciliation fix has a reference to reconcile to. The next two fixes are mechanical and should not wait on that decision: make the edit sheet show and preserve the current category and sign (B1), and give `peso()` a sign for balances (B2).

### Blockers
B1. Editing an entry can silently flip its sign and move the balance twice over — UX+Systemic · grounded(`activity.tsx:586`, `611`; `store.tsx:45-46`; `rules/rule-signed-money` "category pickers on edit must make that visible") · Entry detail › Edit entry · any Salary / Transfer / Investments entry · Owner
    Problem: the category pills are `SPEND_CATEGORIES + Income` only, so a Salary, Transfer or Investments entry opens with no pill lit and no way to keep what it is. One tap on any spend pill makes a ₱48,000 payday a −₱48,000 spend; `update-entry` reverses +48,000 then applies −48,000, so the payroll account drops ₱96,000. A Transfer leg becomes a spend that counts in OUT, the ring and M8 while its partner leg keeps counting as money in. Nothing on the sheet says the amount's direction will change. Consequence: wrong balances, wrong month, no undo (delete + re-add would double the damage first). Direction: show the entry's real category as a lit pill (add Salary, Transfer, Investments to the edit set, or lock the category for Transfer legs); preview the signed result next to the amount (`signed()`), and when the sign would change, say so inline before Save.

B2. A balance below zero reads as a positive balance — Systemic · grounded(`format.ts:4` `Math.abs`; `accounts.tsx:55`, `319`; transfer has no balance guard `accounts.tsx:465-471`; `EC-005` unhandled, RN-1) · Accounts list, Account detail · after a transfer or spend larger than the balance · Owner
    Problem: GCash at ₱5,000 after a ₱20,000 transfer shows "₱15,000"; only the net-worth hero gets a hand-added minus (`accounts.tsx:124`). The list and the detail hero are the two places the Owner checks before paying. Consequence: wrong money on the screen that is meant to be the balance of record; the transfer sheet lets it happen with a "−₱20,000 from GCash" preview that looks fine. Direction: render balances through a signed path (minus + `text-danger`) in `AccountRow` and the detail hero; in Transfer, warn or block when amount > source balance for non-credit accounts, with copy that states the resulting balance.

B3. M8's goal-pace answer prints "₱NaN" for any goal whose date is not "Mon YYYY" — and M8's own offer creates such a goal — Systemic · grounded(`chat.tsx:154-156` `new Date("1 " + g.by)`, `Math.max(1, NaN)` is NaN; `chat.tsx:85` offer `by: "19 Oct"`; `insights.tsx:885-889` free-text BY, default "No date"; RN-1 flagged as unverified) · Chat "Am I on track…" · Owner with one goal created from the tonight offer or with a blank date
    Problem: ask "Can I afford dinner tonight?", tap "Set ₱450 aside", then ask "Am I on track for my goals?": `need` is NaN for "Dinner out", the sum is NaN, `capacity >= NaN` is false, and the answer is "Not quite yet. … you're ₱NaN a month short." Consequence: success criterion 3 fails on a path M8 itself leads the Owner down; the answer looks confident and is garbage. Direction: store `by` as a real month (`YYYY-MM`) with a month picker in GoalSheet and in offers; in `respond`, skip goals with no parseable date and say so ("Dinner out has no date, so I left it out").

B4. Today's number is two formulas and the chat screen shows both — Systemic · grounded(`chat.tsx:436` header = `todayBudget().left`; `chat.tsx:188-194` "daily math" = `verdict().perDay`; `today.ts:14-32` vs `selectors.ts:86-94`; `rules/rule-daily-allowance` "any screen that explains today's number must use the same formula"; `system-map › Conflicts`) · Chat, Budgets ring, The math · any day with spend today · Owner
    Problem: the header says "₱1,240 left today"; the answer three lines below says "that's ₱1,610 a day"; the Budgets ring says "₱1,610/day to stay on track"; Home says ₱1,240. `todayBudget` spreads (budget − spend before today) and subtracts today's day-to-day spend; `verdict` spreads (budget − all spend) and never subtracts. The two only agree on a day with no spend. Consequence: principle 3 ("one number, then the math") fails; the Owner cannot reconcile the hero to its own explanation. Known conflict, no decision. Direction: the Owner's call; the critique's recommendation is to keep `todayBudget` as the number (it is what Home shows and what the "tonight" answer uses) and make The math, the ring line and the "daily math" answer explain that formula, with `perDay` renamed to "pace" where it still appears.

B5. After 20 questions, ever, M8 is gone for good — UX · grounded(`chat.tsx:315`, `601` "RESETS TOMORROW"; `store.tsx:76-77` only increments; no reducer action resets it except `reset` / `load-demo`; RN-1) · Chat · Owner on day two or any day after reaching 20
    Problem: the counter is per-install, not per-day. The composer disables, suggestions disable, the footer promises tomorrow, and tomorrow never comes; the only way back is "Erase all data". Consequence: the job (ask M8) can't be finished again; the copy lies. Direction: store `questionsDate` next to the counter and reset when the local date changes (or drop the cap, see Q3).

### Major
M1. Unfiled spend is relabelled "Other" wherever spend is summed, and the Owner cannot find it under "Other" — Systemic · grounded(`selectors.ts:52` `e.category ?? "Other"`; consumers `insights.tsx:192` WHERE IT WENT, `327` VS. LAST MONTH, `644` category budgets, `chat.tsx:131` salary answer, `172` cut answer; Activity filter `activity.tsx:116` matches `e.category === "Other"` only) · Insights, Budgets, Chat · any Review backlog · Owner
    Problem: D-0005 says a null category counts as spending; it does not say it is "Other". With 6 unfiled entries, Insights shows "Other ₱4,200", an Other budget shows "₱4,200 / 3,000 over", and M8 says "₱12 goes to other" — but tapping through to Activity › Category: Other shows none of them. Direction: keep nulls in the totals but label them "Needs category" (warn tone) as their own row, and make the row link to `/review`; exclude them from a category cap.

M2. Account IN / OUT ignore transfers while the balance and ENTRIES include them — Systemic · grounded(`accounts.tsx:297-300`, `326-328`; `totals()` uses `isIncome`/`isSpend` which exclude Transfer) · Account detail · savings, credit and investments accounts · Owner
    Problem: MariBank "Emergency fund" funded only by transfers shows IN ₱0 · OUT ₱0 · ENTRIES 4 while its balance rose ₱20,000; a credit card always shows IN ₱0 because payments are transfers. "IN" on Activity means income; "IN" on an account means money that arrived. Same word, two meanings (criterion 4). Direction: on the account screen sum signed amounts into and out of this account (all categories), and label them "IN · OCT" / "OUT · OCT" there; keep the income/spend definition for Activity and Insights.

M3. The filtered Activity total is a different number from NET with no label — Systemic · grounded(`activity.tsx:156` signed sum of every match incl. Transfer, Investments, refunded; vs `totals()` at `:102`) · Activity with any filter · Owner
    Problem: unfiltered shows NET −₱12,400 for October; tap Period › This month and the only change is the same month now reads −₱9,100 (transfers net to zero, investments and refunded entries now count). Direction: compute the filtered figure with `totals()` and show IN/OUT/NET for the filtered set, or label the sum ("Net of 42 entries, incl. transfers").

M4. A deposit can be "refunded" and still counts as income — Systemic · grounded(`activity.tsx:538-546` button shown for any entry without receipt items; `selectors.ts:10` `isSpend` excludes refunded, `:11` `isIncome` does not) · Entry detail · income entry · Owner
    Problem: the payday row is struck through with a Refunded chip, but IN, NET, the savings rate and M8's "You've earned ₱X" are unchanged. Direction: hide refund for positive entries (or make `isIncome` honour the flag and state what refund means for a deposit).

M5. Deleting a transfer leg orphans the other with a confirm that doesn't say so — Systemic · grounded(`activity.tsx:521` "Delete 'Transfer to The card' (₱5,000)? You can't undo this."; legs created unlinked at `accounts.tsx:470-471`; `system-map › Conflicts`) · Entry detail · transfer entry · Owner
    Problem: one account is reversed, the other is not; net worth moves by the amount. Direction: link legs by a `transferId`; the confirm says "This removes both sides of the transfer (−₱5,000 from GCash, +₱5,000 to The card)" and deletes both.

M6. Editing a balance overwrites it with no entry and no warning — Systemic · grounded(`accounts.tsx:397-407`; `rules/rule-signed-money` "On violation") · Account detail › Edit · Owner
    Problem: the field looks like a correction, but after it the balance no longer equals the prior balance plus entries, and Activity has no row to explain the jump. Direction: when the balance changes, create an adjustment entry (category Transfer, desc "Balance adjustment", amount = delta) so the ledger stays reconcilable; copy under the field: "Changing this adds a balance adjustment entry."

M7. Insights Monthly says "No budget set" beside a ring and a Home number that use the suggested budget — Systemic · grounded(`insights.tsx:315` raw `profile.monthlyBudget`, `:342`; vs `selectors.ts:90` fallback used by Budgets ring and `today.ts:15`) · Insights › Monthly · Owner with income but no explicit budget · Owner
    Problem: three screens, two answers to "do I have a budget". Direction: use `verdict().budget` and say "₱X under suggested budget" when it is the fallback.

M8. M8 refuses to answer offline and blames the connection it does not have — UX · grounded(`chat.tsx:353-356`, `412`, `751` "because you're offline"; `respond()` is pure local rules; D-0001, D-0002, `rules/rule-nothing-leaves-the-phone` "copy never implies a cloud") · Chat · offline · Owner
    New evidence beyond D-0001: the copy promises a network path and the gate blocks a job that could complete. Direction: drop the online gate for chat (the only network need is voice); keep the offline banner for voice only.

M9. "Can I buy…?" with no price invents a ₱65,000 laptop and offers to create a "Laptop" goal — UX · grounded(`chat.tsx:91-94`, `108`) · Chat · any purchase question without a number ≥ 1000 · Owner
    Problem: "Should I buy groceries tonight at Landers?" (digits absent, "tonight" present but no `afford`) lands here: "Yes, comfortably. A ₱65,000 purchase…" and a tap adds a Laptop goal to Budgets. M8 creating a goal is allowed (principle 4); creating one the Owner did not name is not what "on request" means. Direction: without a price, ask for one ("How much is it?") and never offer a goal; name the goal from the question's noun or ask.

M10. "Days logged" and the Insights gate count UTC days; everything else counts local days — Systemic · grounded(`selectors.ts:120` `e.date.slice(0,10)`; `insights.tsx:504-505`; entries stamped with `toISOString()` e.g. `accounts.tsx:469`; vs `format.ts:29` `sameDay` local) · Insights gate, north-star metric · Owner in UTC+8
    Problem: a 23:30 entry and the next morning's 07:00 entry are the same UTC day; a two-day logger shows "1 of 7". The north-star metric under-counts for the only market. Direction: key by local date (`startOfDay(new Date(e.date))`) in `daysLogged` and `NotEnough`.

### Minor
m1. OUT's sub-line counts every entry in the month, not outflows — grounded(`activity.tsx:103`, `243`; `totals().outs` exists) · Activity stats. Direction: use `monthT.outs`.
m2. Refund is a one-tap toggle with no note that the balance stays spent; M8's share note for a refunded entry divides a full amount by a spend that excludes it (can print >100 %) — grounded(`activity.tsx:543`, `423-425`; glossary "Refunded"). Direction: one line under the chip: "Balance unchanged"; compute share from the unrefunded set or skip the note.
m3. "transactions" in M8 copy — grounded(`chat.tsx:414` "Reading your transactions…", `:508` "I can see your transactions"; D-0004 bans it). Direction: "entries".
m4. Sources sheet rows don't open the entry — grounded(`chat.tsx:699` `EntryRow` without `onClick`; `features/chat` Interactions says they navigate). The Owner can't check M8's figure against the entry. Direction: add `onClick` → `/activity/:id`.
m5. VS. LAST MONTH shows a neutral "0%" for a category that did not exist last month — grounded(`insights.tsx:403`). Direction: "new" tag instead of 0 %.
m6. Fixed templates that read wrong: "Moving one of those outings in would cover a week of coffee" even when the top category is groceries (`insights.tsx:215`); "Not tonight. You're already ₱0 over today" when `left === 0` (`chat.tsx:77-79`). Direction: branch the tail; treat 0 as "exactly on budget".
m7. Transfer can double-submit during the sheet's close animation — inferred(`accounts.tsx:467-473`, `509`; Cta stays enabled; vaul keeps content mounted while closing). Two pairs of legs. Direction: disable the Cta after the first dispatch.
m8. Remove-account confirm omits how many entries lose their account and that net worth drops by the balance — grounded(`accounts.tsx:430`). Direction: "Remove 'Daily wallet' (₱18,900)? 23 entries will need an account."
m9. One weighted holdings % is printed on every investments account — grounded(`accounts.tsx:81`, `147`). Direction: show it once in the INVESTED group header.
m10. Gate copy "Monthly needs 30 days" vs a 7-day gate for all periods — grounded(`insights.tsx:529`, `580`; RN-1). Direction: either gate Monthly at 30 or drop the sentence.

### Questions
Q1. Should "Mark as refunded" restore the account balance (today it only removes the entry from spend)? Brief and glossary are silent on intent; `features/activity` open question.
Q2. An Investments entry is an outflow from the paying account and credits nothing; transfers to the IBKR account do credit it. Which is the intended way to "invest" (`features/accounts` edge cases, unverified intent)?
Q3. D-0002 calls the 20/day cap "a design affordance"; with a local rule engine, what is it affording? If nothing, B5 is a deletion rather than a reset.
Q4. The "Emergency fund" goal (₱216,000 saved) and the MariBank "Emergency fund" account (₱62,000) are unrelated objects with the same name; is a goal ever meant to read an account?

### Cause and effect
- Edit entry category (spend pill on Salary/Transfer) → `update-entry` reverses old, applies new → account balance moves 2× → Accounts, net worth, M8 cash answers wrong → B1
- Edit entry category on a Transfer leg → `isSpend` now true → OUT, ring, today's number, M8 "cut" answer include a transfer → B1
- Transfer amount > balance → `applyBalance` goes negative → `peso()` renders positive → Accounts list/detail wrong; net worth hero correct → B2
- Chat tonight offer → `update-profile` goal `by: "19 Oct"` → Budgets shows it → chat goal intent NaN → B3
- GoalSheet blank BY → "No date" → same NaN path → B3
- Spend today (day-to-day category) → `todayBudget.left` drops, `verdict.perDay` does not → Home/chat header vs The math/ring/"daily math" disagree → B4
- Spend today in Groceries/Rent → `todayBudget.left` unchanged, `verdict.perDay` drops → disagree the other way → B4
- 20th `ask` → `questionsToday = 20` → composer disabled for the life of the install → B5
- Log without category (D-0005) → `spendParts` → "Other" in Insights rows, Budgets Other cap, M8 salary/cut answers; Activity cat=Other filter excludes it → M1
- Transfer in → account balance up → `totals()` ignores Transfer → account IN ₱0 → M2
- Apply any Activity filter → signed sum of all matches → differs from NET for the same set → M3
- Refund a deposit → `isSpend` n/a, `isIncome` unchanged → IN/NET/savings rate/M8 earned unchanged, row struck through → M4
- Delete one transfer leg → one balance reversed → net worth off by amount; other leg still filters as Transfer → M5
- Edit balance → `upsert-account` overwrite → balance ≠ prior + entries; no Activity row → M6
- Income set, no explicit budget → Home and ring use `suggestedBudget`; Insights Monthly uses 0 → "No budget set" beside a budget → M7
- `navigator.onLine` false → chat `run` fails the message, copy blames the network → M8
- "buy" without a number → price 65,000, goal "Laptop" offered → tap → goal in Budgets the Owner never named → M9
- Entry at 07:00 local → ISO date is previous UTC day → `daysLogged` undercounts → gate and north-star wrong → M10
- Remove account → entries orphaned to Review (D-0005) → balances of others untouched → OK (copy could state the count, m8)
- Delete entry → balance reversed, confirm states scope → OK
- Delete goal → confirm states "money stays in your accounts" → OK
- Remove category budget → confirm states spend stays in Activity → OK
- Day sheet / weekly bars / heatmap → all use `totals().out` on local days → agree with each other → OK
- Yearly NET SAVED, Monthly SAVED, savings rate → all `in − out` excluding Investments and Transfer → agree with each other → OK (Investments is neither spent nor saved; worth a glossary line)

### States coverage: 9 of 17 high-priority states handled
Handled: no entries ever (Activity, Accounts, Insights gate), filtered to empty, entry/account not found after delete, refunded (display), future days, previous period empty, reduced motion, no budget (chat tonight), offline (chat, though wrongly gated).
Unhandled: negative balance (B2), sign change on edit (B1), goal date not a month (B3), period boundary for the question cap (B5), UTC vs local day (M10), transfer leg deleted (M5), balance edited by hand (M6), two tabs / stale page (localStorage last-write-wins, nothing re-reads; assumed, confirm by running two tabs).
Dropped axes: Role & access beyond Owner/M8 (single user), Record lifecycle draft/pending/approved (entries have none), Concurrency "approved elsewhere".

### What works
Every destructive action except refund is a two-step inline confirm that names the thing and the amount, and the goal and category-budget confirms say what stays ("Your money stays in your accounts"). The day sheet, weekly bars, heatmap, Monthly SAVED and Yearly all derive from the same `totals()` on local days, so inside Insights the numbers do agree with each other. M8's surfaces are consistently marked (gold eyebrow, one `AiMark`), the fallback lists what it can do, and the goal-added message says "I haven't moved any money", which is still true.

Offer: add EC-008 (sign change on edit), EC-009 (goal date format), EC-010 (UTC vs local day) and a Transfer-leg linking note to `brain/system-map.md` via `design-context`, and record the "Other = unfiled" labelling under `features/insights` edge cases.
