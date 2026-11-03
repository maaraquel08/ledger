import { describe, expect, test } from "vitest";
import { accountsAt, netWorthSeries, spendByAccount } from "../../src/lib/charts/accounts";
import { netWorth } from "../../src/lib/selectors";
import type { Account, Entry } from "../../src/lib/types";

const acc = (id: string, type: Account["type"], balance: number): Account => ({ id, name: id, provider: "other", providerLabel: id, type, kind: "", balance });
const d = (y: number, m: number, day: number, h = 12) => new Date(y, m, day, h).toISOString();
let n = 0;
const e = (accountId: string | null, category: Entry["category"], amount: number, date: string, extra: Partial<Entry> = {}): Entry => ({ id: `e${++n}`, desc: "x", accountId, category, amount, date, ...extra });
const NOW = new Date(2026, 9, 29, 15);

describe("spendByAccount", () => {
  const accounts = [acc("a", "bank", 0), acc("b", "ewallet", 0)];
  test("sums, sorts, shares, no-account row, skips refunds and transfers", () => {
    const list = [
      e("a", "Food & drink", -100, d(2026, 9, 1)),
      e("b", "Shopping", -300, d(2026, 9, 2)),
      e(null, "Other", -100, d(2026, 9, 3)),
      e("a", "Shopping", -500, d(2026, 9, 4), { refunded: true }),
      e("a", "Transfer", -999, d(2026, 9, 5)),
      e("a", "Salary", 5000, d(2026, 9, 6)),
    ];
    const r = spendByAccount(list, accounts);
    expect(r.map((x) => [x.accountId, x.amount])).toEqual([["b", 300], ["a", 100], [null, 100]]);
    expect(r[0].share).toBeCloseTo(60);
  });
  test("removed account falls to No account; empty is empty", () => {
    expect(spendByAccount([e("gone", "Other", -50, d(2026, 9, 1))], accounts)[0].accountId).toBeNull();
    expect(spendByAccount([], accounts)).toEqual([]);
  });
});

describe("netWorthSeries", () => {
  test("reconstruction at now equals current", () => {
    const accounts = [acc("a", "bank", 1000), acc("c", "credit", 200)];
    const entries = [e("a", "Food & drink", -50, d(2026, 8, 1)), e("c", "Shopping", -200, d(2026, 9, 10))];
    const s = netWorthSeries({ accounts, entries }, "month", new Date(2026, 9, 1), NOW);
    expect(s.at(-1)!.total).toBe(netWorth(accounts).total);
  });
  test("credit sign: a card purchase lowers net worth when made", () => {
    const accounts = [acc("c", "credit", 500), acc("b", "bank", 100)];
    const entries = [e("c", "Shopping", -500, d(2026, 9, 10)), e("b", "Salary", 100, d(2026, 7, 20))];
    expect(accountsAt(accounts, entries, new Date(2026, 9, 1))[0].balance).toBe(0);
    const s = netWorthSeries({ accounts, entries }, "month", new Date(2026, 9, 1), NOW);
    expect(s.map((p) => p.total)).toEqual([100, 100, -400]);
    expect(s.at(-1)!.owed).toBe(500);
  });
  test("refunded entries have no effect", () => {
    const accounts = [acc("a", "bank", 1000)];
    const entries = [e("a", "Shopping", -300, d(2026, 9, 10), { refunded: true }), e("a", "Salary", 1000, d(2026, 8, 5))];
    const s = netWorthSeries({ accounts, entries }, "month", new Date(2026, 9, 1), NOW);
    expect(s.map((p) => p.total)).toEqual([1000, 1000]);
  });
  test("transfers between own accounts keep net worth flat", () => {
    const accounts = [acc("a", "bank", 700), acc("b", "ewallet", 300)];
    const entries = [e("a", "Transfer", -300, d(2026, 9, 10), { linkId: "l" }), e("b", "Transfer", 300, d(2026, 9, 10), { linkId: "l" })];
    const s = netWorthSeries({ accounts, entries }, "month", new Date(2026, 9, 1), NOW);
    expect(new Set(s.map((p) => p.total))).toEqual(new Set([1000]));
  });
  test("starts at the first entry, not before; week count is capped at 8", () => {
    const accounts = [acc("a", "bank", 100)];
    const entries = [e("a", "Salary", 100, d(2026, 8, 20))];
    expect(netWorthSeries({ accounts, entries }, "month", new Date(2026, 9, 1), NOW)).toHaveLength(2);
    const old = [e("a", "Salary", 100, d(2020, 0, 5))];
    expect(netWorthSeries({ accounts, entries: old }, "week", new Date(2026, 9, 26), NOW)).toHaveLength(8);
  });
  test("no entries: a single point today", () => {
    const s = netWorthSeries({ accounts: [acc("a", "bank", 100)], entries: [] }, "month", new Date(2026, 9, 1), NOW);
    expect(s).toHaveLength(1);
    expect(s[0].total).toBe(100);
  });
});
