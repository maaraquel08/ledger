-- Category budgets as a share of the monthly budget (spec 2026-11-03-budget-percent).
-- { "<category code>": percent }. category_budgets keeps the resolved pesos, so every reader
-- (budget_status, metrics, the app) works unchanged; the client re-resolves and writes both.
alter table public.profiles add column if not exists category_budget_pct jsonb not null default '{}';
