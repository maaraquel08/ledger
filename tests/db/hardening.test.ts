// Migrations 20261029001200..001500: definer write RPCs + locked money tables, usage quotas,
// corrections soft reference, sign-up allowlist.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { createDb, num, U1, U2, type Db } from "./harness";

let db: Db;
const j = (v: unknown) => JSON.stringify(v);

beforeAll(async () => {
  db = await createDb();
});

const account = async (type: string, opening = 0) =>
  (await db.one("select public.upsert_account($1::jsonb)", [j({ name: type, type, opening_balance: opening })])).id as string;
const post = (e: unknown) => db.one("select public.post_entries($1::jsonb)", [j(e)]);

describe("money tables are written only through the RPCs (I)", () => {
  const LOCKED = ["entries", "moves", "entry_splits", "receipt_items", "accounts", "balance_snapshots", "holding_snapshots"];

  test("authenticated has SELECT but no INSERT/UPDATE/DELETE on the money tables", async () => {
    await db.asAdmin();
    for (const t of LOCKED) {
      const r = await db.one<Record<string, boolean>>(
        `select jsonb_build_object('s', has_table_privilege('authenticated', $1, 'select'),
                                   'i', has_table_privilege('authenticated', $1, 'insert'),
                                   'u', has_table_privilege('authenticated', $1, 'update'),
                                   'd', has_table_privilege('authenticated', $1, 'delete'))`,
        [`public.${t}`],
      );
      expect(r, t).toEqual({ s: true, i: false, u: false, d: false });
    }
  });

  test("direct writes are refused; every RPC still works for the Owner", async () => {
    await db.as(U1);
    const bank = await account("bank", 1000);
    const inv = await account("investments", 0);
    await expect(db.query("insert into public.accounts (name, type) values ('x', 'bank')")).rejects.toThrow(/permission denied/);
    await expect(db.query("insert into public.entries (amount) values (-1)")).rejects.toThrow(/permission denied/);
    await expect(db.query("update public.accounts set opening_balance = 9 where id = $1", [bank])).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.balance_snapshots")).rejects.toThrow(/permission denied/);

    const e = randomUUID();
    const p = await post({ id: e, account_id: bank, category_code: "Groceries", amount: -100,
      splits: [{ category_code: "Groceries", amount: 100, items: ["rice"] }] });
    expect(p.created).toEqual([e]);
    await db.one("select public.update_entry($1, $2::jsonb)", [e, j({ amount: -120, splits: [] })]);
    await db.one("select public.mark_refunded($1)", [e]);
    const v = await db.one("select public.void_entry($1)", [e]);
    expect(v.entries[0].status).toBe("void");
    const undone = await db.one("select public.undo_event($1)", [v.undo_event_id]);
    expect(undone.entries[0].status).toBe("posted");

    const snap = await db.one("select public.report_balance($1, 950)", [bank]);
    expect(num(snap.gap)).toBe(-50);
    const adj = await db.one("select public.record_adjustment($1)", [bank]);
    expect(num(adj.gap_after)).toBe(0);
    const h = await db.one("select public.report_holdings($1, $2::jsonb)", [inv, j([{ symbol: "VT", qty: 2, price: 100 }])]);
    expect(num(h.market_value)).toBe(200);
    const imp = await db.one("select public.import_state($1::jsonb)", [j({
      accounts: [{ id: "a1", name: "Cash", type: "cash", provider: "cash", balance: 50 }],
      entries: [{ id: "e1", accountId: "a1", category: "Food & drink", amount: -10, date: "2026-10-01T00:00:00Z", desc: "x" }],
      profile: { name: "Me" },
    })]);
    expect(imp.entries.inserted).toBe(1);

    // tables the client still writes directly
    await db.query("insert into public.profiles (name) values ('Me') on conflict (user_id) do update set name = excluded.name");
    await db.query("insert into public.goals (name, target) values ('Trip', 100)");
    await db.query("insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://p/1', 'k', 'a')");
    await db.query("delete from public.push_subscriptions where endpoint = 'https://p/1'");
    await db.query("insert into public.raw_inputs (kind, text) values ('text', 'hi')");
  });

  test("the RPCs are security definer with an empty search_path; set_entry_details is internal", async () => {
    await db.asAdmin();
    const rows = await db.rows<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
      `select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`,
      [["post_entries", "update_entry", "void_entry", "mark_refunded", "undo_event", "report_balance",
        "record_adjustment", "report_holdings", "upsert_account", "import_state", "chat_quota_take", "capture_quota_take"]],
    );
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.proconfig, r.proname).toContain("search_path=\"\"");
    }
    expect(await db.one("select has_function_privilege('authenticated', 'public.set_entry_details(uuid, uuid, jsonb, jsonb)', 'execute')")).toBe(false);
  });

  test("definer RPCs never act on or reveal another user's rows", async () => {
    await db.as(U1);
    const bank = await account("bank", 100);
    const snapId = randomUUID();
    await db.one("select public.report_balance($1, 80, now(), null, $2)", [bank, snapId]);
    const eid = randomUUID();
    await post({ id: eid, account_id: bank, category_code: "Shopping", amount: -5 });
    const ev = (await db.one("select public.void_entry($1)", [eid])).undo_event_id;

    await db.as(U2);
    const mine = await account("bank", 0);
    await expect(db.query("select public.report_balance($1, 1, now(), null, $2)", [mine, snapId])).rejects.toThrow(/already in use/);
    await expect(db.query("select public.report_balance($1, 1)", [bank])).rejects.toThrow(/not found/);
    await expect(db.query("select public.record_adjustment($1, 5)", [bank])).rejects.toThrow(/not found/);
    await expect(db.query("select public.update_entry($1, '{\"amount\": -1}'::jsonb)", [eid])).rejects.toThrow(/not found/);
    await expect(db.query("select public.mark_refunded($1)", [eid])).rejects.toThrow(/not found/);
    await expect(db.query("select public.undo_event($1)", [ev])).rejects.toThrow(/not found/);
    await expect(db.query("select public.upsert_account($1::jsonb)", [j({ id: bank, name: "mine now" })])).rejects.toThrow(/already in use/);
    const moveId = randomUUID();
    await db.as(U1);
    const w = await account("ewallet", 0);
    await post([
      { id: randomUUID(), account_id: bank, category_code: "Transfer", amount: -1, move_id: moveId },
      { id: randomUUID(), account_id: w, category_code: "Transfer", amount: 1, move_id: moveId },
    ]);
    await db.as(U2);
    await expect(post({ id: randomUUID(), account_id: mine, category_code: "Transfer", amount: -1, move_id: moveId }))
      .rejects.toThrow(/move id .* already in use/);
  });

  test("anon cannot call a write RPC; the service role still cannot write without a user", async () => {
    await db.asAdmin();
    await db.exec("set role anon");
    await expect(db.query("select public.post_entries('{\"amount\": -1}'::jsonb)")).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role service_role");
    await expect(db.query("select public.post_entries('{\"amount\": -1}'::jsonb)")).rejects.toThrow(/not authenticated/);
    await db.asAdmin();
  });
});

