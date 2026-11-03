import { describe, expect, test } from "vitest";
import { billsSeries, flexiblePct, mixSeries, mixWindow } from "../../src/lib/charts/mix";
import { colorCategories, EVERYTHING_ELSE } from "../../src/lib/chart-colors";
import type { Entry, LedgerState } from "../../src/lib/types";

const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).toISOString();
let n = 0;
const e = (category: Entry["category"], amount: number, date: string, extra: Partial<Entry> = {}): Entry => ({ id: `m${++n}`, desc: "x", accountId: "bpi", category, amount, date, ...extra });
const st = (entries: Entry[]) => ({ entries, profile: { categoryBudgets: {} } }) as unknown as LedgerState;

const NOW = new Date(2026, 9, 29, 15);
const OCT = new Date(2026, 9, 1);

describe("mixWindow", () => {
  const long = st([e("Food", -10, at(2020, 0, 5))]);
  test("N periods ending at the selected one", () => {
    expect(mixWindow(long, "month", OCT, NOW)).toEqual([5, 4, 3, 2, 1, 0].map((i) => new Date(2026, 9 - i, 1)));
    expect(mixWindow(long, "week", new Date(2026, 9, 26), NOW)).toHaveLength(8);
    expect(mixWindow(long, "year", new Date(2026, 0, 1), NOW)).toHaveLength(5);
  });
  test("drops periods before the first entry but keeps the selected", () => {
    const s = st([e("Food", -10, at(2026, 7, 10))]);
    expect(mixWindow(s, "month", OCT, NOW)).toEqual([new Date(2026, 7, 1), new Date(2026, 8, 1), OCT]);
    expect(mixWindow(st([]), "month", OCT, NOW)).toEqual([OCT]);
  });
});

describe("mixSeries", () => {
  test("shares per period, slot order, folding into Everything else", () => {
    const entries = [
      ...["Food", "Transport", "Groceries", "Rent & bills", "Subscriptions", "Household", "Health"].flatMap((c, i) => [e(c, -(1000 - i * 100), at(2026, 0, 3))]),
      e("Food", -300, at(2026, 9, 3)),
      e("Health", -100, at(2026, 9, 4)),
      e("Food", -100, at(2026, 9, 5)),
    ];
    const s = st(entries);
    const slots = colorCategories(s);
    expect(slots).toHaveLength(6);
    const r = mixSeries(s, "month", OCT, NOW);
    const oct = r.periods[r.selected];
    expect(oct.total).toBe(500);
    expect(oct.parts.map((p) => p.name)).toEqual(["Food", EVERYTHING_ELSE]);
    expect(oct.parts[0].share).toBeCloseTo(0.8);
    expect(oct.parts.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1);
    expect(r.present).toContain(EVERYTHING_ELSE);
  });
  test("split receipts count per part", () => {
    const s = st([e("Groceries", -300, at(2026, 9, 3), { split: [{ category: "Groceries", amount: 200 }, { category: "Household", amount: 100 }] })]);
    const oct = mixSeries(s, "month", OCT, NOW).periods.at(-1)!;
    expect(oct.parts.map((p) => [p.name, p.amount])).toEqual([["Groceries", 200], ["Household", 100]]);
  });
  test("refunds, refunded, transfers and income are excluded; empty period has no parts", () => {
    const s = st([
      e("Food", -100, at(2026, 8, 3)),
      e("Food", 50, at(2026, 9, 3)),
      e("Food", -80, at(2026, 9, 4), { refunded: true }),
      e("Transfer", -500, at(2026, 9, 5)),
      e("Investments", -500, at(2026, 9, 6)),
    ]);
    const oct = mixSeries(s, "month", OCT, NOW).periods.at(-1)!;
    expect(oct.total).toBe(0);
    expect(oct.parts).toEqual([]);
  });
});

describe("billsSeries", () => {
  const s = st([
    e("Rent & bills", -1000, at(2026, 9, 1)),
    e("Subscriptions", -200, at(2026, 9, 2)),
    e("Food", -800, at(2026, 9, 3)),
    e("Groceries", -300, at(2026, 9, 3), { split: [{ category: "Rent & bills", amount: 100 }, { category: "Food", amount: 200 }] }),
    e("Transfer", -999, at(2026, 9, 4)),
    e("Food", -50, at(2026, 8, 4), { refunded: true }),
  ]);
  test("bills vs everyday per part, transfers and refunded excluded", () => {
    const r = billsSeries(s, "month", OCT, NOW);
    const oct = r.periods[r.selected];
    expect(oct).toMatchObject({ bills: 1300, everyday: 1000, total: 2300 });
    expect(r.max).toBe(2300);
    expect(flexiblePct(oct)).toBe(43);
  });
  test("custom fixed categories and empty periods", () => {
    const r = billsSeries({ ...s, categories: [{ name: "Food", kind: "expense", fixed: true }] } as LedgerState, "month", OCT, NOW);
    expect(r.periods.at(-1)!.bills).toBe(1000);
    const empty = billsSeries(st([e("Food", -1, at(2026, 5, 1))]), "month", OCT, NOW);
    expect(empty.periods.at(-1)).toMatchObject({ total: 0 });
    expect(flexiblePct(empty.periods.at(-1)!)).toBeNull();
  });
});
