# Add entry: category, account and amount selection

## Brief
**Request.** Make picking the category, account and amount in the Add entry sheet intuitive; explore different studies. Studies live as Elyx files in `design-ledger/studies/add-entry-selection/` (overview: `overview.elyx`).

**Problem underneath.**
- Grounded (`src/components/ledger/add-sheet.tsx:336-357`, `:200-247`): in keypad mode Category and Account are "Choose" rows, and each one opens an unranked wrap of up to 13 pills below a 3×4 keypad that already fills the sheet.
- Grounded (`add-sheet.tsx:215`): accounts are picked by nickname ("Daily wallet"), while the typed preview and every `EntryRow` name them "GCASH ·8871". That gives the same object two vocabularies.
- Grounded (`add-sheet.tsx:345`, `:322-329`): the sign is a segmented control in keypad mode but a chip in typed mode.
- Inferred from the persona in `brain/users.md`: Mika logs the same handful of entries several times a day, one-handed, yet starts from "Choose" every time.

**Roles.** The Owner picks the values and saves. M8 may propose values from deterministic, local rules (D-0002) and never saves on its own (`features/add-entry.md`, Permissions).

**Constraints.**
- D-0005: only the amount is required, so category and account never block Save.
- D-0003: ink for the CTA and selection, gold for M8, and no yellow in this sheet.
- D-0010: Invest keeps its "To" account.
- D-0001: suggestions are computed on the phone.
- `brand_locked: true`: the studies vary structure, order, defaults and density, never tokens.

**Scope.**
- In: keypad/form mode selection, the account vocabulary, the sign control, defaults and ranking, and how the selection relates to typed mode.
- Out: the parse grammar, receipt scan and Home voice.
- Deferred: date picking beyond "today" and editing the note.

**Success criteria.**
1. A repeat entry (Grab, GCash, ₱248) takes three taps or fewer after the sheet opens, keypad digits excluded.
2. Category and account are visible, or one tap away, without scrolling the sheet.
3. Accounts are named the same way in the picker, the preview and the list.
4. Leaving category or account empty is visible but never blocks Save.

**Open questions.**
- Should ranking be per time of day or just by overall frequency? Owner decides.
- Should keypad mode replace typed mode or sit beside it? Owner decides.

## Options
Studies: `design-ledger/studies/add-entry-selection/` (`overview.elyx` compares all four against today's sheet). Brand locked: only structure, order and defaults vary.

**A · Rails (conservative)**: `a-rails.elyx`
- **Core bet:** nothing is hidden. Ranked Category and Account rails sit under the amount; the keypad stays in the thumb zone.
- **How it works:**
  - The sign is a −/+ toggle beside the amount, and Invest is the last category chip.
  - "More" swaps the keypad for the full category grid.
  - Date and note collapse to a single "Today · Add note" line.
- **Makes easy:** the usual entry takes two taps plus the digits. Every choice is visible at once with no sheet scroll.
- **Makes harder:** rare categories need More, then a pick, then Done. The rails clip after 2–3 chips, and the sheet is denser.
- **Reuses:** `Pill`, `ProviderMark`, the keypad and `Cta`.
- **Needs new:** a rail (horizontal scroll with a pinned More), an account chip and a sign toggle.
- **Systemic touchpoints:** a ranking of categories and accounts from local entries. This is new selector logic, and it stays local (D-0001).
- **Biggest risk:** if ranking is often wrong, the gold "usual" outline becomes noise.

**B · Sentence**: `b-sentence.elyx`
- **Core bet:** the entry reads as one sentence, "Spent −₱248 on Transport from GCash ·8871 today". One fixed panel swaps between the keypad, the category grid and the account list for whichever part is active.
- **How it works:** picking a value moves on to the next empty part.
- **Makes easy:** one model for typed and keypad modes, since the sentence is what `parseEntry` already produces.
- **Makes harder:** with long labels the sentence runs to three lines of small targets. Moving on automatically can feel pushy when only one part needs changing.
- **Reuses:** the keypad and `ProviderMark`.
- **Needs new:** sentence parts (default, active and empty states) and a picker panel.
- **Systemic touchpoints:** typed mode would render the same sentence, so `add-entry.md` states merge.
- **Biggest risk:** discoverability; the "Next" key is the only way out of the keypad apart from tapping a part.

**C · Category first**: `c-category-first.elyx`
- **Core bet:** people think "I took a Grab", not "₱248". Step 1 is a ranked 3×3 category grid; step 2 is the amount, with the account set to the one last used for that category.
- **Makes easy:** the usual entry is one tap plus the digits. Each tile shows the last amount and account as memory.
- **Makes harder:** an entry with no category, or a rare one, starts slower. Date, note and Invest's "To" account are not placed yet.
- **Reuses:** the keypad and `ProviderMark`.
- **Needs new:** a category tile, an account chip, an account pick list and a sheet back header.
- **Systemic touchpoints:** a "last account per category" lookup.
- **Biggest risk:** a wrong account default saves silently, and the only cue is a small chip. A category with no history needs the "Account?" warning state, which is not drawn.

**D · Usuals (ambitious)**: `d-usuals.elyx`
- **Core bet:** M8 offers whole repeat entries (category, account and typical amount), ranked by frequency and time of day. Log saves in one tap with an 8-second Undo; tapping the row opens it to adjust only the amount.
- **How it works:** typing stays first-class, and "Something else" leads to the plain form.
- **Makes easy:** repeat entries take one tap.
- **Makes harder:** one-off entries move one step deeper, and the sign is not shown in the usuals path.
- **Reuses:** `EntryRow`, `AiEyebrow` and the keypad.
- **Needs new:** a usual row with a Log pill, an undo bar inside the sheet, and a `usuals(hour)` ranking.
- **Systemic touchpoints:**
  - M8 gains a new duty, proposing whole entries. This is allowed by D-0002 because it is rules, not a model.
  - Mis-logs are corrected through Undo or Activity.
- **Biggest risk:** a one-tap "~₱250" logs a typical amount rather than the real one. A new user sees nothing until history builds up (D4 covers this).

**Against the success criteria**
| Study | 1 · Repeat entry in ≤3 taps | 2 · Visible without scrolling | 3 · One account vocabulary | 4 · Empty is visible, doesn't block |
|---|---|---|---|---|
| A | 2 taps + digits | yes | yes | yes, gold "Category?" |
| B | 3 (Next + 2 picks) + digits | one tap away | yes | yes, gold empty parts |
| C | 1 tap + digits | category yes, account as a chip | yes | weaker: the default hides "missing" |
| D | 1 tap (approximate amount) | yes for usuals | yes | not applicable to usuals |

**Sova proposes:**
- **Base:** take A as the base. It fixes all four problems with the least new behaviour, and it keeps D-0005 visible.
- **From C:** fold in its one cheap idea: once a category is picked, preselect that category's last-used account in the account rail.
- **From D:** hold back as a later layer above the rails, once ranking proves trustworthy on real usage.
- **B:** keep as the direction if typed and keypad modes should merge.

The choice is the Owner's.
