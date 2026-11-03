import { describe, expect, test } from "vitest";
import { donutSegments, incomeSplit } from "../../src/lib/charts/composition";
import { VIZ_OTHER } from "../../src/lib/chart-colors";
import type { Account, Entry } from "../../src/lib/types";

let n = 0;
const D = new Date(2026, 9, 10, 12).toISOString();
const e = (category: Entry["category"], amount: number, extra: Partial<Entry> = {}): Entry => ({
  id: `c${++n}`, desc: "x", accountId: "bpi", category, amount, date: D, ...extra,
});
const acc = (id: string, type: Account["type"]): Account => ({ id, name: id, provider: "other" as never, providerLabel: id, type, kind: "", balance: 0 });
const accounts = [acc("bpi", "bank"), acc("bro", "investments")];
const st = (entries: Entry[]) => ({ entries, accounts });

// global ledger: 7 categories with spend; the 7th (smallest) has no slot
const big = [
  e("Food", -700), e("Transport", -600), e("Shopping", -500), e("Health", -400), e("Groceries", -300), e("Fun", -200), e("Pets", -50),
];

describe("donutSegments", () => {
  test("slot categories keep a segment, the rest fold into Everything else", () => {
    const s = donutSegments(big, st(big));
    expect(s.map((x) => x.label)).toEqual(["Food", "Transport", "Shopping", "Health", "Groceries", "Fun", "Everything else"]);
    expect(s.at(-1)!.amount).toBe(50);
    expect(s.at(-1)!.color).toBe(VIZ_OTHER);
    expect(s.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(100);
  });
  test("splits count per part; refunds, transfers and investments are excluded", () => {
    const list = [
      e("Food", -300, { split: [{ category: "Food", amount: 100 }, { category: "Pets", amount: 200 }] as never }),
      e("Food", -999, { refunded: true }),
      e("Transfer", -500),
      e("Investments", -400),
      e("Salary", 5000),
    ];
    const s = donutSegments(list, st(big));
    expect(s.find((x) => x.key === "Food")!.amount).toBe(100);
    expect(s.find((x) => x.key === "Everything else")!.amount).toBe(200);
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(300);
  });
  test("empty period gives no segments", () => {
    expect(donutSegments([], st(big))).toEqual([]);
  });
});

describe("incomeSplit", () => {
  test("bills, everyday, invested and saved add up to income", () => {
    const list = [
      e("Salary", 10000),
      e("Rent & bills", -3000),
      e("Subscriptions", -500),
      e("Food", -2000),
      e("Investments", -1000, { linkId: "l" }),
      e("Investments", 1000, { accountId: "bro", linkId: "l" }),
      e("Transfer", -800),
    ];
    const r = incomeSplit(list, st(list));
    const by = Object.fromEntries(r.parts.map((p) => [p.key, p.amount]));
    expect(by).toEqual({ bills: 3500, everyday: 2000, invested: 1000, saved: 3500 });
    expect(r.parts.reduce((a, p) => a + p.fraction, 0)).toBeCloseTo(1);
    expect(r.overspent).toBe(false);
  });
  test("negative saved becomes Overspent and the bar scales to outflow", () => {
    const list = [e("Salary", 1000), e("Food", -1500)];
    const r = incomeSplit(list, st(list));
    expect(r.overspent).toBe(true);
    expect(r.parts.map((p) => p.key)).toEqual(["everyday", "overspent"]);
    expect(r.parts.find((p) => p.key === "overspent")!.amount).toBe(500);
    expect(r.parts.reduce((a, p) => a + p.fraction, 0)).toBeCloseTo(1);
  });
  test("refunded spend is not counted; no income gives no parts", () => {
    const list = [e("Food", -100, { refunded: true })];
    expect(incomeSplit(list, st(list)).parts).toEqual([]);
    const l2 = [e("Salary", 1000), e("Food", -100, { refunded: true })];
    expect(incomeSplit(l2, st(l2)).parts.map((p) => p.key)).toEqual(["saved"]);
  });
});
