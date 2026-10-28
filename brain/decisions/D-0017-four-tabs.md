---
type: decision
area: design
status: active
updated: 2026-10-29
related: [features/analytics, features/home, features/insights, features/accounts, features/activity, features/review, system-map, D-0015, D-0016]
supersedes: [D-0015]
superseded_by: null
---

# D-0017 Four tabs: Today, Money, Analytics, Review

**Context.** D-0015 folded the week / month / year analysis into Today. The Owner asked on 2026-10-29: "Why we don't have analytics page? I want this so that I can get insights every week or month or year and compare my spending and income habits." Analysis under today's number made Today long and left no place to step through periods and compare them.

**Decision.** The tab bar has four tabs, in this order:
- **Today**: M8's sentence, today's number and The math, a one-line "This month so far" that opens Analytics, the Review count, the insight inbox (cloud), budgets and goals. No period analysis.
- **Money**: unchanged from D-0015 (accounts and net worth, the full ledger).
- **Analytics** (`/analytics?p=week|month|year&at=YYYY-MM-DD`): one period at a time with ‹ ›, compared like for like with the period before and with the trailing average; trend, spending habits, income, and plain conclusions that each link to the entries behind them. Cloud mode adds M8's stored weekly review or monthly close for that period.
- **Review**: unchanged.

Add stays global on every tab. `/insights` redirects to `/analytics`.

| Option | Outcome |
|---|---|
| Four tabs with Analytics (chosen) | Today stays a glance; comparisons get their own place and a deep link |
| Keep analysis inside Today (D-0015) | Long Today; no period stepping beyond the switch; Owner asked for a page |
| Analytics as a sub-page of Today | One more tap, no tab; the Owner asked for a page they return to weekly |

**Consequences.** Today loses the week / month / year switch and the 7-day gate; Analytics has its own empty and first-period states. Every tab screen keeps the same bottom clearance (`--tab-clearance`) so the Add button never covers the last row.
**Revisit when.** Analytics is opened less than weekly, or a fifth tab is proposed.
