import { beforeAll, describe, expect, test } from "vitest";
import type { Account, Entry, LedgerState } from "../../src/lib/types";
import { EMPTY_STATE } from "../../src/lib/seed";
import { createDb, num, U1, U2, type Db } from "./harness";

// the chat tools' SQL (migration 20261029001900): top_entries, budget_status, entries_matching(category)
let db: Db;
const at = (month: number, d: number, h = 12) => new Date(2026, month, d, h).toISOString();
const e = (id: string, desc: string, category: Entry["category"], amount: number, date: string): Entry =>
  ({ id, desc, accountId: "a1", category, amount, date });
const acct: Account = { id: "a1", name: "Payroll", provider: "bpi", providerLabel: "BPI", type: "bank", kind: "SAVINGS", balance: 100_000 };

const STATE: LedgerState = {
  ...EMPTY_STATE,
  onboarded: true,
  accounts: [acct],
  entries: [
    e("p1", "Payroll", "Salary", 40_000, at(7, 5)), // Aug
    e("p2", "Payroll", "Salary", 40_000, at(8, 5)), // Sep
    e("p3", "Payroll", "Salary", 40_000, at(9, 5)), // Oct
    e("a", "Rent", "Rent & bills", -15_000, at(7, 3)),
    e("b", "Dinner", "Food & drink", -5_000, at(8, 10)),
    e("c", "Rent", "Rent & bills", -15_000, at(8, 3)),
    e("d", "Laptop bag", "Shopping", -3_000, at(9, 2)),
    e("f", "Jollibee", "Food & drink", -400, at(9, 8)),
    e("g", "Starbucks", "Food & drink", -300, at(9, 9)),
    e("h", "Rent", "Rent & bills", -15_000, at(9, 3)),
  ],
  profile: { ...EMPTY_STATE.profile, income: 40_000, frequency: "Monthly", monthlyBudget: 30_000, categoryBudgets: { "Food & drink": 2_000, Shopping: 5_000 } },
};
const NOW = new Date(2026, 9, 20, 12).toISOString();
const OCT: [string, string] = [new Date(2026, 9, 1).toISOString(), new Date(2026, 10, 1).toISOString()];

beforeAll(async () => {
  db = await createDb();
  await db.as(U1);
  await db.one("select public.import_state($1::jsonb)", [JSON.stringify(STATE)]);
  await db.query("update public.profiles set timezone = $1", [Intl.DateTimeFormat().resolvedOptions().timeZone]);
}, 60_000);

describe("top_entries", () => {
  test("largest expenses first, with account name; limit and category filters", async () => {
    await db.as(U1);
    const r = await db.one("select public.top_entries($1, $2, 'spend', null, 2)", OCT);
    expect(r.kind).toBe("spend");
    expect(r.entries.map((x: any) => [x.description, num(x.amount)])).toEqual([["Rent", -15_000], ["Laptop bag", -3_000]]);
    expect(r.entries[0].account_name).toBe("Payroll");

    const food = await db.one("select public.top_entries($1, $2, 'spend', 'food & DRINK', 20)", OCT);
    expect(food.entries.map((x: any) => x.description)).toEqual(["Jollibee", "Starbucks"]);

    const inc = await db.one("select public.top_entries($1, $2, 'income', null, 5)", OCT);
    expect(inc.entries.map((x: any) => x.description)).toEqual(["Payroll"]);
  });

  test("limit is clamped to 1..20 and RLS hides other users' entries", async () => {
    await db.as(U1);
    expect((await db.one("select public.top_entries($1, $2, 'spend', null, 0)", OCT)).entries).toHaveLength(1);
    await db.as(U2);
    expect((await db.one("select public.top_entries($1, $2, 'spend', null, 5)", OCT)).entries).toEqual([]);
  });
});

describe("entries_matching with a category", () => {
  test("filters by category, behaves as before without it", async () => {
    await db.as(U1);
    const both = await db.one("select public.entries_matching('rent')");
    expect(num(both.count.value)).toBe(3);
    const none = await db.one("select public.entries_matching('rent', null, null, 10, null, 'Food & drink')");
    expect(num(none.count.value)).toBe(0);
    const food = await db.one("select public.entries_matching('jollibee', null, null, 10, null, 'food & drink')");
    expect(num(food.count.value)).toBe(1);
  });
});

describe("budget_status", () => {
  test("category budget vs actual and the savings rate of the last three full months", async () => {
    await db.as(U1);
    const r = await db.one("select public.budget_status($1)", [NOW]);
    expect(r.month).toBe("October");
    expect(r.has_budget).toBe(true);
    expect(num(r.spent.value)).toBe(18_700);
    const food = r.categories.find((c: any) => c.category_code === "Food & drink");
    expect(num(food.budget)).toBe(2_000);
    expect(num(food.spent.value)).toBe(700);
    expect(num(food.left)).toBe(1_300);
    const rent = r.categories.find((c: any) => c.category_code === "Rent & bills");
    expect(rent.budget).toBeNull();
    expect(r.savings.map((s: any) => s.month)).toEqual(["September", "August", "July"]);
    expect(num(r.savings[0].savings_rate.value)).toBe(50); // (40,000 - 20,000) / 40,000
    expect(num(r.savings[1].savings_rate.value)).toBe(63); // (40,000 - 15,000) / 40,000
    expect(r.savings[2].savings_rate.value).toBeNull(); // no income in July
  });

  test("another user sees nothing of this ledger", async () => {
    await db.as(U2);
    const r = await db.one("select public.budget_status($1)", [NOW]);
    expect(num(r.spent.value)).toBe(0);
    expect(r.categories).toEqual([]);
  });
});
