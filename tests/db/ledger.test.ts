import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { createDb, num, U1, U2, type Db } from "./harness";

let db: Db;
const j = (v: unknown) => JSON.stringify(v);

async function account(type: string, opening: number, name = type) {
  const a = await db.one("select public.upsert_account($1::jsonb)", [
    j({ id: randomUUID(), name, type, provider: "other", opening_balance: opening }),
  ]);
  return a.id as string;
}
const post = (e: unknown) => db.one("select public.post_entries($1::jsonb)", [j(e)]);
const balance = async (id: string) => num(await db.one("select balance from public.account_balances where account_id = $1", [id]));
const entry = (id: string) => db.one("select public.entry_json($1)", [id]);

beforeAll(async () => {
  db = await createDb();
}, 60_000);

describe("derived balances", () => {
  test("bank and credit, refunds, voids, review entries", async () => {
    await db.as(U1);
    const bank = await account("bank", 1000);
    const card = await account("credit", 500); // owes 500

    await post([
      { id: randomUUID(), account_id: bank, category_code: "Food & drink", amount: -200, description: "lunch" },
      { id: randomUUID(), account_id: card, category_code: "Shopping", amount: -300, description: "Uniqlo" },
      { id: randomUUID(), account_id: bank, category_code: "Income", amount: 50, description: "gcash from Ana" },
    ]);
    const refunded = randomUUID();
    await post({ id: refunded, account_id: bank, category_code: "Shopping", amount: -100, description: "Shopee" });
    const voided = randomUUID();
    await post({ id: voided, account_id: bank, category_code: "Food & drink", amount: -40, description: "oops" });
    // no account: lands in review, moves no balance
    const noAccount = randomUUID();
    await post({ id: noAccount, account_id: null, category_code: "Groceries", amount: -70, description: "7-Eleven" });
    // account but no category: review, but real money -> moves the balance
    const noCategory = randomUUID();
    await post({ id: noCategory, account_id: bank, category_code: null, amount: -10, description: "something" });

    expect(await balance(bank)).toBe(1000 - 200 + 50 - 100 - 40 - 10);
    await db.one("select public.mark_refunded($1)", [refunded]);
    await db.one("select public.void_entry($1)", [voided]);

    expect(await balance(bank)).toBe(1000 - 200 + 50 - 10);
    expect(await balance(card)).toBe(500 + 300); // credit shows amount owed

    expect((await entry(noAccount)).status).toBe("review");
    expect((await entry(noCategory)).status).toBe("review");

    // un-refund restores the effect
    await db.one("select public.mark_refunded($1, false)", [refunded]);
    expect(await balance(bank)).toBe(1000 - 200 + 50 - 10 - 100);
  });

  test("income cannot be refunded; opening balance is fixed", async () => {
    await db.as(U1);
    const bank = await account("bank", 0);
    const inc = randomUUID();
    await post({ id: inc, account_id: bank, category_code: "Salary", amount: 1000 });
    await expect(db.query("select public.mark_refunded($1)", [inc])).rejects.toThrow(/only an expense/);
    await expect(
      db.query("select public.upsert_account($1::jsonb)", [j({ id: bank, opening_balance: 5 })]),
    ).rejects.toThrow(/opening_balance is fixed/);
    // renaming is fine
    const a = await db.one("select public.upsert_account($1::jsonb)", [j({ id: bank, name: "Payroll" })]);
    expect(a.name).toBe("Payroll");
    expect(num(a.balance)).toBe(1000);
  });
});

