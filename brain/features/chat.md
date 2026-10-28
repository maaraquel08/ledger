---
type: fact
status: draft
updated: 2026-10-29
related: [home, budgets-and-goals, insights, users, system-map, D-0012, rules/rule-daily-allowance, D-0013, D-0006, D-0008, D-0015, D-0016]
---

# Chat

**Purpose.** Lets the Owner ask M8 a question about their money and get a rule-based answer.

## Scope
- In: entry points, 8 intents, fallback, streaming timings, sources, offer to goal, save-to-insights flag.
- Out: moving money, always. In local mode (shipped): free-form understanding, memory of prior messages, multi-turn context, any model or network call (`README`: computed locally by rules); cloud mode changes this (planned, below).

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | Own transcript (sessionStorage `ledger:chat`) | Ask (type or hold mic), copy, open sources, accept offers, clear | Move money; ask for anything beyond the 8 intents |
| M8 | Everything: entries, budgets, goals, holdings (current calendar year entries only) | Answers by rules; creates a goal on request | Move money |

## Rules
- No tab. Reachable only from Home: a question typed or spoken (`/chat?q=..&via=voice|text`, asks once on mount, URL cleaned) or The math "Ask a follow-up" (`src/screens/chat.tsx:376-386`). Back goes to `back("/home")`.
- `respond(q, state)` (`chat.tsx:33-228`): regex on lowercased question, first match wins:
  1. Coffee `coffee|starbucks|tim hortons|cafe` -> total, visits, per-visit and per-month, bar chart. None: "I don't see any coffee purchases this year yet."
  2. Tonight: (`afford|can i (get|have|go|buy|eat)`) AND (`tonight|today|dinner|lunch|eat out|out now`) AND no digits; uses `todayBudget`. No budget: "Set a budget first and I'll tell you what tonight can cost." Left > 0: "Yes, up to ₱X. Anything more comes out of tomorrow, which drops to ₱Y." + meals-out-this-week + offer "Set ₱R aside" (R = left rounded down to 50; goal "Dinner out", `by` = current month "YYYY-MM", `chat.tsx:85`). Else "Not tonight. You're already ₱X over today, and tomorrow drops to ₱Y to cover it."
  3. Purchase `afford|laptop|buy|purchase` (`chat.tsx:91-120`): price = first number >= 1000 (supports k). No price (< 1000): "How much is it? Ask me again with the price, like “Can I afford a ₱65,000 laptop?”" (no ₱65,000 default any more). cash = bank + ewallet + cash; after = (cash - price)/avg monthly spend. cash < price "Not yet."; after >= 3 "Yes, comfortably."; else "Yes, but it eats into your buffer." (", below your 3-month rule" if < 3). Offer "Yes, set it up": goal named after the first of laptop|phone|bike|car|trip|tv|camera|console found in the question (capitalised), else "Purchase"; `by` = next month "YYYY-MM".
  4. Dining `skip|eating out|dining|restaurant|food`: monthly Food & drink average; "Cutting it in half would free up ₱X a month, or about ₱Y over a year."
  5. Salary `salary|income|where does|go\b|paycheck`: "Of every ₱100 you earn, ₱a goes to <cat>..." top 3 of up to 5. No income: "I don't see any income logged this year yet." (`go\b` also matches "ago").
  6. Goals `japan|goal|track|trip` (`chat.tsx:150-185`): monthsLeft from `goalMonth(by)` (`src/lib/format.ts:77`), min 1; need = (target - saved)/monthsLeft; capacity = max(0, year net / elapsed). Goals with no date are skipped and named: "<Goal> has no date, so I left it out."; if every matching goal is undated: "<that sentence> Add a date in Budgets and I'll check your pace." "Yes, you're on track." or "Not quite yet." + "₱X a month short". None: "You haven't set a matching goal yet. Add one from Insights and I'll check your pace."
  7. Cut `cut|trim|reduce|save more|spend less`: largest of Food & drink, Shopping, Transport, Subscriptions, Gifts, Other; "Trimming a quarter of it saves ₱Q a month." None: "I need a few more logged purchases before I can say what to cut."
  8. Daily math `math|daily|per day|a day|worked out|budget` (`chat.tsx:206-221`): uses `todayBudget`, the same number as the header and The math: "Your <Month> budget is ₱B. Before today you'd spent ₱S, leaving ₱R over N days, about ₱A a day. Today you've spent ₱T on day-to-day things, so ₱L is left today." (or "you're ₱X over today; tomorrow drops to ₱Y"). No budget: "Set a budget first and I'll show you the daily math."
