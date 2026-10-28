---
type: fact
status: draft
updated: 2026-10-29
related: [budgets-and-goals, activity, add-entry, home, users, system-map, D-0012, rules/rule-signed-money, D-0013, D-0015, D-0016]
---

# Insights

**Purpose.** Lets the Owner see where a week, month or year went, once enough days are logged.

## Scope
- In: 7-day gate, weekly / monthly / yearly, heatmap, AI lines, day sheet.
- Out: Budgets editor (see `budgets-and-goals`); history import ("Import history · soon", disabled); chat "SAVE TO INSIGHTS" (nothing reads it).

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | All periods, day sheets | Switch period, step periods, add entry for a day | Edit entries from here (taps go to Activity) |
| M8 | Entries | Writes the weekly and yearly lines (rules) | Change data |

## Rules
- Route `/insights` (`src/screens/insights.tsx`). Segmented Weekly / Monthly / Yearly remembered per session (`ledger:insights-period`); stepper prev/next, next disabled at current period.
- Gate: `daysLogged(entries) < 7` shows NotEnough for ALL periods (`insights.tsx:506-549, 588`). Days keyed by `e.date.slice(0,10)` = UTC date.
- Weekly (`insights.tsx:174-306`): "SPENT THIS WEEK/THAT WEEK"; "+/−N% vs last week" only if last week > 0 (green when <= 0); Mon-Sun bars, tap -> day sheet; "Daily average ₱X · <Day> was N.N× your average" (average over elapsed days); "WHERE IT WENT" top 3 + "Everything else", then an "Unfiled" row (₱X · N%) for spend with no category (`insights.tsx:196, 280-285`).
- Weekly AI card: weekday costing most over the 4 weeks ending at the selected week's end, FIXED categories excluded: "<Day>s cost you ₱X over the last four weeks, mostly <category>. Moving one of those outings in would cover a week of coffee." Fallback "Log a few more days and I'll spot your pricey weekdays."
- Monthly (`insights.tsx:315-423`): SAVED (net, "N% savings rate") and SPENT ("₱X under|over budget" or "No budget set", raw `profile.monthlyBudget`, no suggested fallback); SPEND CALENDAR heatmap Monday-start, 6 levels by ratio to month max: < 15%, < 35%, < 60%, < 85%, < 100%, max (`insights.tsx:308-313`); future days dashed and disabled; "VS. LAST MONTH" top 6 categories with % delta (0 when last month had none).
- Yearly (`insights.tsx:425-504`): "NET SAVED IN <year>" + rate; 12-month income/spend bars; stats Total income, Total spend, Biggest month, Net saved; AI line "You saved X.X months of expenses in N month(s). At this pace <year> closes at ₱Y saved." (months = net / average monthly spend; projection = net / elapsed x 12) or "Nothing logged for this year yet."
- Spend excludes Investments and Transfer and refunded entries (`selectors.ts:4-11`); split receipts count each part by category.
- Day sheet (`insights.tsx:123-172`): future "Still to come"; none "Nothing logged on this day" + "Add for this day"; else SPENT total and entries (tap -> detail).
- Period labels: "19 – 25 October 2026", "October 2026", "2026 · year to date".

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Not enough | < 7 days logged | "N OF 7 DAYS LOGGED", mini bars; "<Word> more day(s) and I can tell you something useful."; "Insights need a week of entries." + "Nothing logged yet." or "You're on day N." (`insights.tsx:536-538`); CTA "Log today"; disabled "Import history · soon" | Log days |
| Weekly empty | no spend that week | "No spending this week." | Step period |
| Weekly sparse | no data for pricey-day rule | "Log a few more days and I'll spot your pricey weekdays." | Log |
| Yearly empty | no entries in year | "Nothing logged for this year yet." | Step |
| Day: future / none / data | per above | "Still to come" / "Nothing logged on this day" / entries | Close |

## Flow
Insights -> choose period -> step -> tap bar or heat cell -> day sheet -> entry detail or "Add for this day" (AddSheet with date). "Budgets" link -> `/budgets`.

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Insights | `/insights` | Switch period | Screen, TabBar, Segmented, StatGrid, AiCard, Cta |
| Day sheet | sheet | "Add for this day" | Sheet, EntryRow |

## Planned (approved 2026-10-29, not shipped)
- The Insights screen folds into **Today** (D-0015) as the week / month / year switch with analysis cards; `/insights` stops being a tab.
- In cloud mode "Insight" means a stored item in the in-app inbox (D-0016): daily one-liner, weekly review (Sunday), monthly close (first Sunday), alerts, saved answers. Deterministic triggers decide if anything is worth saying; "nothing to flag" is valid. Each cites the entries behind it; numbers come from SQL facts (D-0013).
- The weekly review and material alerts may be pushed (max 3 a week, no amounts, quiet hours 22:00–07:00 Asia/Manila).
- The chat "SAVE TO INSIGHTS" flag is replaced by saving an answer to the inbox.

## Interactions
| | |
|---|---|
| Owns | Nothing (read-only); remembers last tab in sessionStorage |
| Reads | entries, `profile.monthlyBudget`, `daysLogged`, month/week bounds |
| Writes | None directly (AddSheet writes `add-entry`) |
| Triggers | AddSheet (`openAdd` with date), `/budgets`, `/activity/:id` |
| Exposes | Nothing; no feature reads chat "saved" flag |
| Depends on | activity (entries), add-entry (Log today), budgets-and-goals (link) |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| "Almost there." headline | Branch at `insights.tsx:534` unreachable (n < 7 only) | unhandled |
| UTC vs local day near midnight | Gate and mini bars may mis-count (UTC+8; unverified impact) | unhandled |
| No budget (monthly) | "No budget set" even if suggested exists | handled in code |
| Last month had no category | Delta shown as 0 | handled in code |
| Demo has no prior-year data | Yearly past years empty | handled in code |
| Future days | Disabled in heatmap | handled in code |
| Previous week = 0 | No % shown | handled in code |

## Open questions
- Monthly "SPENT" ignores the suggested budget that Home uses; align?
- Should "Almost there." be reachable (e.g. at 6 days)?
