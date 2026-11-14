import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { createDb, num, U1, U2, type Db } from "./harness";

let db: Db;
const id = randomUUID();

/** what the client's upsert-subscription sends (src/lib/cloud/map.ts subscriptionPayload) */
const payload = (over: Record<string, unknown> = {}) => ({
  id,
  description: "Netflix",
  amount: -549,
  day_of_month: 18,
  starts_on: "2026-11-18",
  account_id: null,
  category_code: "Subscriptions",
  cadence: "monthly",
  active: true,
  ...over,
});

/** PostgREST's upsert: insert ... on conflict (id) do update, over the row's own columns */
async function upsert(row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const sets = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
  await db.query(
    `insert into public.recurring_items (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})
     on conflict (id) do update set ${sets.join(",")}`,
    cols.map((c) => row[c]),
  );
}

beforeAll(async () => {
  db = await createDb();
});

describe("subscriptions in recurring_items", () => {
  test("an Owner can upsert a subscription row, twice (replay), and edit it", async () => {
    await db.as(U1);
    await upsert(payload());
    await upsert(payload());
    await upsert(payload({ amount: -649, day_of_month: 20 }));
    const r = (await db.rows("select * from public.recurring_items"))[0];
    expect(await db.rows("select 1 from public.recurring_items")).toHaveLength(1);
    expect(r.user_id).toBe(U1);
    expect(num(r.amount)).toBe(-649);
    expect(r.day_of_month).toBe(20);
    expect(r.cadence).toBe("monthly");
    expect(r.active).toBe(true);
  });

  test("a zero amount is refused", async () => {
    await db.as(U1);
    await expect(upsert(payload({ id: randomUUID(), amount: 0 }))).rejects.toThrow(/check/);
  });

  test("delete = active false: the row stays", async () => {
    await db.as(U1);
    await db.query("update public.recurring_items set active = false where id = $1", [id]);
    expect(await db.rows("select 1 from public.recurring_items where active")).toHaveLength(0);
    expect(await db.rows("select 1 from public.recurring_items where id = $1", [id])).toHaveLength(1);
  });

  test("another Owner cannot read, change or take over the row", async () => {
    await db.as(U2);
    expect(await db.rows("select 1 from public.recurring_items")).toHaveLength(0);
    await db.query("update public.recurring_items set description = 'hijack', active = true where id = $1", [id]);
    await expect(upsert(payload())).rejects.toThrow(/row-level security/);
    await expect(upsert(payload({ id: randomUUID(), user_id: U1 }))).rejects.toThrow(/row-level security/);
    await db.asAdmin();
    const r = (await db.rows("select description, active from public.recurring_items where id = $1", [id]))[0];
    expect(r).toEqual({ description: "Netflix", active: false });
  });

  test("the authenticated role holds the table grants an upsert needs", async () => {
    await db.asAdmin();
    for (const p of ["select", "insert", "update"])
      expect(await db.one("select has_table_privilege('authenticated', 'public.recurring_items', $1)", [p])).toBe(true);
  });
});