describe("moves (transfers and investments)", () => {
  test("legs must sum to zero; post is atomic", async () => {
    await db.as(U1);
    const bank = await account("bank", 10_000);
    const wallet = await account("ewallet", 0);
    const move = randomUUID();
    const bad = [
      { id: randomUUID(), account_id: bank, category_code: "Transfer", amount: -500, move_id: move },
      { id: randomUUID(), account_id: wallet, category_code: "Transfer", amount: 400, move_id: move },
    ];
    await expect(post(bad)).rejects.toThrow(/sum to zero/);
    expect(num(await db.one("select count(*) from public.entries where move_id = $1", [move]))).toBe(0);
    expect(await balance(bank)).toBe(10_000);

    const a = randomUUID();
    const b = randomUUID();
    const res = await post([
      { id: a, account_id: bank, category_code: "Transfer", amount: -500, move_id: move },
      { id: b, account_id: wallet, category_code: "Transfer", amount: 500, move_id: move },
    ]);
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0].move_kind).toBe("transfer");
    expect(await balance(bank)).toBe(9_500);
    expect(await balance(wallet)).toBe(500);

    // the Owner cannot write entries directly at all; even the table owner cannot unbalance a leg
    await expect(db.query("update public.entries set amount = -600 where id = $1", [a])).rejects.toThrow(/permission denied/);
    await db.asAdmin();
    await expect(db.query("update public.entries set amount = -600 where id = $1", [a])).rejects.toThrow(/sum to zero/);
    await db.as(U1);

    // update_entry mirrors the amount onto the other leg
    await db.one("select public.update_entry($1, $2::jsonb)", [a, j({ amount: -700 })]);
    expect(num((await entry(b)).amount)).toBe(700);
    expect(await balance(wallet)).toBe(700);

    // void cascades to the other leg
    const v = await db.one("select public.void_entry($1)", [b]);
    expect(v.entries.map((e: any) => e.status)).toEqual(["void", "void"]);
    expect(await balance(bank)).toBe(10_000);
    expect(await balance(wallet)).toBe(0);

    // a single leg cannot be revived alone: status is shared
    await db.one("select public.update_entry($1, $2::jsonb)", [a, j({ status: "posted" })]);
    expect((await entry(b)).status).toBe("posted");
    expect(await balance(wallet)).toBe(700);
  });

  test("invest move is not spending", async () => {
    await db.as(U1);
    const bank = await account("bank", 20_000);
    const ibkr = await account("investments", 0);
    const move = randomUUID();
    const res = await post([
      { id: randomUUID(), account_id: bank, category_code: "Investments", amount: -8000, move_id: move, occurred_at: "2020-01-06T13:00:00Z" },
      { id: randomUUID(), account_id: ibkr, category_code: "Investments", amount: 8000, move_id: move, occurred_at: "2020-01-06T13:00:00Z" },
    ]);
    expect(res.entries[0].move_kind).toBe("invest");
    const m = await db.one("select public.metrics_period('2020-01-01T00:00:00+08:00', '2020-02-01T00:00:00+08:00')");
    expect(m.spend.value).toBe(0);
    expect(m.income.value).toBe(0);
    expect(m.invested.value).toBe(8000);
    expect(await balance(ibkr)).toBe(8000);
  });
});

describe("post_entries idempotency", () => {
  test("replaying the same ids creates nothing new", async () => {
    await db.as(U1);
    const bank = await account("bank", 0);
    const payload = [
      { id: randomUUID(), account_id: bank, category_code: "Transport", amount: -248, description: "Grab" },
      { id: randomUUID(), account_id: bank, category_code: "Food & drink", amount: -290, description: "Starbucks" },
    ];
    const first = await post(payload);
    const second = await post(payload);
    expect(first.created).toHaveLength(2);
    expect(second.created).toHaveLength(0);
    expect(second.existing).toEqual(payload.map((p) => p.id));
    expect(second.undo_event_id).toBe(first.undo_event_id);
    expect(second.entries.map((e: any) => e.id)).toEqual(payload.map((p) => p.id));
    expect(await balance(bank)).toBe(-538);
    expect(num(await db.one("select count(*) from public.entry_events where entry_id = $1", [payload[0].id]))).toBe(1);
  });
});

