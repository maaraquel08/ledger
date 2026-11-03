import { describe, expect, test } from "vitest";
import { callsFor } from "../../src/lib/cloud/outbox";
import { budgetRows, categoryBudgetPatch, parsePct, planParts } from "../../src/lib/budget";
import { spendCategories } from "../../src/lib/categories";
import { resolveProfilePatch } from "../../src/lib/selectors";
import { reducer } from "../../src/lib/store";
import { EMPTY_STATE } from "../../src/lib/seed";
import type { LedgerState } from "../../src/lib/types";

const base: LedgerState = {
  ...EMPTY_STATE,
  onboarded: true,
  profile: { ...EMPTY_STATE.profile, income: 50_000, frequency: "Monthly", monthlyBudget: 63_000, categoryBudgets: { Transport: 5_000 } },
};
const set = (s: LedgerState, patch: Parameters<typeof resolveProfilePatch>[1]) => reducer(s, { type: "update-profile", patch });

describe("% category budgets", () => {
  test("a % budget resolves to pesos of the monthly budget", () => {
    const s = set(base, categoryBudgetPatch(base.profile, "Food & drink", { kind: "pct", value: 20 }));
    expect(s.profile.categoryBudgetPct).toEqual({ "Food & drink": 20 });
    expect(s.profile.categoryBudgets).toEqual({ Transport: 5_000, "Food & drink": 12_600 });
  });

  test("it re-sizes when the monthly budget changes; fixed amounts don't", () => {
    let s = set(base, categoryBudgetPatch(base.profile, "Food & drink", { kind: "pct", value: 20 }));
    s = set(s, { monthlyBudget: 70_000 });
    expect(s.profile.categoryBudgets).toEqual({ Transport: 5_000, "Food & drink": 14_000 });
  });

  test("with no budget set, a % is of the suggested budget", () => {
    const noBudget = { ...base, profile: { ...base.profile, monthlyBudget: 0 } };
    const s = set(noBudget, categoryBudgetPatch(noBudget.profile, "Shopping", { kind: "pct", value: 10 }));
    expect(s.profile.categoryBudgets.Shopping).toBe(3_300); // 10% of 33,000 (two thirds of 50k, to the thousand)
  });

  test("switching back to ₱ keeps the amount as a fixed budget; 0 clears", () => {
    let s = set(base, categoryBudgetPatch(base.profile, "Food & drink", { kind: "pct", value: 20 }));
    s = set(s, categoryBudgetPatch(s.profile, "Food & drink", { kind: "amount", value: 12_600 }));
    expect(s.profile.categoryBudgetPct).toEqual({});
    s = set(s, { monthlyBudget: 70_000 });
    expect(s.profile.categoryBudgets["Food & drink"]).toBe(12_600);
    s = set(s, categoryBudgetPatch(s.profile, "Food & drink", { kind: "amount", value: 0 }));
    expect("Food & drink" in s.profile.categoryBudgets).toBe(false);
  });

  test("rename and delete carry or drop the % key", () => {
    let s = set(base, categoryBudgetPatch(base.profile, "Gifts", { kind: "pct", value: 5 }));
    s = reducer(s, { type: "rename-category", from: "Gifts", to: "Presents" });
    expect(s.profile.categoryBudgetPct).toEqual({ Presents: 5 });
    s = reducer(s, { type: "delete-category", name: "Presents", moveTo: "Other" });
    expect(s.profile.categoryBudgetPct).toEqual({});
  });

  test("the outbox sends the resolved pesos with a budget change", () => {
    const s = set(base, categoryBudgetPatch(base.profile, "Food & drink", { kind: "pct", value: 20 }));
    const calls = callsFor({ type: "update-profile", patch: { monthlyBudget: 70_000 } }, s);
    expect(calls?.[0]).toMatchObject({ table: "profiles", rows: { monthly_budget: 70_000, category_budgets: { Transport: 5_000, "Food & drink": 14_000 } } });
  });

  test("parsePct", () => {
    expect([parsePct("20"), parsePct("12.5"), parsePct("100"), parsePct("0"), parsePct("101"), parsePct("1.25"), parsePct("")]).toEqual([20, 12.5, 100, null, null, null, null]);
  });
});