describe("one capture = one undo batch (F)", () => {
  test("a multi-entry post (expense + transfer + review entry) is reverted by its single undo_event_id", async () => {
    await db.as(U1);
    const bank = await account("bank", 1000);
    const w = await account("ewallet", 0);
    const move = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const r = await post([
      { id: ids[0], account_id: bank, category_code: "Food & drink", amount: -50 },
      { id: ids[1], account_id: bank, category_code: "Transfer", amount: -200, move_id: move, move_kind: "transfer" },
      { id: ids[2], account_id: w, category_code: "Transfer", amount: 200, move_id: move, move_kind: "transfer" },
      { id: ids[3], account_id: null, category_code: null, amount: -9, status: "review", review_question: "Which account?" },
    ]);
    expect(r.entries).toHaveLength(4);
    const u = await db.one("select public.undo_event($1)", [r.undo_event_id]);
    expect(u.deleted_ids.sort()).toEqual([...ids].sort());
    expect(num(await db.one("select count(*) from public.entries where id = any($1)", [ids]))).toBe(0);
    expect(num(await db.one("select count(*) from public.moves where id = $1", [move]))).toBe(0);
  });
});

describe("usage quotas (G, H)", () => {
  test("capture_quota_take counts up to the limit, then refuses without counting", async () => {
    await db.as(U2);
    const a = await db.one("select public.capture_quota_take(2)");
    const b = await db.one("select public.capture_quota_take(2)");
    const c = await db.one("select public.capture_quota_take(2)");
    expect([a.allowed, b.allowed, c.allowed]).toEqual([true, true, false]);
    expect(c.used).toBe(2);
    expect(num(await db.one("select count from public.capture_usage"))).toBe(2);
  });

  test("chat_usage and capture_usage are read-only to their owner", async () => {
    await db.as(U2);
    await db.one("select public.chat_quota_take(5)");
    expect(num(await db.one("select count from public.chat_usage"))).toBe(1);
    for (const t of ["chat_usage", "capture_usage"]) {
      await expect(db.query(`update public.${t} set count = 0`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`delete from public.${t}`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`insert into public.${t} (day, count) values ('2000-01-01', 0)`)).rejects.toThrow(/permission denied/);
    }
    await db.as(U1);
    expect(num(await db.one("select count(*) from public.capture_usage"))).toBe(0);
  });

  test("the quota RPCs keep the ledger_uid check", async () => {
    await db.as(U1);
    await expect(db.query("select public.capture_quota_take(5, $1)", [U2])).rejects.toThrow(/must be the caller/);
    await db.asAdmin();
    await db.exec("set role anon");
    await expect(db.query("select public.capture_quota_take(5, $1)", [U2])).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role service_role");
    // inside a definer function current_user is the owner: the role the request runs as decides
    expect((await db.one("select public.capture_quota_take(5, $1)", [U1])).allowed).toBe(true);
    await expect(db.query("select public.capture_quota_take(5)")).rejects.toThrow(/not authenticated/);
    await db.asAdmin();
  });
});