describe("undo", () => {
  test("insert, update, void and refund are reversible; a batch reverts together", async () => {
    await db.as(U1);
    const bank = await account("bank", 1000);
    const wallet = await account("ewallet", 0);

    const id = randomUUID();
    const p = await post({ id, account_id: bank, category_code: "Food & drink", amount: -100, description: "Jollibee" });
    const u = await db.one("select public.update_entry($1, $2::jsonb)", [id, j({ amount: -150, description: "Jollibee x2" })]);
    expect(await balance(bank)).toBe(850);

    await db.one("select public.undo_event($1)", [u.undo_event_id]);
    const back = await entry(id);
    expect(num(back.amount)).toBe(-100);
    expect(back.description).toBe("Jollibee");
    expect(await balance(bank)).toBe(900);

    const r = await db.one("select public.mark_refunded($1)", [id]);
    expect(await balance(bank)).toBe(1000);
    await db.one("select public.undo_event($1)", [r.undo_event_id]);
    expect(await balance(bank)).toBe(900);

    const v = await db.one("select public.void_entry($1)", [id]);
    expect(await balance(bank)).toBe(1000);
    await db.one("select public.undo_event($1)", [v.undo_event_id]);
    expect((await entry(id)).status).toBe("posted");
    expect(await balance(bank)).toBe(900);

    // every later change was itself undone, so the insert can be undone too
    const gone = await db.one("select public.undo_event($1)", [p.undo_event_id]);
    expect(gone.deleted_ids).toEqual([id]);
    expect(await entry(id)).toBeNull();
    expect(await balance(bank)).toBe(1000);

    // twice is a no-op, and an undo cannot itself be undone
    expect((await db.one("select public.undo_event($1)", [p.undo_event_id])).already_undone).toBe(true);
    const undoEvent = await db.one("select id from public.entry_events where reverts_batch_id is not null order by seq desc limit 1");
    await expect(db.query("select public.undo_event($1)", [undoEvent])).rejects.toThrow(/cannot be undone/);

    // a transfer posted together is undone together, move row included
    const move = randomUUID();
    const t = await post([
      { id: randomUUID(), account_id: bank, category_code: "Transfer", amount: -300, move_id: move },
      { id: randomUUID(), account_id: wallet, category_code: "Transfer", amount: 300, move_id: move },
    ]);
    expect(await balance(wallet)).toBe(300);
    const tu = await db.one("select public.undo_event($1)", [t.undo_event_id]);
    expect(tu.deleted_ids).toHaveLength(2);
    expect(await balance(wallet)).toBe(0);
    expect(num(await db.one("select count(*) from public.moves where id = $1", [move]))).toBe(0);
  });

  test("refuses to undo over a newer change", async () => {
    await db.as(U1);
    const bank = await account("bank", 0);
    const id = randomUUID();
    await post({ id, account_id: bank, category_code: "Transport", amount: -100 });
    const first = await db.one("select public.update_entry($1, $2::jsonb)", [id, j({ amount: -110 })]);
    await db.one("select public.update_entry($1, $2::jsonb)", [id, j({ description: "taxi" })]);
    await expect(db.query("select public.undo_event($1)", [first.undo_event_id])).rejects.toThrow(/changed since/);
  });

  test("entry_events is append-only for users", async () => {
    await db.as(U1);
    await expect(
      db.query("insert into public.entry_events (user_id, batch_id, entry_id, op) values ($1, gen_random_uuid(), gen_random_uuid(), 'insert')", [U1]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.entry_events")).rejects.toThrow(/permission denied/);
  });
});

describe("reconciliation", () => {
  test("report_balance never edits entries; record_adjustment closes the gap", async () => {
    await db.as(U1);
    const bank = await account("bank", 1000);
    await post({ id: randomUUID(), account_id: bank, category_code: "Food & drink", amount: -200, occurred_at: "2026-10-01T04:00:00Z" });
    const entriesBefore = num(await db.one("select count(*) from public.entries where account_id = $1", [bank]));

    const snap = await db.one("select public.report_balance($1, 750, '2026-10-02T04:00:00Z')", [bank]);
    expect(num(snap.derived)).toBe(800);
    expect(num(snap.gap)).toBe(-50);
    expect(num(await db.one("select count(*) from public.entries where account_id = $1", [bank]))).toBe(entriesBefore);
    expect(await balance(bank)).toBe(800);

    // an entry after the snapshot does not change the gap at the snapshot
    await post({ id: randomUUID(), account_id: bank, category_code: "Transport", amount: -30, occurred_at: "2026-10-03T04:00:00Z" });
    expect(num(await db.one("select gap from public.reconciliation where account_id = $1", [bank]))).toBe(-50);

    const anomalies = await db.one("select public.detect_anomalies('2026-10-03T05:00:00Z')");
    const gap = anomalies.anomalies.find((a: any) => a.kind === "reconciliation_gap" && a.facts.account_id === bank);
    expect(gap.facts.gap).toBe(-50);

    const adj = await db.one("select public.record_adjustment($1)", [bank]);
    expect(adj.adjusted).toBe(true);
    expect(num(adj.gap_before)).toBe(-50);
    expect(num(adj.gap_after)).toBe(0);
    expect(adj.entries[0].category_code).toBe("Adjustment");
    expect(num(adj.entries[0].amount)).toBe(-50);
    expect(await balance(bank)).toBe(1000 - 200 - 30 - 50);

    // an Adjustment is not spending
    const m = await db.one("select public.metrics_period('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')");
    expect(m.spend.entry_ids).not.toContain(adj.entries[0].id);

    // nothing left to adjust
    const again = await db.one("select public.record_adjustment($1)", [bank]);
    expect(again.adjusted).toBe(false);
  });

  test("credit accounts reconcile in amount owed", async () => {
    await db.as(U1);
    const card = await account("credit", 1000);
    await post({ id: randomUUID(), account_id: card, category_code: "Shopping", amount: -500, occurred_at: "2026-10-01T04:00:00Z" });
    const snap = await db.one("select public.report_balance($1, 1600, '2026-10-02T04:00:00Z')", [card]);
    expect(num(snap.derived)).toBe(1500);
    expect(num(snap.gap)).toBe(100);
    const adj = await db.one("select public.record_adjustment($1)", [card]);
    expect(num(adj.entries[0].amount)).toBe(-100); // owing more = money out
    expect(await balance(card)).toBe(1600);
  });
});

describe("row level security", () => {
  test("users only ever see and touch their own rows", async () => {
    await db.as(U1);
    const mine = await account("bank", 5000, "U1 bank");
    const eid = randomUUID();
    await post({ id: eid, account_id: mine, category_code: "Shopping", amount: -100 });

    await db.as(U2);
    expect(num(await db.one("select count(*) from public.accounts"))).toBe(0);
    expect(num(await db.one("select count(*) from public.entries"))).toBe(0);
    expect(num(await db.one("select count(*) from public.account_balances"))).toBe(0);
    expect(num(await db.one("select count(*) from public.entry_events"))).toBe(0);
    const m = await db.one("select public.metrics_period('2000-01-01Z', '2100-01-01Z')");
    expect(m.entry_count.value).toBe(0);

    // cannot write rows for someone else
    await expect(
      db.query("insert into public.accounts (user_id, name, type) values ($1, 'x', 'bank')", [U1]),
    ).rejects.toThrow(/permission denied/);
    // cannot point an entry at someone else's account
    await expect(post({ id: randomUUID(), account_id: mine, category_code: "Shopping", amount: -1 })).rejects.toThrow(/foreign key/);
    // cannot hijack someone else's entry id
    await expect(post({ id: eid, account_id: null, category_code: "Shopping", amount: -1 })).rejects.toThrow(/already in use/);
    // cannot change or void someone else's entry
    await expect(db.query("update public.entries set amount = -1 where id = $1", [eid])).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.void_entry($1)", [eid])).rejects.toThrow(/not found/);
    // a signed-in user cannot ask for another user's metrics
    await expect(db.query("select public.today_budget(now(), $1)", [U1])).rejects.toThrow(/must be the caller/);

    await db.as(U1);
    expect(num((await entry(eid)).amount)).toBe(-100);
  });

  test("anon can call nothing; service role must name the user", async () => {
    await db.asAdmin();
    await db.exec("set role anon");
    await expect(db.query("select public.metrics_period(now() - interval '1 day', now())")).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role service_role");
    await expect(db.query("select public.metrics_period(now() - interval '1 day', now())")).rejects.toThrow(/not authenticated/);
    const m = await db.one("select public.metrics_period('2000-01-01Z', '2100-01-01Z', $1)", [U2]);
    expect(m.entry_count.value).toBe(0);
    await db.asAdmin();
  });

  test("storage: owner folder only, private buckets", async () => {
    await db.asAdmin();
    expect(await db.rows("select id, public from storage.buckets order by id")).toEqual([
      { id: "receipts", public: false },
      { id: "voice", public: false },
    ]);
    await db.as(U1);
    await db.query("insert into storage.objects (bucket_id, name) values ('receipts', $1)", [`${U1}/r1.jpg`]);
    await expect(
      db.query("insert into storage.objects (bucket_id, name) values ('voice', $1)", [`${U2}/v1.webm`]),
    ).rejects.toThrow(/row-level security/);
    await db.as(U2);
    expect(num(await db.one("select count(*) from storage.objects"))).toBe(0);
    await db.as(U1);
    expect(num(await db.one("select count(*) from storage.objects"))).toBe(1);
  });
});
