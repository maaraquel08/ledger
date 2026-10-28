import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { createDb, num, U1, U2, type Db } from "./harness";

let db: Db;
const j = (v: unknown) => JSON.stringify(v);

beforeAll(async () => {
  db = await createDb();
});

/** a little of everything for one Owner */
async function fill(uid: string) {
  await db.as(uid);
  const bank = (await db.one("select public.upsert_account($1::jsonb)", [j({ name: "Bank", type: "bank", opening_balance: 1000 })])).id;
  const wallet = (await db.one("select public.upsert_account($1::jsonb)", [j({ name: "Wallet", type: "ewallet", opening_balance: 0 })])).id;
  const move = randomUUID();
  await db.one("select public.post_entries($1::jsonb)", [
    j([
      { id: randomUUID(), account_id: bank, category_code: "Transfer", amount: -200, move_id: move },
      { id: randomUUID(), account_id: wallet, category_code: "Transfer", amount: 200, move_id: move },
    ]),
  ]);
  const e = randomUUID();
  await db.one("select public.post_entries($1::jsonb)", [
    j({ id: e, account_id: bank, category_code: "Groceries", amount: -300, description: "Landers", splits: [{ category_code: "Groceries", amount: 300, items: ["rice"] }], receipt_items: [{ name: "rice", amount: 300, category_code: "Groceries" }] }),
  ]);
  await db.one("select public.report_balance($1, 450)", [bank]);
  await db.query("insert into public.profiles (name, onboarded) values ('Me', true)");
  await db.query("insert into public.goals (name, target) values ('Trip', 1000)");
  await db.query("insert into public.corrections (entry_id, before, after) values ($1, '{}', '{}')", [e]);
  await db.query("insert into public.insights (kind, fingerprint, narrative) values ('weekly', 'w1', 'hi')");
  await db.query("insert into public.push_subscriptions (endpoint, p256dh, auth) values ($1, 'k', 'a')", [`https://push.example/${uid}`]);
}

const TABLES = [
  "profiles", "accounts", "entries", "entry_splits", "receipt_items", "moves", "balance_snapshots",
  "goals", "corrections", "insights", "push_subscriptions", "entry_events",
];

async function counts(uid: string) {
  await db.asAdmin();
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = num(await db.one(`select count(*) from public.${t} where user_id = $1`, [uid]));
  return out;
}

describe("erase_my_data", () => {
  test("deletes every row of the caller, keeps their login and everyone else's rows", async () => {
    await fill(U1);
    await fill(U2);
    const before = await counts(U1);
    for (const t of TABLES) expect(before[t], t).toBeGreaterThan(0);

    await db.as(U1);
    const res = await db.one("select public.erase_my_data()");
    expect(res.erased).toBe(true);
    expect(res.deleted.entries).toBe(3);

    const after = await counts(U1);
    for (const t of TABLES) expect(after[t], t).toBe(0);
    expect(await counts(U2)).toEqual(before);

    await db.asAdmin();
    expect(num(await db.one("select count(*) from auth.users where id = $1", [U1]))).toBe(1);

    // the Owner can start again
    await db.as(U1);
    const a = await db.one("select public.upsert_account($1::jsonb)", [j({ name: "Fresh", type: "cash", opening_balance: 5 })]);
    expect(num(a.balance)).toBe(5);
  });

  test("corrections stay append-only outside an erase", async () => {
    await db.as(U2);
    await expect(db.query("delete from public.corrections")).rejects.toThrow(/append-only|permission denied/);
    await db.asAdmin();
    await expect(db.query("delete from public.corrections")).rejects.toThrow(/append-only/);
  });

  test("needs a signed-in caller", async () => {
    await db.asAdmin();
    await expect(db.query("select public.erase_my_data()")).rejects.toThrow(/not authenticated/);
  });
});
