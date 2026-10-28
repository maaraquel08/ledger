---
type: fact
status: draft
updated: 2026-10-29
related: [home, accounts, budgets-and-goals, insights, users, system-map, D-0012, rules/rule-daily-allowance, D-0014]
---

# Onboarding

**Purpose.** Lets the Owner either load a ready-made demo persona ("Sign in") or set up their own accounts, balances and income in about a minute ("Create an account"). In local mode there are no credentials and nothing leaves the phone; cloud mode adds a real sign-in (planned, D-0012).

## Scope
- In: Welcome screen, "Sign in" (demo loader), 3 setup steps + Ready, draft in sessionStorage, Skip on every step, suggested budget.
- Out: real authentication, email/password, name capture, verification, cloud accounts. None exist (`src/screens/onboarding.tsx:215` "No bank logins, no forms, nothing to verify.").

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | Welcome, onboarding steps (public routes) | Sign in as demo, create own setup, skip any step | Enter a name; sign in with credentials; sync across devices |
| M8 | The "From what you told me" card on Ready (rules, not a model) | Suggests a monthly budget | Set the budget itself or move money |

## Rules
- Public routes: `/` and anything starting `/onboarding`. Not onboarded + non-public path: replace to `/`. Onboarded + `/` or anything starting `/onboarding`: replace to `/home` (`src/App.tsx:29-33`).
- "Sign in" has no form. It dispatches `load-demo`, which replaces ALL state with `buildDemo()` (persona Mika Reyes, MR, `onboarded:true, demo:true`) and goes to `/home` (`src/screens/welcome.tsx:74-81`, `src/lib/store.tsx:29-30`). No confirmation before replacing local state.
- "Create an account" goes to `/onboarding/welcome` (`welcome.tsx:84`). Result: `onboarded:true, demo:false`, the Owner's own accounts, empty entries.
- Draft is a module-level store mirrored to sessionStorage `ledger:onboarding`; survives remounts and refresh in the same tab; cleared on finish (`onboarding.tsx:12-67`).
- Monthly income for the plan: Twice a month x2, Weekly x4.33, Monthly/Irregular x1; side income not included (`onboarding.tsx:510-512`).
- Suggested budget = round(monthly x 0.656 / 1000) x 1000, i.e. 65.6% (`src/lib/selectors.ts:81-83`). Example: 96,000 -> 63,000.
- `complete-onboarding` is a no-op when `state.onboarded` is already true (`src/lib/store.tsx:46-49`), so browser back into `/onboarding` cannot replace a live ledger.
- Finish dispatches `complete-onboarding`: profile `{name:"", initials:"ME", income, frequency, sideIncome, monthlyBudget: suggestedBudget, categoryBudgets:{}, goals}`; goals get `saved:0`, `by:"<year+1>-12"` (`onboarding.tsx:520-527`). Entries are not cleared.
- Account created in step 1 starts at balance 0; credit balance means amount owed.

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Welcome | `/` signed out | "Type it like you'd say it." / "“grab gcash 248” is a whole entry. Ledger files the rest."; looping tape of 32 fake entries; "Sign in", "New here? Create an account" | Either button |
| Intro | `/onboarding/welcome` (or any unknown step) | "One place for everything you earn, spend and invest." / "Three steps to set up. No bank logins, no forms, nothing to verify."; "About a minute"; CTA "Start" | Start |
| Step 1 | `/onboarding/accounts` | "STEP 1 OF 3" "Add the accounts you actually use." grid "COMMON IN PH"; after first add "Your accounts." "YOURS · N" | Continue (needs >= 1 account) or Skip |
| Step 2 | `/onboarding/balances` | "STEP 2 OF 3" "How much is in each?" / "Skip any you don't know."; "N of M filled in"; "Assets ₱X · card owed ₱Y"; credit label "<LABEL> · OWED" | Continue (always enabled) |
| Step 2 empty | no accounts | "No accounts yet. You can add them from Accounts later." | Continue |
| Step 3 | `/onboarding/income` | "STEP 3 OF 3" "What lands in your account on payday?" / "Take-home, after deductions."; pills Twice a month (default), Monthly, Weekly, Irregular; "SIDE INCOME? · OPTIONAL" | "Done" |
| Ready, income | monthly > 0 | "Set up. Here's your starting plan." AI card "On ₱M a month I'd hold spending near ₱B, leaving ₱S, about N%, to save. Change any of it later." | "Go to Home" |
| Ready, no income | monthly = 0 | "Add what you earn and I'll suggest a monthly budget. You can set one anytime from Insights › Budgets." (`onboarding.tsx:567`) | "Go to Home" |

## Flow
Welcome -> (Sign in -> `/home`) or (Create -> Intro -> accounts -> balances -> income -> ready -> `/home` replace). Skip (top right) on steps 1-3 jumps to the next step (`onboarding.tsx:245, 340, 444`).

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Welcome | `/` | "Sign in" | Screen, Cta |
| Intro | `/onboarding/welcome` | "Start" | Screen, Cta |
| Accounts | `/onboarding/accounts` | Add account (sheet "Add GCash") | Screen, Sheet, Cta, Pill |
| Balances | `/onboarding/balances` | Continue | Screen, Cta |
| Income | `/onboarding/income` | "Done" | Screen, Sheet (side income), Pill, Cta |
| Ready | `/onboarding/ready` | "Go to Home" | Screen, AiCard, StatGrid (ASSETS, BUDGET, ACCOUNTS), Cta |

## Planned (approved 2026-10-29, not shipped)
- Cloud mode (D-0012): "Sign in" is a real email magic-link sign-in for one Owner; the demo persona stays local-only. A one-time `import_state` moves an existing local ledger to the server.
- Balances entered in step 2 become each account's opening balance (D-0014).

## Interactions
| | |
|---|---|
| Owns | Onboarding draft (sessionStorage `ledger:onboarding`) |
| Reads | `PROVIDERS` list; `suggestedBudget`, `monthlyIncome` selectors |
| Writes | `load-demo`; `complete-onboarding {accounts, profile}`; creates Accounts and Goals ("Emergency fund" = 3 x budget, "A trip · Japan" ₱150,000, both optional) |
| Triggers | Navigation to `/home` (replace) |
| Exposes | `onboarded` flag consumed by route guards and TabBar; `monthlyBudget` consumed by home, insights, chat |
| Depends on | accounts (provider/type vocab), budgets-and-goals (where budget is edited), `src/lib/seed.ts` |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Skip every step | Finish with 0 accounts, 0 income: Home shows "₱—" / "no budget yet" | handled in code |
| Blank balance | Treated as 0 | handled in code |
| Side income | Label required, amount > 0, frequency forced "Irregular", "Irregular · not budgeted"; not in plan | handled in code |
| Emergency fund goal | Offered only if budget > 0 | handled in code |
| Onboarded user opens `#/onboarding/...` or `#/` | Redirected to `/home`; finishing again would be ignored | handled in code |
| Sign in over existing local data | Replaced without confirmation | unhandled |
| Name never collected | Profile sheet shows "You", avatar "ME" | unhandled (no UI to edit) |
| Welcome tape | 32 hard-coded fake entries; amounts differ from demo seed (e.g. payroll +₱52,000 vs 48,000) | unhandled |
| Draft after Erase all | sessionStorage draft not cleared by `reset` | unhandled |

## Open questions
- "Create an account" and "Sign in" imply cloud accounts. D-0012 makes them real in cloud mode; in local mode they still load the demo or set up this phone. Copy for local mode still open.
- Demo seed `suggestedBudget(96000)` = 63,000 matches rule; confirm 65.6% is a product decision, not just a constant.
