---
type: fact
status: draft
updated: 2026-10-29
related: [analytics, D-0017, add-entry, receipt-scan, chat, activity, review, budgets-and-goals, onboarding, users, system-map, D-0012, rules/rule-signed-money, rules/rule-daily-allowance, D-0013, D-0005, D-0006, D-0015, D-0016]
---

# Home

**Purpose.** Lets the Owner see today's number and log or ask by voice or text in one gesture.

## Scope
- In: today's number, hold-to-talk orb, text bar (log or ask), reading phase, ONE QUESTION card, receipt card + Undo, duplicate card, The math sheet, Profile sheet + erase, offline banner + flush-queue, storage banner, scan entry.
- Out: no dates from speech (always now); no cancel during reading; no real sync.

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | Everything on Home (single local user) | Log, ask, undo, scan, erase all data | Share or sync |
| M8 | All accounts, entries, budget | Parses speech/text by rules, asks "Which account paid?" | Move money; act without the Owner's hold/send |

## Rules
- Today's number = `todayBudget().left` (`src/lib/today.ts:14-32`): budget = profile budget or suggested; allowance = max(0, (budget - month spend before today) / daysLeft); spent today excludes Rent & bills, Subscriptions, Groceries, Household; `left = round(allowance - spentToday)`; tomorrow = max(0, round((budget - spentAll)/(daysLeft-1))).
- Pipeline `process(raw, via)` (`src/screens/home.tsx:120-142`): empty -> error; `isQuestion` (ends with "?", or starts with a question word or "show me / tell me / explain") -> `/chat?q=..&via=..` (online or not, D-0008); else `splitEntries` -> `parseSpoken` -> drop items without amount; none left -> error with heard text; else `save()` then reading. Typed text uses the same pipeline.
- Hold `HOLD_MS=280` (shorter = tap hint); slide left > `CANCEL_PX=70` cancels; Space/Enter hold on orb works (`home.tsx:35, 168-216`). Speech `en-PH` (`src/lib/voice.ts:58-60`).
- Save first, read after (D-0011): `save()` runs inside `process()` before the Reading phase (`home.tsx:93-118, 138`): one `add-entry` each, `date = now + i ms`, `raw = said`, `queued = !navigator.onLine`, `source:"voice"` only if spoken. Saved ids collect in `pending` (`home.tsx:91`). Category or account may be null (D-0005, goes to Review).
- Reading only builds the receipt card: after `READ_MS(1100) + items*250` ms it turns `pending` into the receipt (`home.tsx:145-156`). Leaving Home mid-Reading loses nothing. A second line sent during Reading adds its ids to `pending`, so the receipt covers both lines.
- ONE QUESTION: exactly 1 saved id, no account found, >= 1 account (`home.tsx:151, 738-780`). Up to 3 non-investment accounts ranked by existing entry count, plus a fourth option "Not sure" that dismisses the card (`skipQuestion`, `home.tsx:248-250`); the entry stays saved and lands in Review. Answer -> `update-entry accountId`.
- Receipt card enters and exits with transitions.dev `22-toast` (`.t-toast` / `.is-open`: slides up 28px on enter and down on exit, no blur or scale; open 350 ms, close 250 ms; `useToastPresence` keeps it mounted through the exit; `src/index.css`, `src/screens/home.tsx`). It auto-dismisses after `RECEIPT_MS=8000`; paused while asking, duplicate pending, or focus inside. Undo deletes all ids in the card (`home.tsx:671-840`).
- Meta line: offline or queued -> "SAVED ON PHONE" (`home.tsx:726`); Transfer -> "TRANSFER · NOT SPENDING"; receipt -> "From receipt · <acct> · N item(s)"; else "<Category or Needs category> · <Account or No account>".
- Reconnect: if any queued entries exist, `flush-queue` runs, only while Home is mounted (`home.tsx:71-75`). It just clears the flag.
- The math sheet uses the same `todayBudget()` as the number (`src/screens/home-sheets.tsx:60, 88-110`, D-0006); only opens when a budget exists (`home.tsx:294`). Rows: Budget / − Spent before today / ÷ N days left = ₱A a day / − Spent today on day-to-day / = Left today. MONTH PACE (category list, only if category budgets exist, `home-sheets.tsx:118-140`): fixed categories (Rent & bills, Subscriptions) use the full cap, others `budget * day/daysInMonth`.
- Scanner handoff read once from sessionStorage `ledger:handoff` on mount (`home.tsx:46-57`).

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| No budget | budget 0 and no income | "₱—" "no budget yet"; "Say your first entry" / "Try “₱250 groceries, cash”. Set what you earn in Budgets and M8 will work out today’s number." (`home.tsx:479-482`) | Set a budget |
| Under | left >= 0 | "₱X" "left today"; "Hold to log or ask" / "“₱250 groceries, cash”" | n/a |
| Over | left < 0 | red "−₱X" "over today"; "Tomorrow drops to ₱X to cover it." | Next day |
| Tap too short | hold < 280 ms | "Keep holding while you talk" / "Release to send. Slide left to cancel." | Hold |
| Listening / cancelling | holding / slid left | live transcript; "Release to discard" | Release |
| Reading | after release | sentence + chips (amount, "Category?", "No account", "Today") or "Reading · N of M found"; entries are already saved | Auto, then receipt card |
| Error no-speech/other | nothing parsed | "Didn't catch that" / "Hold a little longer, or say the amount first." | Retry |
| Error denied | mic blocked | "Microphone is off" + "Allow microphone" | Retry |
| Error unsupported / network | browser / `network` | "Voice isn't available here" / "Voice needs a connection" | n/a |
| Storage failed | `persistError` true | `role="alert"` banner "Couldn’t save on this phone. Free up space or delete receipt photos." (`home.tsx:266-273`; `App.tsx:67-71` renders the same text) | Free space; next successful save clears it |
| Duplicate | scan matched an entry | "ALREADY LOGGED?" "Attach to that entry" / "Log as new" / "Discard" | Choice |
| Math, first open | online, once per session (`ledger:math-seen`) | 600 ms skeleton "Reading N transactions…" | Auto |
| Erase | Profile > "Erase all data" | "Erase all data on this phone? This clears every account, entry and goal on this device. It can't be undone." -> "Erase everything" | `reset`, go to `/` |

