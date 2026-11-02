import { describe, expect, test } from "vitest";
import { callsFor } from "../../src/lib/cloud/outbox";
import { categoryBudgetPatch, parsePct } from "../../src/lib/budget";
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
