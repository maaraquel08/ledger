import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test } from "vitest";
import { createDb, U1, U2, type Db } from "./harness";

let db: Db;
const j = (v: unknown) => JSON.stringify(v);
const codes = (r: any) => r.categories.map((c: any) => c.code);
const add = (n: string, k = "expense") => db.one("select public.add_category($1, $2)", [n, k]);
const rename = (a: string, b: string) => db.one("select public.rename_category($1, $2)", [a, b]);
const del = (a: string, b: string) => db.one("select public.delete_category($1, $2)", [a, b]);
const list = () => db.rows("select code, kind, sort from public.user_categories where user_id = auth.uid() order by sort");

const EXPENSES = ["Food & drink", "Groceries", "Transport", "Shopping", "Rent & bills", "Subscriptions", "Gifts", "Household", "Health", "Other"];

const bank: Record<string, string> = {};
async function post(uid: string, category: string, amount = -100, extra: object = {}) {
  await db.as(uid);
  const id = randomUUID();
  await db.one("select public.post_entries($1::jsonb)", [j({ id, account_id: bank[uid], category_code: category, amount, ...extra })]);
  return id;
}
const entryCat = async (id: string) => (await db.asAdmin(), (await db.rows("select category_code from public.entries where id = $1", [id]))[0].category_code);

// a fresh database per test keeps the cases independent
beforeEach(async () => {
  db = await createDb();
  await db.as(U1);
  bank[U1] = (await db.one("select public.upsert_account($1::jsonb)", [j({ name: "Bank", type: "bank", opening_balance: 1000 })])).id;
  await db.as(U2);
  bank[U2] = (await db.one("select public.upsert_account($1::jsonb)", [j({ id: randomUUID(), name: "Bank2", type: "bank", opening_balance: 1000 })])).id;
}, 60000);

