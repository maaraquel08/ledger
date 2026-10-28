---
type: index
status: draft
updated: 2026-10-19
related: [system-map, design/design-system]
---

# Screen inventory

Check before designing: does it exist already? How features connect lives in `system-map.md`. Routes from `src/App.tsx:37-50`; sheets from the `Sheet` primitive.

## Screens
| Screen | Route | Feature | Chrome | Status |
|---|---|---|---|---|
| Welcome | `/` | onboarding | none; looping tape | shipped |
| Onboarding step | `/onboarding/:step` (welcome, accounts, balances, income, ready) | onboarding | sticky footer CTA, Skip top-right | shipped |
| Home | `/home` | home | tab bar; no title, date eyebrow + avatar | shipped |
| Activity | `/activity` (+ `?q=&acct=&period=&cat=&sort=`) | activity | tab bar + FAB; PageTitle with Search / Sort | shipped |
| Entry detail | `/activity/:id` | activity | BackBar "Activity", Edit | shipped |
| Review | `/review` | review | BackBar; sticky "Accept suggestions" | shipped |
| Accounts | `/accounts` | accounts | tab bar; PageTitle with Add | shipped |
| Account detail | `/accounts/:id` | accounts | BackBar; Add entry here / Transfer / Edit | shipped |
| Insights | `/insights` | insights | tab bar; PageTitle with Budgets link; Segmented Weekly/Monthly/Yearly | shipped |
| Budgets | `/budgets` | budgets-and-goals | BackBar "Insights" | shipped |
| Chat | `/chat` (+ `?q=&via=`) | chat | sticky header + composer; no tab bar | shipped |
| Scan | `/scan` | receipt-scan | full-screen dark camera UI; no tab bar | shipped |

## Sheets (bottom drawers)
| Sheet | Opened from | Feature |
|---|---|---|
| Add entry (type / keypad) | Activity FAB, empty state, Account detail, Insights day sheet | add-entry |
| Profile (+ Erase all data) | Home avatar | home |
| The math | Home hero number | home |
| Add account · Edit account · Transfer | Accounts, Account detail | accounts |
| Edit entry · Edit split · Receipt photo | Entry detail | activity |
| Sort by · Filter | Activity header | activity |
| Day sheet | Insights weekly bar / monthly heatmap cell | insights |
| Adjust total budget · Category budget · Goal | Budgets | budgets-and-goals |
| Sources | Chat answer | chat |
| Paid with · Item category | Scan review | receipt-scan |
| Add account · Side income | Onboarding steps 1 and 3 | onboarding |

## In-place cards and states (not routes)
Home: ONE QUESTION card, receipt card with Undo, ALREADY LOGGED? duplicate card, offline banner, orb phases (idle, listening, cancelling, finishing, reading, error). Activity: review banner. Insights: 7-day gate. Scan: reading, unreadable, review.
