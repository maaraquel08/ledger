---
type: fact
status: draft
updated: 2026-10-29
related: [insights, home, chat, onboarding, activity, users, system-map, rules/rule-signed-money, rules/rule-daily-allowance, D-0013, D-0012, D-0006, D-0015]
---

# Budgets and goals

**Purpose.** Lets the Owner set a monthly budget, per-category caps and savings goals, and see their pace.

## Scope
- In: ring, `overPace` rule, total budget, category budgets (`BUDGET_CATS`), goals CRUD, confirm copy.
- Out: contributing to a goal; linking goals to accounts; rollover; clearing the total budget; editing category budgets from Home.

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | Ring, category pace, goals | Adjust total, add/edit/remove category budgets, create/edit/delete goals | Clear the total budget; contribute money to a goal |
| M8 | Budget and goals | Creates a goal on request via chat offer | Move money; edit budgets |

## Rules
- Route `/budgets` (`src/screens/insights.tsx:646-932`), reached only from the Insights "Budgets" link; back returns to `/insights`. Budget and Goal live in Profile (`profile.monthlyBudget`, `categoryBudgets`, `goals`).
- Budget = `profile.monthlyBudget`, or if 0 `suggestedBudget(monthlyIncome)` (round(monthly x 0.656 / 1000) x 1000) (`src/lib/selectors.ts:81-112`). Budget month = calendar month.
- Ring: fraction = spent / budget; label "LEFT TO SPEND" or "OVER BUDGET"; `₱left`; "of ₱budget · N days left"; if `overPace` "Spending ahead of pace" (red); else if left > 0 "₱perDay/day pace for the rest of the month" (`insights.tsx:678`). perDay = max(0, floor(left / daysLeft)), daysLeft includes today (`verdict`, `selectors.ts:94`). This is month pace, not today's number (D-0006).
- `overPace` (`insights.tsx:656`): `left < 0 || (spent - fixedSpent) > (budget - fixedSpent) x (dayOfMonth / daysInMonth)`. FIXED = Rent & bills, Subscriptions (compared to the full cap, not paced).
- "Adjust total budget" sheet: any number > 0; cannot be cleared.
- CATEGORY BUDGETS list `BUDGET_CATS`: Food & drink, Groceries, Transport, Shopping, Rent & bills, Subscriptions, Gifts, Health, Other (no Household). Rows show "spent / cap", red when over, a pace tick at today's fraction, "₱X over". Add picks from unused categories; edit; remove with confirm.
- Goals: name required, target > 0; `saved` starts 0, editable only when editing; `by` is a native `<input type="month">` (`insights.tsx:894-900`), stored as "YYYY-MM" or "" (shown "No date"); the goal list and delete confirm show `goalLabel(by)` ("Jan 2027" or "No date", `src/lib/format.ts:85`); % rounded. No contribute action, no link to accounts, never auto-updated.
- Home today's number, The math and chat's "daily math" use `todayBudget()` (`src/lib/today.ts`, D-0006); the ring uses `verdict()` and its per-day figure is labelled as pace.
- Chat goal pace reads `by` through `goalMonth()` and skips undated goals, saying so (`src/screens/chat.tsx:150-185`). Legacy "Jan 2027" values are migrated to "YYYY-MM" on load (`src/lib/persistence.ts:33-35`).

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Under pace | left > 0, not overPace | ring, "LEFT TO SPEND", "₱X/day pace for the rest of the month" | n/a |
| Ahead of pace | `overPace` | red "Spending ahead of pace" | Spend less / adjust |
| Over | left < 0 | "OVER BUDGET" | Adjust total |
| No category budgets | none | "No category budgets yet. Add one to see how you're pacing." | Add |
| Category over | spent > cap | red, "₱X over" | n/a |
| Remove category | confirm | "Remove the X budget? Your spending in this category stays in Activity." | Cancel |
| No goals | none | "No goals yet. Name something you're saving for." | New goal |
| Delete goal | confirm | "Delete ‘name’? This removes the goal and its ₱X of ₱Y progress. Your money stays in your accounts." | Cancel |
| Goal row | exists | "₱saved of ₱target · <Mon YYYY or No date>" and % | Edit |

## Flow
Insights -> "Budgets" -> ring -> "Adjust total budget" / category Add / goal New -> sheets -> save (`update-profile`). Chat offer "Set ₱X aside" also creates a goal.

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Budgets | `/budgets` | "Adjust total budget" | Screen, StatGrid, Sheet (category, total, goal), Pill, CategoryChip, Cta |

## Planned (approved 2026-10-29, not shipped)
- The Budgets screen folds into **Today** (D-0015); budgets and goals stay as they are (no rules engine beyond them).
- Cloud mode: budgets live in `profiles`, goals in `goals`; goal progress and pace come from SQL (`goal_progress`, `today_budget`, which mirrors `src/lib/today.ts`) (D-0013).

## Interactions
| | |
|---|---|
| Owns | Budget and Goal (in Profile) |
| Reads | entries (month spend), profile, `verdict`, `overPace` inputs |
| Writes | `update-profile` (monthlyBudget, categoryBudgets, goals) |
| Triggers | Back to `/insights` |
| Exposes | Budget to Home (today's number), The math (MONTH PACE), Activity detail Budget row, chat answers; goals to chat pace answers |
| Depends on | insights (route), onboarding (initial budget and goals), chat (offer goals), activity |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Total budget cleared | Not possible (> 0) | handled in code |
| No budget | Falls back to suggested budget | handled in code |
| Goal with no date | Listed as "No date"; chat pace skips it and says so | handled in code |
| Goal vs account money | Emergency fund goal 216,000 vs MariBank 62,000 unrelated | unhandled |
| Household budget | Not in `BUDGET_CATS` | handled in code |
| Seed budgets | Only Food & drink, Transport, Shopping, Rent & bills | handled in code |
| Goal `saved` | Manual edit only | handled in code |

## Open questions
- Should the total budget be clearable, and should there be a contribute action?
- Ring pace (`verdict().perDay`) and Home's number (`todayBudget`) still differ by design (D-0006); is the "pace" label enough?
