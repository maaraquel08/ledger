// Migration 20261105000100: Metrobank is a known provider for saved and imported accounts.
import { beforeAll, describe, expect, test } from "vitest";
import { createDb, U1, U2, type Db } from "./harness";

let db: Db;
const j = (v: unknown) => JSON.stringify(v);

beforeAll(async () => {
  db = await createDb();
});

describe("metrobank provider", () => {
  test("an account can be saved as Metrobank and switched to it later", async () => {
    await db.as(U1);
    const id = (await db.one("select public.upsert_account($1::jsonb)", [j({ name: "Travel Visa Signature", type: "credit", provider: "other", opening_balance: 0 })])).id;
    await db.one("select public.upsert_account($1::jsonb)", [j({ id, provider: "metrobank", provider_label: "Metrobank" })]);
    expect((await db.rows("select provider, provider_label from public.accounts where id = $1", [id]))[0]).toEqual({ provider: "metrobank", provider_label: "Metrobank" });
  });

  test("an imported Metrobank account keeps its provider", async () => {
    await db.as(U2);
    await db.one("select public.import_state($1::jsonb)", [j({ accounts: [{ id: "m1", name: "Card", type: "credit", provider: "metrobank", balance: 0 }], entries: [], profile: { name: "Me" } })]);
    expect((await db.rows("select provider from public.accounts"))[0].provider).toBe("metrobank");
  });

  test("unknown providers are still refused", async () => {
    await db.as(U1);
    await expect(db.one("select public.upsert_account($1::jsonb)", [j({ name: "X", type: "bank", provider: "nope", opening_balance: 0 })])).rejects.toThrow(/provider_check/);
  });
});
