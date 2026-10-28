---
type: decision
area: design
status: superseded
updated: 2026-10-29
related: [features/home, features/accounts, features/activity, features/review, features/insights, features/budgets-and-goals, features/chat, features/receipt-scan, features/add-entry, system-map, design/screens]
supersedes: []
superseded_by: D-0017
---

# D-0015 Three tabs: Today, Money, Review

> Superseded 2026-10-29 by D-0017 (four tabs: Today, Money, Analytics, Review).

**Context.** Four tabs (Home, Activity, Accounts, Insights) plus Budgets, Scan and Chat off to the side split the Owner's money across too many places; the CFO direction wants a quick glance, plain analysis and one consolidated view (spec 2026-10-29). Decided by the Owner on 2026-10-29 ("yes" to the three-tab layout).

**Decision.** The tab bar has three tabs:
- **Today**: M8's sentence and today's key number, a week / month / year switch with analysis cards; chat opens from here. Insights and Budgets fold into Today.
- **Money**: accounts and net worth on top, the full typed ledger below with type filters (income, expense, transfer, invest, refund). Account detail is the ledger filtered to that account. Replaces Accounts and Activity.
- **Review**: entries waiting for the Owner (missing fields, gate questions).

Add stays global on every tab. Scan is a capture mode of Add, not a screen of its own.

| Option | Outcome |
|---|---|
| Today / Money / Review (chosen) | Glance, record, act; fewer places to look |
| Keep four tabs | Insights and Budgets stay far from today's number |

**Consequences.** Planned: `/insights`, `/budgets`, `/activity`, `/accounts` and `/scan` fold into the new tabs; feature files keep their slugs until the code ships. Review gets a tab instead of the Activity banner.
**Revisit when.** The Owner keeps opening a folded surface from deep links instead of its tab.
