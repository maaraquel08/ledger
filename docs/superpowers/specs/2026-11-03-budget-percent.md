# Spec: Percentage category budgets + bottom CTA

Status: approved 2026-11-03 (Owner: a % stays a %; % of the monthly budget).

## Objective
Budgeting is easier when a category can be "20% of my budget" instead of a hard peso amount.
- In a category's sheet (and New category) the budget is entered as **₱ or %** (a switch).
- A % budget is stored as a percentage of the **monthly budget** and re-sizes when the monthly budget changes (Adjust), or, with no budget set, when the suggested budget changes.
- Rows show both: "20% · ₱12,600". The allocation line shows the % allocated.
- "+ New category" becomes a full-width button at the bottom of the Budget tab; the floating yellow + is hidden on Budget (it stays on Money and Analytics).

## Design
- `profile.categoryBudgetPct?: Partial<Record<Category, number>>` (0 < pct ≤ 100, up to 1 decimal).
- `profile.categoryBudgets` keeps the **resolved pesos** for every budgeted category, so every existing reader (Budget rows, Show the math, Analytics, chat, the server's `budget_status`) keeps working unchanged.
- The reducer re-resolves % budgets on any `update-profile` that touches `monthlyBudget`, `income`, `frequency` or `categoryBudgetPct`; rename/delete-category carry or drop the pct key too.
- Base = `profile.monthlyBudget` if > 0, else the suggested budget (`suggestedBudget`).
- Cloud: new column `profiles.category_budget_pct jsonb default '{}'` (migration `20261103000300_category_budget_pct.sql`), mapped in `cloud/map.ts`; `rename_category`/`delete_category` move/drop its key.

## Commands / Structure / Testing
Same as `2026-11-03-budget-tab.md`. Tests: resolve (pct of budget, of suggested, rounding), re-resolve on budget change, switching ₱↔%, rename/delete carry the pct key; pglite: rename/delete move the pct key.

## Boundaries
- Always: new numbered migration; tests/types/build green.
- Never: change how existing ₱ budgets behave.

## Success Criteria
1. Set Food to 20% with a ₱63,000 budget → row reads "20% · ₱12,600"; Adjust budget to ₱70,000 → "20% · ₱14,000".
2. Switching a category back to ₱ keeps the current peso amount as its fixed budget.
3. Allocation shows ₱ and % allocated.
4. Budget tab has a bottom "+ New category" button and no floating +.
5. All checks pass.
