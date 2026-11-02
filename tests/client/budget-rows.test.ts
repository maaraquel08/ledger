import { describe, expect, test } from "vitest";
import { allocation, budgetRows, categoryHistory, receivedBy } from "../../src/lib/budget";
import { spendCategories } from "../../src/lib/categories";
import { EMPTY_STATE } from "../../src/lib/seed";
import type { Entry, LedgerState } from "../../src/lib/types";

const d = (m: number, day: number) => new Date(2026, m, day, 12).toISOString();
const e = (id: string, category: string | null, amount: number, date: string, extra: Partial<Entry> = {}): Entry => ({ id, desc: id, accountId: "x", category, amount, date, ...extra });

const entries: Entry[] = [
  e("a", "Food & drink", -400, d(10, 2)),
  e("b", "Transport", -1200, d(10, 3)),
  e("c", "Groceries", -300, d(10, 4), { split: [{ category: "Groceries", amount: 200, items: [] }, { category: "Household", amount: 100, items: [] }] }),
  e("d", "Food & drink", -300, d(9, 5)),
  e("f", "Food & drink", -600, d(8, 5)),
  e("g", "Transfer", -999, d(10, 3)),
  e("h", "Salary", 30000, d(10, 1)),
];
const state: LedgerState = {
  ...EMPTY_STATE,
  entries,
  profile: { ...EMPTY_STATE.profile, monthlyBudget: 10000, categoryBudgets: { "Food & drink": 1000, Transport: 1000, "Rent & bills": 5000 } },
};
const now = new Date(2026, 10, 15, 9);
const rows = budgetRows(state, spendCategories(state), now, now);
const row = (c: string) => rows.find((r) => r.category === c)!;

describe("budget rows", () => {
  test("one row for every spending category, in the list's order", () => {
    expect(rows.map((r) => r.category)).toEqual(spendCategories(state));
  });
  test("under budget: left, ok, fraction", () => {
    expect(row("Food & drink")).toMatchObject({ spent: 400, budget: 1000, left: 600, status: "ok", fraction: 0.4, paced: true });
  });
  test("over budget: negative left, fraction capped at 1", () => {
    expect(row("Transport")).toMatchObject({ spent: 1200, left: -200, status: "over", fraction: 1 });
  });
  test("no budget: status none, spent still counted, splits count per part", () => {
    expect(row("Household")).toMatchObject({ spent: 100, budget: 0, status: "none" });
    expect(row("Groceries").spent).toBe(200);
  });
  test("transfers are not spend; fixed bills are not paced", () => {
    expect(rows.some((r) => r.category === "Transfer")).toBe(false);
    expect(row("Rent & bills")).toMatchObject({ paced: false, spent: 0, status: "ok" });
  });
  test("ahead of pace: spent above budget * share of month gone", () => {
    const early = new Date(2026, 10, 3, 9);
    expect(budgetRows(state, ["Food & drink"], early, early)[0].status).toBe("ahead");
  });
  test("a past month has no pace, so it is ok or over", () => {
    const oct = budgetRows(state, ["Food & drink"], new Date(2026, 9, 1), now)[0];
    expect(oct).toMatchObject({ spent: 300, status: "ok" });
  });
});

describe("allocation and history", () => {
  test("allocated vs monthly budget", () => {
    expect(allocation(state, spendCategories(state))).toEqual({ allocated: 7000, total: 10000, unallocated: 3000, over: 0 });
    const tight = { ...state, profile: { ...state.profile, monthlyBudget: 5000 } };
    expect(allocation(tight, spendCategories(tight))).toMatchObject({ unallocated: 0, over: 2000 });
  });
  test("this month, last month, average of the 3 months before", () => {
    expect(categoryHistory(entries, "Food & drink", now)).toEqual({ thisMonth: 400, lastMonth: 300, avg3: 300 });
  });
  test("received per income category", () => {
    expect(receivedBy(entries, now).get("Salary")).toBe(30000);
  });
});
