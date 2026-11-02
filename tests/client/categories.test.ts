import { describe, expect, test } from "vitest";
import {
  categoryNameError,
  DEFAULT_CATEGORIES,
  fixedCategories,
  incomeCategories,
  spendCategories,
  SYSTEM_CATEGORIES,
  userCategories,
} from "../../src/lib/categories";
import { callsFor } from "../../src/lib/cloud/outbox";
import { categoriesFor } from "../../src/lib/entry-rules";
import { EMPTY_STATE } from "../../src/lib/seed";
import { reducer } from "../../src/lib/store";
import type { Entry, LedgerState } from "../../src/lib/types";

const entry = (over: Partial<Entry>): Entry => ({ id: "e", desc: "x", accountId: null, category: "Gifts", amount: -100, date: "2026-11-02T10:00:00.000Z", ...over });

function ledger(): LedgerState {
  return {
    ...EMPTY_STATE,
    profile: { ...EMPTY_STATE.profile, categoryBudgets: { Gifts: 500, Health: 300 } },
    entries: [
      entry({ id: "1" }),
      entry({
        id: "2",
        category: "Groceries",
        amount: -300,
        split: [
          { category: "Groceries", amount: 200, items: ["rice"] },
          { category: "Gifts", amount: 100, items: ["card"] },
        ],
        receipt: {
          items: [
            { name: "rice", amount: 200, category: "Groceries" },
            { name: "card", amount: 100, category: "Gifts" },
          ],
        },
      }),
    ],
  };
}

describe("defaults", () => {
  test("absent categories = built-ins, Other last, no system names", () => {
    const s = ledger();
    expect(userCategories(s)).toBe(DEFAULT_CATEGORIES);
    expect(spendCategories(s)).toEqual(["Food & drink", "Groceries", "Transport", "Shopping", "Rent & bills", "Subscriptions", "Gifts", "Household", "Health", "Other"]);
    expect(incomeCategories(s)).toEqual(["Salary", "Income"]);
    expect(fixedCategories(s)).toEqual(["Rent & bills", "Subscriptions"]);
  });
  test("categoriesFor follows the list", () => {
    const s = reducer(ledger(), { type: "add-category", def: { name: "Pets", kind: "expense" } });
    expect(categoriesFor(-1, null, s)).toContain("Pets");
    expect(categoriesFor(1, null, s)).toEqual(["Salary", "Income"]);
    expect(categoriesFor(-1, "Transfer", s).at(-1)).toBe("Transfer");
  });
});

describe("categoryNameError", () => {
  const defs = DEFAULT_CATEGORIES;
  test("accepts a fresh name", () => expect(categoryNameError("Pets", defs)).toBeNull());
  test("empty, too long, duplicate, system", () => {
    expect(categoryNameError("  ", defs)).toMatch(/name/i);
    expect(categoryNameError("x".repeat(33), defs)).toMatch(/32/);
    expect(categoryNameError("x".repeat(32), defs)).toBeNull();
    expect(categoryNameError("groceries", defs)).toMatch(/already/i);
    for (const n of SYSTEM_CATEGORIES) expect(categoryNameError(n.toLowerCase(), defs)).toMatch(/app/i);
  });
  test("except lets a rename keep or recase its own name", () => {
    expect(categoryNameError("Gifts", defs, "Gifts")).toBeNull();
    expect(categoryNameError("gifts", defs, "Gifts")).toBeNull();
    expect(categoryNameError("Health", defs, "Gifts")).toMatch(/already/i);
  });
});