- Fallback: "I'm not sure I can answer that yet. I can look at coffee and food spending, whether you can afford a purchase, where your salary goes, whether you're on track for a goal, and what to cut first."
- Streaming: answer computed synchronously; "loading" dots `STREAM_AT=1200` ms, then words at `WORD_MS=40`; "Stop answering" ends streaming; follow-ups, chart blocks and offer appear after completion.
- Limits: input `MAX=500` (counter at >= 80 chars). No question cap and no offline gate (D-0008): every question is answered, online or not. `run()` still dispatches `ask` (`chat.tsx:369`), which bumps `questionsToday`, but nothing reads it any more.
- Offer: "Set ₱X aside" / "Yes, set it up" -> `update-profile` adds a Goal, posts "Done. I added “<name>” as a goal of ₱X, by <Mon YYYY via goalLabel>. I haven't moved any money."; button becomes "Goal added".
- Message actions: COPY; "SAVE TO INSIGHTS" toggles a `saved` flag in sessionStorage only; "SOURCES · N" opens a sheet (first 60 in stored order, "Showing the 60 most recent of N.").

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Empty | no messages | "Ask anything about your money" / "I can see your transactions, budgets, goals and holdings. I never move money."; "TRY ONE OF THESE": "Where does my salary actually go?", "Am I on track for the Japan trip?", "What should I cut first?" | Ask |
| Header | per budget | "₱X left today" / "₱X over today" / "M8" | n/a |
| Composer | idle / loading / answering / listening | placeholder "Reply or hold to talk…" / "Reading your transactions…" / "Answering…" / "Listening… release to send" (`chat.tsx:420-427`) | n/a |
| Voice-logged entries | spoken entries today | interleaved "LOGGED BY VOICE · time" (tap -> entry) | n/a |
| Clear | More > "Clear conversation" | confirm | Cancel |

## Flow
Home question or math follow-up -> `/chat?q=` -> user bubble -> dots 1.2 s -> streamed M8 panel -> follow-ups / offer / sources.

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Chat | `/chat` | Send (type or hold mic) | Screen, AiPanel, AiCard, EntryRow, Sheet (Sources), Pill |

## Planned (approved 2026-10-29, not shipped)
- Cloud mode (D-0013): questions go to the `chat` function. Claude answers in M8's voice with **read-only** tools (period metrics, comparisons, spend by category, entries matching, goal progress); every number is a **fact** substituted by the server and a digit validator rejects any other digit. `sources` are the cited entry ids. Same answer shape as today.
- Free-form questions replace the 8 intents and the fixed fallback in cloud mode; local mode keeps them.
- Cloud mode needs a connection to answer, so D-0008's offline answering holds only in local mode. Any cap on questions is server-side (D-0016).
- M8 still never moves money and creates a goal only on the Owner's tap.
- Chat opens from **Today** (D-0015).

## Interactions
| | |
|---|---|
| Owns | Chat transcript (sessionStorage `ledger:chat`) |
| Reads | entries (current year), accounts, profile budgets/goals/holdings, `todayBudget`, `verdict` |
| Writes | `ask` (counter, unused), `update-profile` (goal from offer) |
| Triggers | Navigation to `/activity/:id` (voice-logged rows, sources) |
| Exposes | Goals created by offers to budgets-and-goals |
| Depends on | home (entry points), budgets-and-goals (goals, budget), insights (copy refers to it), voice |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Question while offline | Answered like any other (nothing is fetched) | handled in code (D-0008) |
| Goal with no date (`by` "") | Skipped in pace answer and named in the reply | handled in code |
| Purchase question with no price | Asks for the price instead of assuming ₱65,000 | handled in code |
| No budget | Tonight answer asks to set one | handled in code |
| Rephrased question | No memory or context; falls to first regex or fallback | handled in code |
| Offer name | Named after laptop/phone/bike/car/trip/tv/camera/console in the question, else "Purchase" | handled in code |
| Erase all data | sessionStorage chat survives | unhandled |
| Sources > 60 | First 60 stored order, copy says "most recent" | unhandled |
| "SAVE TO INSIGHTS" | Flag only; nothing reads it | unhandled |

## Open questions
- `ask` and `questionsToday` are now dead state; remove them from the reducer and `LedgerState`?
- Sources copy ("60 most recent") vs stored order; "SAVE TO INSIGHTS" has no effect.
- Chat is reachable only through Home; add a visible entry point?