describe("corrections keep a soft reference to their entry (J)", () => {
  test("undoing an entry that has a correction works and the correction survives unchanged", async () => {
    await db.as(U1);
    const bank = await account("bank", 0);
    const e = randomUUID();
    const r = await post({ id: e, account_id: bank, category_code: "Shopping", amount: -30 });
    await db.query("insert into public.corrections (entry_id, before, after) values ($1, '{}', '{\"category_code\": \"Shopping\"}')", [e]);
    const u = await db.one("select public.undo_event($1)", [r.undo_event_id]);
    expect(u.deleted_ids).toEqual([e]);
    expect(await db.one("select entry_id from public.corrections where entry_id = $1", [e])).toBe(e);
    await expect(db.query("update public.corrections set after = '{}' where entry_id = $1", [e])).rejects.toThrow(/permission denied|append-only/);
  });
});

describe("sign-up allowlist (K)", () => {
  test("seeded with the Owner; any other email is refused, on insert and on email change", async () => {
    await db.asAdmin();
    expect(await db.one("select count(*)::int from private.allowed_emails where email = 'maaraquel24@ledger.local'")).toBe(1);
    await expect(db.query("insert into auth.users (id, email) values ($1, 'stranger@example.com')", [randomUUID()])).rejects.toThrow(/sign-ups are closed/);
    await expect(db.query("insert into auth.users (id, email) values ($1, null)", [randomUUID()])).rejects.toThrow(/sign-ups are closed/);
    const owner = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'MaaRaquel24@Ledger.local')", [owner]);
    await expect(db.query("update auth.users set email = 'other@example.com' where id = $1", [owner])).rejects.toThrow(/sign-ups are closed/);
    expect(await db.one("select has_schema_privilege('authenticated', 'private', 'usage')")).toBe(false);
  });
});