describe("reducer", () => {
  test("add", () => {
    const s = reducer(ledger(), { type: "add-category", def: { name: " Pets ", kind: "expense" } });
    expect(s.categories?.at(-1)).toEqual({ name: "Pets", kind: "expense" });
    expect(s.categories?.length).toBe(DEFAULT_CATEGORIES.length + 1);
    expect(spendCategories(s).slice(-2)).toEqual(["Pets", "Other"]);
    const inc = reducer(s, { type: "add-category", def: { name: "Bonus", kind: "income" } });
    expect(incomeCategories(inc)).toEqual(["Salary", "Income", "Bonus"]);
  });
  test("add refuses duplicates and system names", () => {
    const s = ledger();
    expect(reducer(s, { type: "add-category", def: { name: "gifts", kind: "expense" } })).toBe(s);
    expect(reducer(s, { type: "add-category", def: { name: "Transfer", kind: "income" } })).toBe(s);
  });
  test("rename moves entries, splits, receipt items and the budget", () => {
    const s = reducer(ledger(), { type: "rename-category", from: "Gifts", to: "Presents" });
    expect(spendCategories(s)).toContain("Presents");
    expect(spendCategories(s)).not.toContain("Gifts");
    expect(s.entries[0].category).toBe("Presents");
    expect(s.entries[1].split?.map((p) => p.category)).toEqual(["Groceries", "Presents"]);
    expect(s.entries[1].receipt?.items.map((i) => i.category)).toEqual(["Groceries", "Presents"]);
    expect(s.profile.categoryBudgets).toEqual({ Presents: 500, Health: 300 });
  });
  test("renaming a built-in keeps fixed/monthly nature", () => {
    const s = reducer(ledger(), { type: "rename-category", from: "Rent & bills", to: "Bills" });
    expect(fixedCategories(s)).toEqual(["Bills", "Subscriptions"]);
  });
  test("rename refuses system, unknown, clashing and same names", () => {
    const s = ledger();
    expect(reducer(s, { type: "rename-category", from: "Other", to: "Misc" })).toBe(s);
    expect(reducer(s, { type: "rename-category", from: "Transfer", to: "Misc" })).toBe(s);
    expect(reducer(s, { type: "rename-category", from: "Nope", to: "Misc" })).toBe(s);
    expect(reducer(s, { type: "rename-category", from: "Gifts", to: "Health" })).toBe(s);
    expect(reducer(s, { type: "rename-category", from: "Gifts", to: "Other" })).toBe(s);
    expect(reducer(s, { type: "rename-category", from: "Gifts", to: "Gifts" })).toBe(s);
  });
  test("delete moves everything to moveTo and drops the budget", () => {
    const s = reducer(ledger(), { type: "delete-category", name: "Gifts", moveTo: "Other" });
    expect(spendCategories(s)).not.toContain("Gifts");
    expect(s.entries[0].category).toBe("Other");
    expect(s.entries[1].split?.map((p) => p.category)).toEqual(["Groceries", "Other"]);
    expect(s.entries[1].receipt?.items[1].category).toBe("Other");
    expect(s.profile.categoryBudgets).toEqual({ Health: 300 });
  });
  test("delete into a category a split already has merges the lines", () => {
    const s = reducer(ledger(), { type: "delete-category", name: "Gifts", moveTo: "Groceries" });
    expect(s.entries[1].split).toEqual([{ category: "Groceries", amount: 300, items: ["rice", "card"] }]);
  });
  test("delete refuses system names, unknown targets and itself", () => {
    const s = ledger();
    expect(reducer(s, { type: "delete-category", name: "Other", moveTo: "Gifts" })).toBe(s);
    expect(reducer(s, { type: "delete-category", name: "Adjustment", moveTo: "Gifts" })).toBe(s);
    expect(reducer(s, { type: "delete-category", name: "Gifts", moveTo: "Nowhere" })).toBe(s);
    expect(reducer(s, { type: "delete-category", name: "Gifts", moveTo: "Gifts" })).toBe(s);
  });
});

describe("outbox mapping", () => {
  const s = ledger();
  test("add / rename / delete become their RPCs", () => {
    expect(callsFor({ type: "add-category", def: { name: "Pets", kind: "expense" } }, s)).toEqual([{ kind: "rpc", fn: "add_category", args: { p_name: "Pets", p_kind: "expense" } }]);
    expect(callsFor({ type: "rename-category", from: "Gifts", to: "Presents" }, s)).toEqual([{ kind: "rpc", fn: "rename_category", args: { p_from: "Gifts", p_to: "Presents" } }]);
    expect(callsFor({ type: "delete-category", name: "Gifts", moveTo: "Other" }, s)).toEqual([{ kind: "rpc", fn: "delete_category", args: { p_name: "Gifts", p_move_to: "Other" } }]);
  });
});
