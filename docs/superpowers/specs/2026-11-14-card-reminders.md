# Spec: Card reminders, separate from subscriptions

Status: approved by the Owner 2026-11-14 · amends `2026-11-14-subscriptions.md` (its card sections are replaced by this file)

## Objective
Not everything due is a subscription. Netflix has a fixed amount every month. A credit card doesn't: some cards need no payment at all, and how much to pay is the Owner's call each month. So:

1. **Subscriptions** (Netflix, Spotify, PLDT) stay as they are: fixed amount, due day, Mark paid.
2. **Card reminders** are opt-in. A card appears in Upcoming only if the Owner added a reminder for it. It has no amount. The Owner types how much when they pay.

Owner decisions (2026-11-14): add from Upcoming as "Card reminder" · no amount, with the amount owed as a hint · Pay = Transfer with the amount blank · one timeline with distinct rows.

## Design

### Data (no migration)
- A card reminder **is** a credit account's `dueDate` (`accounts.due_date`, already synced). Adding a reminder sets it to the next due date; removing it clears it. A card without a due date is never in Upcoming.
- The "Due day" field added to Edit account in the last change is **removed**: the reminder is managed in one place, Upcoming. The account screens still show `due 15 Dec` when a reminder exists.

### Logic (`src/lib/subscriptions.ts`)
- `cardStatus(card, entries, today)`: no longer needs anything owed. It returns `{ due, paid, owed }` for any credit account with a `dueDate`, otherwise null.
- `Upcoming` card items carry `owed` instead of `amount`.
- `dueWithin` sums **subscriptions only**. The eyebrow says so.
- Unchanged: due = the stored date while it's ahead, otherwise its day rolls forward; paid = a transfer into the card since the month before the due date; paid cards sort last.

### UX
**Money › Upcoming** (one list, by date):
```
UPCOMING · ₱892 SUBSCRIPTIONS, 30 DAYS                See all
Spotify     DUE 22 NOV · RCBC JCB ·4402        ₱194  [Mark paid]
The card    DUE 15 DEC · OWED ₱18,240    You decide  [Pay]
PLDT Fibr   DUE 15 DEC · BPI ·2841        ₱2,099  [Mark paid]
```
- A card row reads "You decide" (muted) where the amount would be. Its meta shows `OWED ₱X`, or `NOTHING OWED` at zero. Once paid it shows `PAID`, has no button, and goes last.
- Empty state: "Nothing due yet. Add a subscription like Netflix, or a reminder to pay a card." with an **Add** button.

**Add** (Upcoming empty state and the Subscriptions screen): one sheet with a two-way switch at the top, **Subscription | Card reminder**. The switch only appears when adding.
- *Card reminder*: CARD (credit accounts that have no reminder yet), DUE DAY (1–31), and the button **Remind me**. With no credit account: "Add your credit card on Money first." and no form.
- Tapping a card row (not Pay) opens its **Edit reminder** sheet: due day, **Save**, and **Remove reminder** (no confirm, nothing is lost).

**Pay** opens Transfer to the card with the **amount blank**. Under the amount, a chip **Pay in full · ₱18,240** fills it; no chip when nothing is owed. From defaults to the first bank, e-wallet or cash account.

**Full screen** `/money/subscriptions`, title **Upcoming**: groups SUBSCRIPTIONS and CARD REMINDERS, each with its own empty line.

### Out of scope
Storing a statement amount; "mark done" without an entry; minimum-payment chips; reminders for non-credit accounts.

## Commands
`npm test` · `npx vitest run tests/client/subscriptions.test.ts` · `npm run lint` · `npm run build` · `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5199` (local mode, for a browser check)

## Files
`src/lib/subscriptions.ts`, `src/screens/subscriptions.tsx`, `src/screens/accounts.tsx` (remove Due day; Transfer `suggest` chip), `src/App.tsx` (route title), `tests/client/subscriptions.test.ts`, brain (`features/subscriptions.md`, `features/accounts.md`, `glossary.md` "Card reminder", `system-map.md`, `CHANGELOG.md`).

## Testing
- **Unit:** a card without a due date gets no item; one with a due date gets an item even when nothing is owed; card items carry `owed`; `dueWithin` leaves cards out; adding and removing a reminder sets and clears `dueDate` through `upsert-account`.
- **Browser:** add a card reminder, change its day, remove it; Pay opens with a blank amount and the chip fills it; subscriptions are unchanged.

## Boundaries
- Always: tests, lint and build green; glossary words; brain write protocol.
- Ask first: migrations, pushing or deploying.
- Never: assume an amount for a card; count cards in the total.

## Success criteria
1. A credit card with no reminder never appears in Upcoming. One with a reminder always does, owed or not.
2. No card row shows a peso amount as the amount due; the 30-day total covers subscriptions only.
3. Pay opens with an empty amount; "Pay in full" fills the amount owed.
4. A reminder can be added, edited and removed from Upcoming alone; Edit account no longer has Due day.
5. `npm test`, `npm run lint` and `npm run build` pass.