## Flow
Hold orb or type -> process (saves) -> reading -> receipt card (Undo 8 s). Question -> `/chat`. Scan icon -> `/scan`. Avatar -> Profile sheet. Number tap -> The math -> "Ask a follow-up" -> `/chat?q=Show me how you worked out my daily budget`.

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Home | `/home` | Hold orb to log or ask | Screen, TabBar, EntryRow, AiCard |
| The math | sheet | "Ask a follow-up" | Sheet, StatGrid |
| Profile | sheet | "Erase all data" | Sheet, Cta |

## Today (shipped 2026-10-29, D-0017)
- Route `/today` (`src/screens/today.tsx`): date eyebrow + avatar, M8 · Today card (cloud: fresh daily insight, else the local template), LEFT TO SPEND hero, today's number with "Show the math", "Ask M8 about your money".
- A bordered block: "THIS MONTH SO FAR · ANALYTICS" with In / Out / Saved % for the month (`verdict().totals`), opens `/analytics?p=month&at=<1st>`; below it "N entries to review" (only when N > 0) opens `/review`.
- Then the insight inbox (cloud, D-0016) and budgets and goals (`Plan`). The week / month / year analysis and its 7-day gate moved to Analytics; nothing of it remains on Today.
- Bottom clearance: every tab screen pads by `--tab-clearance` (tab bar 66 + gap 14 + Add 60 + 40 air + safe area, `src/index.css`), so the last goal row clears the Add button and its glow.

## Planned (approved 2026-10-29, not shipped)
Home becomes the **Today** tab (D-0015, now D-0017). It keeps today's number and The math (D-0006) and adds:
- M8's sentence on top: the daily one-liner, an in-app insight (D-0016), never pushed.
- ~~A week / month / year switch with analysis cards~~: moved to the Analytics tab (D-0017, `analytics`). Budgets fold in here (`budgets-and-goals`).
- Chat opens from Today; the insight inbox is reachable from Today.
- Cloud mode: captures go to the `capture` function and save instantly with Undo only when the confidence gate passes, else land in Review with one question (D-0013); offline lines show "Saved on this phone" until synced (D-0012).
- Scan stops being a separate screen; the scan icon opens Add in Camera mode.

## Interactions
| | |
|---|---|
| Owns | Nothing persistent (Profile sheet and math skeleton flag only) |
| Reads | accounts, entries, profile initials/name, `todayBudget`, `verdict`, `useOnline` |
| Writes | `add-entry`, `update-entry` (account answer, attach receipt), `delete-entry` (Undo), `flush-queue`, `reset` |
| Triggers | `/analytics?p=month&at=` (This month so far), `/review` (count row), `/chat?q=&via=`, `/scan`, `/activity/:id`, navigate `/` after reset; reads sessionStorage `ledger:handoff` |
| Exposes | today's number and the math to chat ("daily" answer) |
| Depends on | add-entry (parser), receipt-scan (handoff, duplicates), chat, review, budgets-and-goals |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Entry text starts with can/how/what/is/do/show me... | Routed to Chat, not logged (`parse.ts:80-87`) | unhandled |
| Entry saved with no category/account | Saves, lands in Review | handled in code |
| Offline "as of" label | Label frozen, number keeps recomputing | unhandled |
| Offline AddSheet entries | Chip "On phone" until Home is open and online | unhandled |
| Profile erase | sessionStorage chat and onboarding draft survive | unhandled |
| Reading phase | No cancel; entries are already saved, so leaving Home keeps them and a second line extends the receipt | handled in code (D-0011) |
| Storage banner on Home | Rendered by both `App.tsx:67` and `home.tsx:266`, so Home may show it twice (unverified) | unhandled |
| Seed entries today at 07:30-08:42 | May be future-dated if opened earlier (unverified) | unhandled |
| Avatar with no name | Shows "?" or initials "ME" | handled in code |

## Open questions
- `flush-queue` still only clears the `queued` flag. Answered by D-0012: in cloud mode the flag means "Saved on this phone" and clears only on the server's acknowledgement.
- Dates from speech ("yesterday") not supported; intended?
