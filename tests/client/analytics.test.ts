import { describe, expect, test } from "vitest";
import {
  analyticsHref,
  categoryRows,
  headline,
  incomeConsistency,
  incomeSources,
  movers,
  periodLabel,
  readAnalyticsQuery,
  recurringBills,
  shiftPeriod,
  topMerchants,
  trailingAverage,
  trendSeries,
  weekdayPattern,
} from "../../src/lib/analytics";
import { priorPeriod } from "../../src/lib/selectors";
import type { Entry } from "../../src/lib/types";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();
let n = 0;
const e = (desc: string, category: Entry["category"], amount: number, date: string, extra: Partial<Entry> = {}): Entry => ({
  id: `x${++n}`,
  desc,
  accountId: "bpi",
  category,
  amount,
  date,
  ...extra,
});

const NOW = new Date(2026, 9, 29, 15); // Thursday 29 Oct 2026

/* ---------- periods ------------------------------------------------------- */

describe("period stepping and labels", () => {
  test("shiftPeriod moves whole weeks, months and years", () => {
    expect(shiftPeriod("week", new Date(2026, 9, 26), -1)).toEqual(new Date(2026, 9, 19));
    expect(shiftPeriod("month", new Date(2026, 0, 1), -1)).toEqual(new Date(2025, 11, 1));
    expect(shiftPeriod("year", new Date(2026, 0, 1), 1)).toEqual(new Date(2027, 0, 1));
  });

  test("labels", () => {
    expect(periodLabel("month", new Date(2026, 9, 1))).toBe("Oct 2026");
    expect(periodLabel("week", new Date(2026, 9, 26))).toBe("Oct 26–Nov 1");
    expect(periodLabel("week", new Date(2026, 9, 19))).toBe("Oct 19–25");
    expect(periodLabel("year", new Date(2026, 0, 1))).toBe("2026");
  });

  test("the URL picks the period; a future date clamps to now; junk falls back to this month", () => {
    const q = (s: string) => readAnalyticsQuery(new URLSearchParams(s), NOW);
    expect(q("p=week&at=2026-10-21")).toEqual({ kind: "week", from: new Date(2026, 9, 19) });
    expect(q("p=year&at=2030-01-01")).toEqual({ kind: "year", from: new Date(2026, 0, 1) });
    expect(q("p=nope&at=x")).toEqual({ kind: "month", from: new Date(2026, 9, 1) });
    expect(analyticsHref("month", new Date(2026, 8, 1))).toBe("/analytics?p=month&at=2026-09-01");
  });

  test("priorPeriod steps further back with the same like-for-like stretch", () => {
    const p = priorPeriod("month", new Date(2026, 9, 1), new Date(2026, 10, 1), NOW, 2);
    expect(p).toEqual({ from: new Date(2026, 7, 1), to: new Date(2026, 7, 30), partial: true });
    const w = priorPeriod("week", new Date(2026, 9, 26), new Date(2026, 10, 2), NOW, 3);
    expect(w).toEqual({ from: new Date(2026, 9, 5), to: new Date(2026, 9, 9), partial: true });
  });
});

/* ---------- trend --------------------------------------------------------- */

describe("trendSeries", () => {
  const entries = [
    e("Payroll", "Salary", 50_000, at(2026, 8, 5)),
    e("Rent", "Rent & bills", -18_000, at(2026, 8, 3)),
    e("Payroll", "Salary", 50_000, at(2026, 9, 5)),
    e("VOO", "Investments", -8_000, at(2026, 9, 6)), // a move, never spending
    e("Lunch", "Food & drink", -400, at(2026, 9, 7), { refunded: true }), // refunded, not spending
  ];

  test("twelve months ending now, trimmed to the ledger's start, current flagged", () => {
    const s = trendSeries(entries, "month", new Date(2026, 9, 1), NOW, new Date(2026, 8, 3));
    expect(s.map((p) => p.from.getMonth())).toEqual([8, 9]);
    expect(s[1]).toMatchObject({ in: 50_000, out: 0, current: true, selected: true });
    expect(s[0]).toMatchObject({ in: 50_000, out: 18_000, current: false, selected: false });
  });

  test("a selection older than the window moves the window to end at it", () => {
    const s = trendSeries([], "week", new Date(2026, 0, 5), NOW, new Date(2025, 0, 1));
    expect(s).toHaveLength(8);
    expect(s[7].from).toEqual(new Date(2026, 0, 5));
    expect(s[7].selected).toBe(true);
  });

  test("years: only those the ledger covers, up to five", () => {
    const s = trendSeries([], "year", new Date(2026, 0, 1), NOW, new Date(2025, 5, 1));
    expect(s.map((p) => p.from.getFullYear())).toEqual([2025, 2026]);
  });
});

