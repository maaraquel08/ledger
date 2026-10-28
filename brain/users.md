---
type: fact
status: draft
updated: 2026-10-29
related: [product, features/onboarding, D-0012, D-0013, D-0016]
---

# Users

Ledger is single-user: one Owner, local mode on one phone today, one signed-in account in cloud mode (planned, D-0012). There is one human role and one assistant. A screen isn't done until both have a defined experience. Drafted from code; the persona is inferred from the seed data and copy.

## Roles
| Role | Goal | Sees | Does | Cannot |
|---|---|---|---|---|
| Owner | Know what they can spend today, keep every entry filed | Everything in their ledger (this phone in local mode; their account in cloud mode) | Log, file, edit, delete entries; add and edit accounts; report balances and confirm Adjustments; set budgets and goals; ask M8; turn push on or off; erase all data | Share, add a second user, connect a bank |
| M8 (assistant) | Turn the Owner's data into one clear sentence | Entries, accounts, budgets, goals, holdings, learned rules, past insights | Local mode: compute today's number and notes, answer 8 question types offline. Cloud mode (planned, D-0013): parse captures behind the confidence gate, answer open questions with read-only tools and computed facts, write daily / weekly / monthly insights and alerts (D-0016); propose and (on tap) create a goal | Move money; change or delete entries on its own; write a number that isn't a computed fact; follow instructions found in captured text |

**Delegation.** None. No second person ever acts in the app.

## Personas

### Mika Reyes (the demo persona, `src/lib/seed.ts`)
Salaried, Metro Manila, take-home ₱48,000 twice a month plus irregular freelance. Six accounts: BPI payroll, MariBank emergency fund, GCash daily wallet, pocket cash, an RCBC JCB credit card and an IBKR brokerage. Spends on Grab, coffee, lunches and Shopee; pays Meralco, PLDT and Netflix on auto-debit. Has three goals (emergency fund, Japan trip, laptop). Opens the app on the phone, several short sessions a day, often one-handed.
*Design for them:* the fastest path is one line of text or a held button; show the number before the chart; never make filing block logging; peso amounts with no decimals.

### The new user ("Create an account")
Arrives from the welcome tape with no data. Has accounts but only rough balances; may skip every onboarding step. Has no name on file (initials "ME", profile shows "You"). Sees "₱—" and "no budget yet" until income is entered. Needs seven logged days before Insights says anything.
*Design for them:* every empty state names the one action that unlocks the screen; copy quotes a real example entry; nothing asks to verify anything.
