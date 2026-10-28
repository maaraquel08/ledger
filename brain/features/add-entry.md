---
type: fact
status: draft
updated: 2026-10-29
related: [home, receipt-scan, activity, review, accounts, users, system-map, D-0012, rules/rule-signed-money, D-0013, D-0005, D-0007, D-0010, D-0014, D-0015]
---

# Add entry

**Purpose.** Lets the Owner log entries from any tab three ways: fill the entry by hand (Manual), say it (Voice), or photograph a receipt (Camera).

## Scope
- In: AddSheet with a Manual / Voice / Camera switch, the draft row, the Manual pickers, hold-to-talk in the sheet (one or several entries), the in-sheet receipt camera, toast, missing-field behavior.
- Out: a typed sentence field (removed 2026-10-29; Home's "Or type to M8…" bar is the typed path); questions (Home routes them to Chat); receipt duplicate detection and the Review screen (only on `/scan`, see `receipt-scan`); date inference from speech.

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | The entry as the Activity row it will become | Log entries; pick kind, amount, category, account, date, note; fix what Voice or Camera missed | Log a future date (`max=today`) |
| M8 | Speech and receipt text | Proposes desc, amount, category, account by rules | Save without the Owner pressing Save |

## Rules
- AddSheet is mounted globally when onboarded; opened via `openAdd({accountId?, text?, date?})` from Activity FAB and empty state, Account detail "Add entry here", Insights day sheet and "Log today" (`src/App.tsx`). It always opens on Manual with the amount part active. `text` (no caller passes it today) is read once with `parseEntry` into the Manual draft.
- Mode switch is the ink `Segmented` control: Manual, Voice, Camera (`src/components/ledger/add-sheet.tsx`). Switching cancels listening and any open fix.
- **Draft row** (`DraftRow`, `src/components/ledger/entry-draft.tsx`): EntryRow's slots, each a button. Logo slot + account label open the account picker, title opens the kind picker, chip opens category (or the "To" account for Invest), amount opens the keypad. Missing parts are gold: empty logo slot, "WHICH ACCOUNT?", "NEEDS CATEGORY" chip, "₱0". The part being edited is underlined (the chip gets an ink outline).
- **Manual.** Title is the note if set, else the kind word (Spent / Got / Moved). One fixed-height (300 px) panel swaps to the active part's picker: kind list, keypad (whole pesos, max 7 digits, Next), category grid, account list (with "Not sure yet", stays null for Review), Today / Yesterday / another day, note (max 80, becomes desc, default category or kind). Picking a value moves to the first empty required part (amount, category unless Invest, account). Complete: the panel collapses to "Today · Thu 29 Oct" (opens the date picker) and "Add note" / "Edit note". Category and account lists are ranked by how often this phone used them (local rule).
- **Voice.** The Home orb (`src/components/ledger/orb.tsx`, 132 px in the sheet): "Hold to log" with the example "₱248 Grab to work, GCash". Hold to listen ("Listening…" + live transcript), release to read. A press under 280 ms is a tap: "Hold the button while you talk." Text goes through `splitEntries` + `parseSpoken` (`src/lib/parse.ts`), so one hold can be several entries and the spoken transfer rule applies (D-0007). A question gets "That sounds like a question. Ask M8 on Home."; no amount gets "I didn't catch an amount. Try “₱248 Grab, GCash”."
  - One entry: the draft row + a "HEARD" row quoting the transcript; the small yellow mic clears back to the orb.
  - Several entries: "N ENTRIES · −₱X" and gold "N NEED(S) A DETAIL", then Activity rows in a list capped at 312 px that scrolls. Tapping a row opens its first missing part (else category).
  - Fixing a part (amount, category, account) shows that entry's draft row over the picker, then the next missing part, then back ("Back to the list" / "Done").
- **Camera.** Viewfinder inside the sheet (232 px, `useCamera` in `src/lib/camera.ts`, shared with `/scan`), yellow brackets, shutter, "Choose a photo". The photo is read on the phone with the same pipeline as `/scan` (`recognize` + `parseReceipt`, see `receipt-scan`): "Reading the receipt…" with progress, then:
  - Read: the receipt as one draft row (merchant, paid-with account, largest category, total). A receipt with more than one category also shows "N CATEGORIES · −₱X" and its split lines (items, category, amount) in the same scrolling list; a line with an unsure item reads gold ("HOUSEHOLD?"). "READ FROM RECEIPT" row with a thumbnail, "Merchant · N items" and Retake. Only the account can be changed here.
  - No total, or the reader failed: "I couldn't read the total on that photo." / "The reader couldn't start on this phone." with Retake and "Use Manual".
- **Save.** Manual: one `add-entry` (or two linked legs for Invest, D-0010); date = now if today else `<date>T12:00:00` local. Voice: one `add-entry` per entry, `raw` = transcript, `source:"voice"`, `date = now + i ms`. Camera: one `add-entry` from `draftToEntry` (one entry with a `split`, never one entry per category). All set `queued = !navigator.onLine`. Save stays disabled until there is an amount (Manual) or a result (Voice, Camera).
- CTA copy: "Save expense · −₱X" / "Save income · +₱X" / "Save investment · ₱X"; Voice several: "Save N entries · −₱X"; Camera: "Save receipt · −₱X".

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Manual, amount | open | Draft row (amount underlined, rest gold) over the keypad | Next / tap a part |
| Manual, picking | tap a part or Next | That part underlined, its picker | Pick |
| Manual, complete | all required parts set | Row as in Activity, date + "Add note" line | Save |
| Voice, ready | Voice tab | Orb, "Hold to log", example | Hold |
| Voice, listening | hold | Louder orb rings, "Listening…", live words | Release |
| Voice, one entry | release | Draft row + HEARD row | Save / fix / mic |
| Voice, several | release | Count, needs-a-detail, scrolling rows, HEARD row | Save / tap a row |
| Voice, error | denied / unsupported / no speech / network | Specific copy under the orb | Hold again / Manual |
| Camera, viewfinder | Camera tab | Viewfinder, shutter, Choose a photo | Shutter / photo |
| Camera, reading | photo | Dimmed photo, progress, ON YOUR PHONE | Auto |
| Camera, read | total found | Receipt row (+ split lines), READ FROM RECEIPT, Retake | Save / Retake |
| Camera, unreadable | no total / reader failed | Message, Retake, Use Manual | Either |
| Saved | Save | Toast "Expense saved · ₱X" / "N entries saved · −₱X" / "Receipt saved · ₱X", + " · saved on your phone" offline (2.6 s) | Auto |

## Flow
Open (Manual) -> choose a mode -> fill, say or snap -> fix gold parts with their pickers -> Save -> `add-entry` (one or more) -> toast -> sheet closes.

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| AddSheet | global sheet (no route) | Save | Sheet, Segmented, DraftRow, SourceRow, EntryRow, Orb, ReceiptFrame, Cta, CategoryChip |
Design: `design-ledger/studies/add-entry-selection/b-sentence.elyx`.

## Planned (approved 2026-10-29, not shipped)
- Add stays global on every tab (D-0015); Scan becomes one of its capture modes.
- Cloud mode (D-0012, D-0013): text, voice clips and photos go to the `capture` function as a **raw input**. Voice is recorded in the browser and transcribed server-side; receipts are read by Claude vision. The entry saves instantly with Undo only when the confidence gate passes; otherwise it lands in Review with one question.
- Offline captures are "Saved on this phone" until the server acknowledges them, then "Synced".
- Copy fix: the Camera reading label "ON YOUR PHONE" is local-mode only; in cloud mode it must not claim the photo stays on the phone.
- Adjustment is not a kind in the sheet; it comes from reporting a balance (D-0014).

## Interactions
| | |
|---|---|
| Owns | Nothing (writes Entry) |
| Reads | accounts (pickers, parsing, paid-with), entries (ranking), `parseEntry`, `parseSpoken`, `splitEntries`, `parseReceipt`, local OCR |
| Writes | `add-entry` (Manual, each Voice entry, Camera receipt), `add-entries` (two linked legs for Invest with a "To" account); balance deltas applied by reducer |
| Triggers | Toast; opened with prefill from activity, accounts, insights |
| Exposes | Entries that may be missing category/account, feeding Review; voice and receipt entries carry `source` |
| Depends on | accounts, activity (FAB), receipt-scan (camera hook, reader, `draftToEntry`), home (orb, voice hook), providers/KEYWORDS vocab |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Category missing | Saves; "Needs category" chip; lands in Review | handled in code (D-0005) |
| Account missing | Saves with `accountId: null`; Review | handled in code (D-0005) |
| Amount missing (Manual) | Save disabled | handled in code |
| Many entries in one hold | One list, scrolls past 312 px; saved together | handled in code |
| Receipt with many categories | One entry with a split; lines listed and scroll | handled in code |
| Receipt matches a typed entry | Not checked in the sheet (only `/scan` checks) | unhandled |
| Receipt with doubts | Shown, not routed to a Review screen; unsure lines gold | handled in code |
| Spoken question | Not logged; points to Home | handled in code |
| Invest by voice or camera | Not available (Manual only) | unhandled |
| Invest, no investments account | Single outflow; chip "No investments account" in gold | handled in code (D-0010) |
| Offline | Saves with `queued`; toast adds " · saved on your phone"; first receipt read needs the OCR download | handled in code (D-0011) |
| Future date | Picker blocks it | handled in code |

## Open questions
- Should the sheet's Camera also run the duplicate check and send doubtful receipts to the full Review screen, like `/scan`?
- In Manual, should the row title become the category once picked instead of the kind word?
- Should a split line's category be editable from the sheet?