/* ---------- comparisons --------------------------------------------------- */

describe("trailing average and headline", () => {
  // the 1st–29th of Jul, Aug, Sep each: ₱30k in, ₱10k / ₱20k / ₱30k out; October so far: ₱30k in, ₱15k out
  const entries = [6, 7, 8, 9].flatMap((m, i) => [
    e("Payroll", "Salary", 30_000, at(2026, m, 5)),
    e("Shop", "Shopping", m === 9 ? -15_000 : -10_000 * (i + 1), at(2026, m, 10)),
    ...(m < 9 ? [e("Late", "Shopping", -99_000, at(2026, m, 30))] : []), // after the 29th: outside like for like
  ]);

  test("averages the same elapsed days of up to 3 earlier months", () => {
    const a = trailingAverage(entries, "month", new Date(2026, 9, 1), new Date(2026, 10, 1), NOW, new Date(2026, 6, 1))!;
    expect(a.n).toBe(3);
    expect(a.in).toBe(30_000);
    expect(a.out).toBe(20_000);
    expect(a.rate).toBe(33);
    expect(a.byCat.get("Shopping")).toBe(20_000);
  });

  test("stops at the ledger's first period; none before it is null", () => {
    expect(trailingAverage(entries, "month", new Date(2026, 9, 1), new Date(2026, 10, 1), NOW, new Date(2026, 8, 1))!.n).toBe(1);
    expect(trailingAverage(entries, "month", new Date(2026, 9, 1), new Date(2026, 10, 1), NOW, new Date(2026, 9, 1))).toBeNull();
  });

  test("headline compares like for like and says when there is no earlier period", () => {
    const h = headline(entries, "month", new Date(2026, 9, 1), new Date(2026, 10, 1), NOW, new Date(2026, 6, 1));
    expect(h.cur).toMatchObject({ in: 30_000, out: 15_000 });
    expect(h.prior.partial).toBe(true);
    expect(h.prev).toMatchObject({ in: 30_000, out: 30_000 });
    const first = headline(entries, "month", new Date(2026, 6, 1), new Date(2026, 7, 1), NOW, new Date(2026, 6, 1));
    expect(first.prev).toBeNull();
    expect(first.avg).toBeNull();
  });
});

/* ---------- habits -------------------------------------------------------- */

describe("spending habits", () => {
  const cur = [
    e("Grab", "Transport", -300, at(2026, 9, 26)),
    e("grab ", "Transport", -200, at(2026, 9, 27)),
    e("Jollibee", "Food & drink", -500, at(2026, 9, 27)),
    e("tita gift", null, -1000, at(2026, 9, 28)),
    e("Move", "Transfer", -5000, at(2026, 9, 28)),
  ];
  const prev = [e("Grab", "Transport", -1000, at(2026, 9, 20)), e("Shopee", "Shopping", -800, at(2026, 9, 21))];

  test("categories: share, change, NEW, unfiled as its own bucket", () => {
    const rows = categoryRows(cur, prev);
    expect(rows.map((r) => [r.cat, r.amount, r.share, r.change])).toEqual([
      ["Unfiled", 1000, 50, null],
      ["Transport", 500, 25, -50],
      ["Food & drink", 500, 25, null],
    ]);
    expect(rows[1].entries).toHaveLength(2);
  });

  test("movers: biggest swing each way, with the entries from both stretches", () => {
    const m = movers(cur, prev);
    expect(m.up).toMatchObject({ cat: "Unfiled", diff: 1000 });
    expect(m.down).toMatchObject({ cat: "Shopping", diff: -800 });
    expect(m.down!.entries).toHaveLength(1);
  });

  test("merchants merge spellings and skip moves", () => {
    const t = topMerchants(cur);
    expect(t[0]).toMatchObject({ amount: 1000 });
    expect(t.find((x) => x.key === "grab")).toMatchObject({ amount: 500, name: "Grab" });
    expect(t.some((x) => x.key === "move")).toBe(false);
  });

  test("weekday pattern averages over elapsed weekdays and leaves bills out", () => {
    const list = [...cur, e("Rent", "Rent & bills", -18_000, at(2026, 9, 26))];
    const w = weekdayPattern(list, new Date(2026, 9, 26), new Date(2026, 10, 2), NOW);
    expect(w[0]).toMatchObject({ dow: 0, total: 300, days: 1 }); // Monday, rent left out
    expect(w[1]).toMatchObject({ total: 700, days: 1 });
    expect(w[4].days).toBe(0); // Friday hasn't come yet
    // a ledger begun on Wednesday has no Monday or Tuesday to average
    const late = weekdayPattern(list, new Date(2026, 9, 26), new Date(2026, 10, 2), NOW, new Date(2026, 9, 28));
    expect(late[0]).toMatchObject({ days: 0, total: 0 });
    expect(late[2]).toMatchObject({ days: 1, total: 1000 });
  });
});

