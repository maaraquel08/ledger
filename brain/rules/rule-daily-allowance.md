---
type: rule
status: draft
updated: 2026-10-29
related: [features/home, features/budgets-and-goals, features/chat, features/insights, D-0006]
---

# Daily allowance (today's number)

**Rule.** *Today's number = (budget − spend before today) ÷ days left in the month (including today), minus what was spent today on day-to-day categories.* Rent & bills, Subscriptions, Groceries and Household spent today "come out of the pool from tomorrow". (`src/lib/today.ts:14-32`)
**Authority.** Code. Budget = `profile.monthlyBudget`, or 65.6% of monthly income rounded to ₱1,000 when none is set (`src/lib/selectors.ts:81-83`).
**First month.** When the ledger starts mid-month, the budget is prorated: budget × days left (from the ledger's first entry, or today) ÷ days in the month (`selectors.monthBudget`, mirrored in SQL `today_budget`, migration `20261029001700`).
**Enforced by.** System computation; no user override except editing the budget.
**On violation.** A negative number shows as "−₱X over today" in red and "Tomorrow drops to ₱Y to cover it."
**Design consequence.**
- The Home hero, The math, the chat header and the chat "daily math" answer all show `todayBudget()` with the same rows (D-0006). `verdict().perDay` is the **month pace** and appears only on the Budgets ring, labelled as pace.
- Fixed categories (Rent & bills, Subscriptions) are compared against their full cap, never paced.
- No budget → "₱—" and "no budget yet"; The math does not open.