describe("user_categories", () => {
  test("no rows until the first write; then the defaults are materialised in order", async () => {
    await db.as(U1);
    expect(await list()).toEqual([]);
    const r = await add("Pets");
    expect(codes(r)).toEqual([...EXPENSES, "Salary", "Income", "Pets"]);
    expect(r.categories.at(-1)).toEqual({ code: "Pets", kind: "expense" });
    expect(r.categories.filter((c: any) => c.kind === "income").map((c: any) => c.code)).toEqual(["Salary", "Income"]);
    // the global row exists with the right flags
    await db.asAdmin();
    expect((await db.rows("select kind, is_spend, is_fixed, is_monthly, sort from public.categories where code = 'Pets'"))[0])
      .toEqual({ kind: "expense", is_spend: true, is_fixed: false, is_monthly: false, sort: 100 });
  });

  test("add trims, supports income, and appends", async () => {
    await db.as(U1);
    const r = await add("  Freelance  ", "income");
    expect(r.categories.at(-1)).toEqual({ code: "Freelance", kind: "income" });
    await db.asAdmin();
    expect((await db.rows("select is_spend from public.categories where code = 'Freelance'"))[0].is_spend).toBe(false);
  });

  test("names are validated", async () => {
    await db.as(U1);
    await expect(add("   ")).rejects.toThrow(/category_name_invalid/);
    await expect(add("x".repeat(33))).rejects.toThrow(/category_name_invalid/);
    await expect(add("Pets", "transfer")).rejects.toThrow(/category_kind_invalid/);
    for (const n of ["Transfer", "investments", "ADJUSTMENT", "other"]) await expect(add(n)).rejects.toThrow(/category_system/);
    await add("Pets");
    await expect(add("pets")).rejects.toThrow(/category_exists/);
    await expect(add("groceries")).rejects.toThrow(/category_exists/);
  });

  test("a name that exists globally with another kind is refused", async () => {
    await db.as(U1);
    await add("Bonus", "income");
    await db.as(U2);
    await expect(add("Bonus", "expense")).rejects.toThrow(/category_kind_clash/);
    expect(await list()).toEqual([]); // nothing half-written
    // the same kind is fine: the global row is shared
    expect(codes(await add("Bonus", "income"))).toContain("Bonus");
    // re-adding a built-in as the wrong kind clashes too
    await expect(add("Salary", "expense")).rejects.toThrow(/category_exists|category_kind_clash/);
  });

  test("rename moves the caller's entries, splits, receipt items, rules, recurring, budget; keeps sort", async () => {
    await db.as(U1);
    const e = await post(U1, "Groceries", -300, {
      splits: [{ category_code: "Groceries", amount: 300, items: ["rice"] }],
      receipt_items: [{ name: "rice", amount: 300, category_code: "Groceries" }],
    });
    await db.query(`insert into public.rules (match, "set") values ('{"merchant":"landers"}', '{"category_code":"Groceries","account_id":"x"}')`);
    await db.query("insert into public.recurring_items (description, category_code, amount, cadence, day_of_month) values ('Rice sub', 'Groceries', -100, 'monthly', 5)");
    await db.query(`insert into public.profiles (name, category_budgets) values ('Me', '{"Groceries": 5000, "Gifts": 100}')`);
    const before = (await list()).length;
    const r = await rename("Groceries", "Food at home");
    expect(codes(r)).toEqual(["Food & drink", "Food at home", ...EXPENSES.slice(2), "Salary", "Income"]);
    expect((await list()).length).toBe(before === 0 ? 12 : before);
    expect(await entryCat(e)).toBe("Food at home");
    await db.asAdmin();
    expect((await db.rows("select category_code from public.entry_splits"))[0].category_code).toBe("Food at home");
    expect((await db.rows("select category_code from public.receipt_items"))[0].category_code).toBe("Food at home");
    expect((await db.rows("select category_code from public.recurring_items"))[0].category_code).toBe("Food at home");
    const rule = (await db.rows(`select "set" from public.rules`))[0].set;
    expect(rule).toEqual({ category_code: "Food at home", account_id: "x" });
    expect((await db.rows("select category_budgets from public.profiles"))[0].category_budgets).toEqual({ "Food at home": 5000, Gifts: 100 });
    // the global Groceries row is untouched
    expect(await db.rows("select code from public.categories where code in ('Groceries', 'Food at home') order by code")).toHaveLength(2);
  });

  test("rename moves only the caller's rows, even when both users use the same category", async () => {
    const e1 = await post(U1, "Groceries");
    const e2 = await post(U2, "Groceries");
    await db.as(U1);
    await rename("Groceries", "Food at home");
    expect(await entryCat(e1)).toBe("Food at home");
    expect(await entryCat(e2)).toBe("Groceries");
    await db.as(U2);
    expect(await list()).toEqual([]); // U2's list is untouched (still defaults)
    // U2 can independently rename to the same new name (the global row is shared)
    expect(codes(await rename("Groceries", "Food at home"))).toContain("Food at home");
    expect(await entryCat(e2)).toBe("Food at home");
  });

  test("rename validation: unknown source, system names, duplicates, kind clash", async () => {
    await db.as(U1);
    await expect(rename("Nope", "Pets")).rejects.toThrow(/category_not_found/);
    await expect(rename("Other", "Pets")).rejects.toThrow(/category_system/);
    await expect(rename("Transfer", "Pets")).rejects.toThrow(/category_not_found/);
    await expect(rename("Gifts", "Transfer")).rejects.toThrow(/category_system/);
    await expect(rename("Gifts", "  ")).rejects.toThrow(/category_name_invalid/);
    await expect(rename("Gifts", "health")).rejects.toThrow(/category_exists/);
    await expect(rename("Gifts", "Salary")).rejects.toThrow(/category_exists/);
    await db.as(U2);
    await add("Bonus", "income");
    await db.as(U1);
    await expect(rename("Gifts", "Bonus")).rejects.toThrow(/category_kind_clash/);
    expect(codes(await rename("Gifts", "gifts"))).toContain("gifts"); // case-only rename of own row
  });

  test("delete moves the caller's rows, drops the budget key and the list row, keeps the global row", async () => {
    await db.as(U1);
    await add("Pets");
    const e = await post(U1, "Pets", -50, { splits: [{ category_code: "Pets", amount: 50, items: [] }] });
    const e2 = await post(U2, "Pets", -50);
    await db.as(U1);
    await db.query(`insert into public.profiles (name, category_budgets) values ('Me', '{"Pets": 500, "Gifts": 100}')`);
    const r = await del("Pets", "Other");
    expect(codes(r)).not.toContain("Pets");
    expect(await entryCat(e)).toBe("Other");
    expect(await entryCat(e2)).toBe("Pets");
    await db.asAdmin();
    expect((await db.rows("select category_code from public.entry_splits"))[0].category_code).toBe("Other");
    expect((await db.rows("select category_budgets from public.profiles"))[0].category_budgets).toEqual({ Gifts: 100 });
    expect(await db.rows("select 1 from public.categories where code = 'Pets'")).toHaveLength(1);
  });

  test("delete move-to validation", async () => {
    await db.as(U1);
    await expect(del("Gifts", "Gifts")).rejects.toThrow(/category_move_invalid/);
    await expect(del("Gifts", "Nope")).rejects.toThrow(/category_move_invalid/);
    await expect(del("Gifts", "Salary")).rejects.toThrow(/category_move_invalid/); // expense -> income
    await expect(del("Gifts", "Transfer")).rejects.toThrow(/category_move_invalid/);
    await expect(del("Salary", "Gifts")).rejects.toThrow(/category_move_invalid/); // income -> expense
    await expect(del("Salary", "Other")).rejects.toThrow(/category_move_invalid/);
    await expect(del("Other", "Gifts")).rejects.toThrow(/category_system/);
    await expect(del("Transfer", "Gifts")).rejects.toThrow(/category_not_found/);
    await expect(del("Nope", "Gifts")).rejects.toThrow(/category_not_found/);
    expect(codes(await del("Salary", "Income"))).not.toContain("Salary");
    expect(codes(await del("Gifts", "Health"))).not.toContain("Gifts");
  });

  test("reassigning keeps derived metrics consistent (spend_parts follows the new category)", async () => {
    await post(U1, "Groceries", -300);
    await db.as(U1);
    await rename("Groceries", "Food at home");
    expect((await db.rows("select category_code, amount from public.spend_parts"))).toEqual([{ category_code: "Food at home", amount: "300.00" }]);
    expect((await db.rows("select is_spend from public.entry_facts"))[0].is_spend).toBe(true);
  });

  test("RLS: each user reads only their own rows; no direct writes", async () => {
    await db.as(U1);
    await add("Pets");
    await db.as(U2);
    expect(await list()).toEqual([]);
    expect(await db.rows("select * from public.user_categories")).toHaveLength(0);
    await add("Plants");
    await db.as(U1);
    expect((await db.rows("select code from public.user_categories")).map((r) => r.code)).not.toContain("Plants");
    await expect(db.query("insert into public.user_categories (code, kind, sort) values ('Gifts', 'expense', 1)")).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.user_categories")).rejects.toThrow(/permission denied/);
  });

  test("erase_my_data removes the caller's list", async () => {
    await db.as(U1);
    await add("Pets");
    expect((await db.one("select public.erase_my_data()")).deleted.user_categories).toBe(13);
    expect(await list()).toEqual([]);
  });
});
