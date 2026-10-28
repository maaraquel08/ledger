---
type: fact
status: draft
updated: 2026-10-29
related: [D-0017, D-0016, D-0013, home, activity, accounts, budgets-and-goals, insights, system-map, rules/rule-signed-money]
---

# Analytics

**Purpose.** Lets the Owner see a week, month or year at a time and compare their spending and income with the period before and with their usual.

## Scope
- In: Week / Month / Year switch, ‹ › period stepping, headline with comparisons, trend chart with table view, spending habits, recurring bills, income, deterministic conclusions ("What this means"), cloud M8 review for the period.
- Out: editing entries (every row opens Money); custom date ranges; budgets editing (Today); forecasting beyond the month's pace line; anything from a bank.

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | All periods since the ledger's first entry | Switch period, step back, tap a bar, open the entries behind any number | Step into the future; edit here |
| M8 | Entries | Fixed-template conclusions (local); stored weekly / monthly narratives (cloud, D-0013) | Change data |

## Rules
- Route `/analytics?p=week|month|year&at=YYYY-MM-DD` (`src/screens/analytics.tsx`); `at` is any day in the period; a future or bad date falls back to now; default Month. Switching kind keeps "current" if you were on it.
- Periods: Monday-start weeks, calendar months, calendar years (`src/lib/analytics.ts`). Labels "Oct 20–26", "Sep 29–Oct 5", "Oct 2026", "2026"; the current one adds "· so far". › disabled on the current period; ‹ disabled at the ledger's first period.
- Spending and income follow `selectors.ts`: Transfer, Investments, Adjustment and refunded entries are neither (glossary).
- **Like for like:** an unfinished period compares with the same elapsed days of the previous one (`priorPeriod`, e.g. Oct 1–29 vs Sep 1–29). The **trailing average** reads the same stretch of up to 8 weeks / 3 months / 5 years before, only periods since the ledger began.
- Headline: Income, Spending, Net saved, Savings rate; each "VS PREV" and "VS AVG". Percent change for income and spending, peso difference for net (it can cross zero), points for savings rate. NEW = nothing before; NO DATA = no earlier period in the ledger; — = nothing either side.
- Trend: income and spending bars for the last 8 weeks / 12 months / 5 years ending now (or at the selected period if older), periods before the ledger dropped; selected period shaded and bold; tap a bar to open that period; "Show table" swaps in a table. Chart colours are `--chart-in` / `--chart-out` (validated for colour-blind separation, light and dark).
- What this means: up to five fixed-template cards, each with a number, "Based on N entries" and See entries: biggest driver (category that moved spending most), savings rate vs average, unusual category (≥ 1.5× its average and over ₱500 / ₱1,000 / ₱5,000) else biggest category, pace vs budget (month; past months: under / over budget), priciest day (week) or biggest month (year), recurring bills' share.
- Habits: categories (amount, share, change; top 6 then "Show all"), movers up / down, top 5 merchants (same description, case and spaces ignored), average spending a day by weekday since the ledger began (rent, bills and subscriptions left out), recurring bills.
- **Recurring bill:** same merchant charged in ≥ 3 of the last 6 months, about once a month (at most one extra), each within 25% of the typical amount, within ± 5 days of the same date.
- Income: sources by description with change; consistency over up to 6 finished months: Steady (varies < 10%), Varies a little (< 25%), Irregular.
- Tap-throughs open Money with the readable filter (type, category, dates) when it shows exactly the same entries, else with the entries pinned by id and a label (`entriesHref`).
- Cloud: the latest stored weekly review (Week) or monthly close (Month) whose period starts inside the selected period shows above the headline; not marked read from here.

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| No entries | ledger empty | "Nothing to analyse yet" + example + "Add an entry" | Log |
| First period | no earlier period in the ledger | NO DATA chips; "This is the first month in your ledger. The trend fills in as you log." | Next period |
| Empty period | nothing logged in the selected period | zero headline, trend, "Nothing logged in …" | Step or tap a bar |
| No recurring | under 3 months | "None found yet…" | Time |
| Income consistency | under 2 finished months | "Needs two finished months of entries." | Time |

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Analytics | `/analytics` | Switch / step period | Screen, PageTitle, Segmented, Delta, AiEyebrow, AiCard (cloud), Cta (empty) |

## Interactions
| | |
|---|---|
| Owns | Nothing persistent; the period lives in the URL |
| Reads | entries, `profile.monthlyBudget` (via `monthBudget`), `ledgerStart`; cloud: `insights` rows (weekly, monthly) |
| Writes | None |
| Triggers | `/money?…` (filters or pinned ids), AddSheet (empty state) |
| Exposes | `/analytics?p=&at=` deep links (Today's "This month so far", old `/insights`) |
| Depends on | activity (entries), budgets-and-goals (budget), insights inbox (D-0016) |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Split receipt in a category | Category amount counts the split part; Money's category filter shows the whole entry | handled in code |
| Refunded entry | Not spending; links fall back to pinned ids so Money shows only counted entries | handled in code |
| Ledger began mid-period | Weekday averages count only days since the start; trailing average skips earlier periods | handled in code |
| Cloud ids are long | Pinned-id links only when no filter matches exactly | handled in code |

## Open questions
- Should Analytics get its own budget-by-category view, or keep pointing to Today?