describe("plan bar and progress bars follow % and fixed budgets", () => {
  // the Owner's screenshot: ₱68,000 a month; Food 20%, Shopping 5%, Coffee 2%, Eat Out 5%, Subscriptions ₱500, Household ₱25,000
  const owner = (() => {
    let s: LedgerState = { ...base, profile: { ...base.profile, monthlyBudget: 68_000, categoryBudgets: {} } };
    s = reducer(s, { type: "add-category", def: { name: "Coffee", kind: "expense" } });
    s = reducer(s, { type: "add-category", def: { name: "Eat Out", kind: "expense" } });
    for (const [c, b] of [["Food & drink", { kind: "pct", value: 20 }], ["Shopping", { kind: "pct", value: 5 }], ["Coffee", { kind: "pct", value: 2 }], ["Eat Out", { kind: "pct", value: 5 }], ["Subscriptions", { kind: "amount", value: 500 }], ["Household", { kind: "amount", value: 25_000 }]] as const)
      s = set(s, categoryBudgetPatch(s.profile, c, b));
    const now = new Date(2026, 10, 3, 12);
    s = { ...s, entries: [
      { id: "a", desc: "lunch", accountId: null, category: "Food & drink", amount: -288, date: now.toISOString() },
      { id: "b", desc: "book", accountId: null, category: "Shopping", amount: -385, date: now.toISOString() },
      { id: "c", desc: "internet", accountId: null, category: "Household", amount: -1_598, date: now.toISOString() },
    ] };
    return { s, now };
  })();

  test("% budgets resolve against ₱68,000 and the plan adds up", () => {
    const { s } = owner;
    expect(s.profile.categoryBudgets).toMatchObject({ "Food & drink": 13_600, Shopping: 3_400, Coffee: 1_360, "Eat Out": 3_400, Subscriptions: 500, Household: 25_000 });
    const plan = planParts(s, spendCategories(s));
    expect(plan.total).toBe(68_000);
    expect(plan.parts.map((p) => p.category)).toEqual(["Household", "Food & drink", "Shopping", "Eat Out", "Coffee", "Subscriptions", "Unallocated"]);
    expect(plan.parts.find((p) => p.category === "Unallocated")?.amount).toBe(20_740);
    expect(Math.round(plan.parts.reduce((n, p) => n + p.pct, 0))).toBe(100);
    expect(plan.parts.find((p) => p.category === "Food & drink")).toMatchObject({ byPct: true, pct: 20 });
    expect(plan.parts.find((p) => p.category === "Household")).toMatchObject({ byPct: false });
  });

  test("progress bars use the resolved budget, % or fixed", () => {
    const { s, now } = owner;
    const rows = Object.fromEntries(budgetRows(s, spendCategories(s), now, now).map((r) => [r.category, r]));
    expect(rows["Food & drink"]).toMatchObject({ budget: 13_600, left: 13_312 });
    expect(rows["Food & drink"].fraction).toBeCloseTo(288 / 13_600);
    expect(rows.Shopping).toMatchObject({ budget: 3_400, left: 3_015 });
    expect(rows.Household.fraction).toBeCloseTo(1_598 / 25_000);
    // re-sizing the month moves the % bars, not the fixed ones
    const bigger = set(s, { monthlyBudget: 80_000 });
    const r2 = Object.fromEntries(budgetRows(bigger, spendCategories(bigger), now, now).map((r) => [r.category, r]));
    expect(r2["Food & drink"].budget).toBe(16_000);
    expect(r2.Household.budget).toBe(25_000);
  });

  test("an over-planned month scales the bar to what's allocated", () => {
    const s = set(base, { monthlyBudget: 10_000, categoryBudgets: { Shopping: 8_000, Transport: 4_000 } });
    const plan = planParts(s, spendCategories(s));
    expect(plan.over).toBe(2_000);
    expect(plan.parts.some((p) => p.category === "Unallocated")).toBe(false);
    expect(Math.round(plan.parts.reduce((n, p) => n + p.pct, 0))).toBe(100);
  });
});
