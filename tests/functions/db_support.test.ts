// 20261029001100_function_support.sql: chat quota and the capture gate's data checks.
import { beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db, U1, U2 } from "../db/harness";

let db: Db;
const j = (v: unknown) => JSON.stringify(v);
const WALLET = "aaaaaaaa-0000-4000-8000-000000000001";
const id = (n: number) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  db = await createDb();
  await db.as(U1);
  await db.one(`select upsert_account($1::jsonb)`, [j({ id: WALLET, name: "Wallet", provider: "gcash", type: "ewallet", opening_balance: 10000 })]);
  const rows = [
    { id: id(1), account_id: WALLET, category_code: "Transport", amount: -200, occurred_at: "2026-10-01T08:00:00+08:00", description: "Grab", merchant: "Grab" },
    { id: id(2), account_id: WALLET, category_code: "Transport", amount: -250, occurred_at: "2026-10-05T08:00:00+08:00", description: "Grab", merchant: "Grab" },
    { id: id(3), account_id: WALLET, category_code: "Transport", amount: -300, occurred_at: "2026-10-10T08:00:00+08:00", description: "Angkas", merchant: "Angkas" },
    { id: id(4), account_id: WALLET, category_code: "Transport", amount: -248, occurred_at: "2026-10-28T09:00:00+08:00", description: "Grab", merchant: "Grab" },
    { id: id(5), account_id: WALLET, category_code: "Food & drink", amount: -500, occurred_at: "2026-10-20T12:00:00+08:00", description: "Jollibee", merchant: "Jollibee" },
  ];
  await db.one(`select post_entries($1::jsonb)`, [j(rows)]);
});

describe("capture_checks", () => {
  const checks = (amount: number, merchant: string, category: string | null, at: string, exclude: string[] = []) =>
    db.one(`select capture_checks($1, $2, $3, $4::timestamptz, $5::uuid[])`, [amount, merchant, category, at, exclude]);

  test("same amount + merchant within 48 h is a likely duplicate", async () => {
    await db.as(U1);
    const r = await checks(-248, "grab", "Transport", "2026-10-29T12:00:00+08:00");
    expect(r.duplicate).toMatchObject({ id: id(4), merchant: "Grab" });
  });

  test("outside 48 h, other amount, other merchant, or excluded → no duplicate", async () => {
    await db.as(U1);
    expect((await checks(-248, "grab", "Transport", "2026-10-31T12:00:00+08:00")).duplicate).toBeNull();
    expect((await checks(-249, "grab", "Transport", "2026-10-29T12:00:00+08:00")).duplicate).toBeNull();
    expect((await checks(-248, "jollibee", "Transport", "2026-10-29T12:00:00+08:00")).duplicate).toBeNull();
    expect((await checks(-248, "grab", "Transport", "2026-10-29T12:00:00+08:00", [id(4)])).duplicate).toBeNull();
  });

  test("category median over same-sign entries; null with fewer than three", async () => {
    await db.as(U1);
    const r = await checks(-1000, "grab", "Transport", "2026-10-29T12:00:00+08:00");
    expect(r.median).toEqual({ category_code: "Transport", value: 249, sample: 4 }); // 200, 248, 250, 300
    const food = await checks(-1000, "jollibee", "Food & drink", "2026-10-29T12:00:00+08:00");
    expect(food.median).toEqual({ category_code: "Food & drink", value: null, sample: 1 });
    expect((await checks(-1000, "x", null, "2026-10-29T12:00:00+08:00")).median).toBeNull();
  });

  test("RLS: another owner sees none of it", async () => {
    await db.as(U2);
    const r = await checks(-248, "grab", "Transport", "2026-10-29T12:00:00+08:00");
    expect(r.duplicate).toBeNull();
    expect(r.median.sample).toBe(0);
  });

  test("anon can't call it", async () => {
    await db.asAdmin();
    await db.exec("set role anon");
    await expect(db.one(`select capture_checks(-1, 'x', null)`)).rejects.toThrow(/permission denied/);
    await db.asAdmin();
  });
});

describe("chat_quota_take", () => {
  test("counts per Owner-local day and stops at the limit", async () => {
    await db.as(U1);
    expect(await db.one(`select chat_quota_take(2)`)).toMatchObject({ allowed: true, used: 1, limit: 2 });
    expect(await db.one(`select chat_quota_take(2)`)).toMatchObject({ allowed: true, used: 2 });
    expect(await db.one(`select chat_quota_take(2)`)).toMatchObject({ allowed: false, used: 2 });
    expect(await db.one(`select chat_quota_take(3)`)).toMatchObject({ allowed: true, used: 3 }); // limit raised
    await db.as(U2);
    expect(await db.one(`select chat_quota_take(2)`)).toMatchObject({ allowed: true, used: 1 });
    expect(await db.one(`select count(*)::int from chat_usage`)).toBe(1); // RLS: only U2's row
  });

  test("limit 0 allows nothing; negative is an error", async () => {
    await db.as(U1);
    expect(await db.one(`select chat_quota_take(0)`)).toMatchObject({ allowed: false });
    await expect(db.one(`select chat_quota_take(-1)`)).rejects.toThrow(/limit/);
  });

  test("service role names the owner", async () => {
    await db.asAdmin();
    await db.exec("set role service_role");
    expect(await db.one(`select chat_quota_take(100, $1::uuid)`, [U2])).toMatchObject({ allowed: true, used: 2 });
    await db.asAdmin();
  });
});