/* ---------- recurring ----------------------------------------------------- */

describe("recurringBills", () => {
  const to = new Date(2026, 9, 30);
  const monthly = (desc: string, amount: (m: number) => number, day: (m: number) => number, months: number[]) =>
    months.map((m) => e(desc, "Subscriptions", -amount(m), at(2026, m, day(m))));

  test("same merchant about monthly, similar amount and day", () => {
    const list = [
      ...monthly("Netflix", () => 549, () => 18, [5, 6, 7, 8, 9]),
      ...monthly("Meralco", (m) => 2400 + m * 60, (m) => 9 + (m % 2), [6, 7, 8, 9]),
    ];
    const r = recurringBills(list, to);
    expect(r.map((x) => x.name)).toEqual(["Meralco", "Netflix"]);
    expect(r[1]).toMatchObject({ amount: 549, day: 18, months: 5 });
  });

  test("not recurring: too few months, too often, amounts or days all over", () => {
    const list = [
      ...monthly("Twice", () => 500, () => 1, [8, 9]),
      ...monthly("Grab", () => 300, () => 3, [6, 7, 8, 9]),
      ...monthly("Grab", () => 300, () => 15, [6, 7, 8, 9]),
      ...monthly("Shopee", (m) => (m % 2 ? 300 : 1900), () => 12, [6, 7, 8, 9]),
      ...monthly("Drift", () => 800, (m) => (m % 2 ? 2 : 25), [6, 7, 8, 9]),
      e("Refunded", "Subscriptions", -100, at(2026, 6, 5), { refunded: true }),
    ];
    expect(recurringBills(list, to)).toEqual([]);
  });
});

/* ---------- income -------------------------------------------------------- */

describe("income", () => {
  test("sources by name with change; NEW when absent before", () => {
    const s = incomeSources(
      [e("Payroll", "Salary", 48_000, at(2026, 9, 5)), e("Payroll", "Salary", 48_000, at(2026, 9, 20)), e("Freelance", "Income", 12_000, at(2026, 9, 25))],
      [e("Payroll", "Salary", 96_000, at(2026, 8, 5))],
    );
    expect(s.map((x) => [x.name, x.amount, x.change])).toEqual([
      ["Payroll", 96_000, 0],
      ["Freelance", 12_000, null],
    ]);
  });

  test("consistency over finished months since the ledger began", () => {
    const list = [5, 6, 7, 8, 9].map((m) => e("Payroll", "Salary", m === 7 ? 60_000 : 100_000, at(2026, m, 5)));
    const c = incomeConsistency(list, NOW, new Date(2026, 5, 1))!;
    expect(c.months).toHaveLength(4); // Jun–Sep; October is still going
    expect(c).toMatchObject({ min: 60_000, max: 100_000, avg: 90_000, verdict: "varies" });
    expect(incomeConsistency(list, NOW, new Date(2026, 8, 1))).toBeNull();
  });
});
