// Migration 20261029001800: refunds only on plain expenses (QA A); move legs in different accounts (QA B).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { createDb, num, U1, type Db } from "./harness";

let db: Db;
const j = (v: unknown) => JSON.stringify(v);

beforeAll(async () => {
  db = await createDb();
}, 60_000);

const account = async (type: string, opening = 0) =>
  (await db.one("select public.upsert_account($1::jsonb)", [j({ name: type, type, opening_balance: opening })])).id as string;
const post = (e: unknown) => db.one("select public.post_entries($1::jsonb)", [j(e)]);
const balance = async (id: string) => num(await db.one("select balance from public.account_balances where account_id = $1", [id]));

describe("mark_refunded refuses anything but a plain expense", () => {
  test("move legs, adjustments and money in are refused; an expense is fine", async () => {
    await db.as(U1);
    const bank = await account("bank", 20_000);
    const ibkr = await account("investments", 0);
    const move = randomUUID();
    const out = randomUUID();
    const into = randomUUID();
    await post([
      { id: out, account_id: bank, category_code: "Investments", amount: -8000, move_id: move },
      { id: into, account_id: ibkr, category_code: "Investments", amount: 8000, move_id: move },
    ]);
    await expect(db.query("select public.mark_refunded($1)", [out])).rejects.toThrow(/only an expense/);
    await expect(db.query("select public.mark_refunded($1)", [into])).rejects.toThrow(/only an expense/);

    await db.one("select public.report_balance($1, 11000)", [bank]);
    await db.one("select public.record_adjustment($1)", [bank]);
    const adjId = await db.one<string>("select id from public.entries where account_id = $1 and category_code = 'Adjustment'", [bank]);
    expect(adjId).toBeTruthy();
    await expect(db.query("select public.mark_refunded($1)", [adjId])).rejects.toThrow(/only an expense/);

    const lunch = randomUUID();
    await post({ id: lunch, account_id: bank, category_code: "Food & drink", amount: -300, description: "lunch" });
    await db.one("select public.mark_refunded($1)", [lunch]);
    expect(await balance(bank)).toBe(11_000);
    expect(await balance(ibkr)).toBe(8000);
  });
});

describe("a move's legs are in different accounts", () => {
  test("posting or editing a leg into the other leg's account is refused", async () => {
    await db.as(U1);
    const bank = await account("bank", 5000);
    const wallet = await account("ewallet", 0);
    const move = randomUUID();
    await expect(
      post([
        { id: randomUUID(), account_id: bank, category_code: "Transfer", amount: -100, move_id: move },
        { id: randomUUID(), account_id: bank, category_code: "Transfer", amount: 100, move_id: move },
      ]),
    ).rejects.toThrow(/different accounts/);
    const ok = randomUUID();
    const a = randomUUID();
    await post([
      { id: a, account_id: bank, category_code: "Transfer", amount: -100, move_id: ok },
      { id: randomUUID(), account_id: wallet, category_code: "Transfer", amount: 100, move_id: ok },
    ]);
    await expect(db.query("select public.update_entry($1, $2::jsonb)", [a, j({ account_id: wallet })])).rejects.toThrow(/different accounts/);
    expect(await balance(wallet)).toBe(100);
  });
});
