import { addDays, localDay, monthShort, startOfDay } from "./format";
import { FIXED, inRange, isIncome, isSpend, monthBounds, priorPeriod, spendParts, totals, weekBounds, type PeriodKind } from "./selectors";
import type { Category, Entry } from "./types";

/*
 * Pure selectors behind the Analytics tab: periods and stepping, the trend
 * series, like-for-like comparisons, trailing averages, spending habits,
 * recurring bills and income. Spending and income follow selectors.ts
 * (Transfer, Investments, Adjustment and refunded entries are neither).
 */

export const PERIOD_KINDS: PeriodKind[] = ["week", "month", "year"];
export const isPeriodKind = (s: string | null): s is PeriodKind => s === "week" || s === "month" || s === "year";

/** [from, to) of the week (Monday start), month or year containing d. */
export function periodBounds(kind: PeriodKind, d: Date): readonly [Date, Date] {
  if (kind === "week") return weekBounds(d);
  if (kind === "month") return monthBounds(d);
  return [new Date(d.getFullYear(), 0, 1), new Date(d.getFullYear() + 1, 0, 1)] as const;
}

/** Start of the period `n` steps from the one starting at `from` (negative = earlier). */
export function shiftPeriod(kind: PeriodKind, from: Date, n: number): Date {
  if (kind === "week") return addDays(from, 7 * n);
  if (kind === "month") return new Date(from.getFullYear(), from.getMonth() + n, 1);
  return new Date(from.getFullYear() + n, 0, 1);
}

/** The period containing `now` is still going. */
export const isCurrent = (kind: PeriodKind, from: Date, now = new Date()) => periodBounds(kind, now)[0].getTime() === from.getTime();

/** "Oct 2026", "Oct 20–26", "Sep 29–Oct 5", "2026". */
export function periodLabel(kind: PeriodKind, from: Date) {
  if (kind === "year") return `${from.getFullYear()}`;
  if (kind === "month") return `${monthShort(from)} ${from.getFullYear()}`;
  const end = addDays(from, 6);
  return from.getMonth() === end.getMonth()
    ? `${monthShort(from)} ${from.getDate()}–${end.getDate()}`
    : `${monthShort(from)} ${from.getDate()}–${monthShort(end)} ${end.getDate()}`;
}

/** Bar label under the trend chart: "20" (week of Oct 20), "O", "2026". */
export function tickLabel(kind: PeriodKind, from: Date) {
  if (kind === "year") return `${from.getFullYear()}`;
  if (kind === "month") return monthShort(from);
  return `${from.getDate()}`;
}

/** /analytics?p=week|month|year&at=YYYY-MM-DD → the period shown; a future date clamps to now. */
export function readAnalyticsQuery(params: URLSearchParams, now = new Date()): { kind: PeriodKind; from: Date } {
  const p = params.get("p");
  const kind: PeriodKind = isPeriodKind(p) ? p : "month";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get("at") ?? "");
  let at = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : now;
  if (Number.isNaN(at.getTime()) || at > now) at = now;
  return { kind, from: periodBounds(kind, at)[0] };
}

export const analyticsHref = (kind: PeriodKind, from: Date) => `/analytics?p=${kind}&at=${localDay(from)}`;

/** First period the ledger has data for: the one containing its start. */
const firstPeriod = (kind: PeriodKind, start: Date) => periodBounds(kind, start)[0];

/* ---------- trend ----------------------------------------------------------- */

export const TREND_LENGTH: Record<PeriodKind, number> = { week: 8, month: 12, year: 5 };

export interface TrendPoint {
  from: Date;
  to: Date;
  in: number;
  out: number;
  net: number;
  /** contains today, so still going */
  current: boolean;
  selected: boolean;
}

/**
 * Income and spending per period: the last 8 weeks / 12 months / 5 years, ending at
 * the current period while the selected one is inside that window, else at the selected
 * one. Periods before the ledger's first are dropped; the selected one always stays.
 */
export function trendSeries(entries: Entry[], kind: PeriodKind, selected: Date, now = new Date(), start = now): TrendPoint[] {
  const n = TREND_LENGTH[kind];
  const cur = periodBounds(kind, now)[0];
  const end = shiftPeriod(kind, cur, -(n - 1)).getTime() <= selected.getTime() ? cur : selected;
  const first = firstPeriod(kind, start).getTime();
  const out: TrendPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = shiftPeriod(kind, end, -i);
    const isSel = from.getTime() === selected.getTime();
    if (from.getTime() < first && !isSel) continue;
    const to = shiftPeriod(kind, from, 1);
    const t = totals(inRange(entries, from, to));
    out.push({ from, to, in: t.in, out: t.out, net: t.net, current: from.getTime() === cur.getTime(), selected: isSel });
  }
  return out;
}

/* ---------- comparisons ----------------------------------------------------- */

export const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
export const savingsRate = (t: { in: number; net: number }) => (t.in > 0 ? Math.round((t.net / t.in) * 100) : null);

/** How many earlier periods the trailing average reads. Years: every earlier year available, up to 5. */
export const TRAILING: Record<PeriodKind, number> = { week: 8, month: 3, year: 5 };

export type Bucket = Category | "Unfiled";

/** Spending per category; an entry with no category is "Unfiled", one bucket, never also "Other". */
export function buckets(entries: Entry[]): Map<Bucket, number> {
  const m = new Map<Bucket, number>();
  for (const e of entries) {
    if (!isSpend(e)) continue;
    for (const p of spendParts(e)) {
      const k: Bucket = e.category == null && !e.split?.length ? "Unfiled" : p.category;
      m.set(k, (m.get(k) ?? 0) + p.amount);
    }
  }
  return m;
}

export interface Trailing {
  /** periods averaged */
  n: number;
  in: number;
  out: number;
  net: number;
  rate: number | null;
  byCat: Map<Bucket, number>;
}

/**
 * The average of up to TRAILING[kind] earlier periods, each over the same like-for-like
 * stretch the previous-period comparison uses (an unfinished month compares 1–29 with
 * 1–29 of each earlier month). Only periods since the ledger began count; null when none.
 */
export function trailingAverage(entries: Entry[], kind: PeriodKind, from: Date, to: Date, now = new Date(), start = now): Trailing | null {
  const first = firstPeriod(kind, start).getTime();
  let n = 0;
  let inn = 0;
  let out = 0;
  const byCat = new Map<Bucket, number>();
  for (let k = 1; k <= TRAILING[kind]; k++) {
    const p = priorPeriod(kind, from, to, now, k);
    if (p.from.getTime() < first) break;
    const list = inRange(entries, p.from, p.to);
    const t = totals(list);
    inn += t.in;
    out += t.out;
    for (const [c, v] of buckets(list)) byCat.set(c, (byCat.get(c) ?? 0) + v);
    n++;
  }
  if (!n) return null;
  for (const [c, v] of byCat) byCat.set(c, v / n);
  const avg = { in: inn / n, out: out / n, net: (inn - out) / n };
  return { n, ...avg, rate: savingsRate(avg), byCat };
}

export interface Headline {
  cur: ReturnType<typeof totals>;
  prior: { from: Date; to: Date; partial: boolean };
  /** null: the previous period is from before the ledger began */
  prev: ReturnType<typeof totals> | null;
  avg: Trailing | null;
}

export function headline(entries: Entry[], kind: PeriodKind, from: Date, to: Date, now = new Date(), start = now): Headline {
  const prior = priorPeriod(kind, from, to, now);
  const prev = prior.from.getTime() < firstPeriod(kind, start).getTime() ? null : totals(inRange(entries, prior.from, prior.to));
  return { cur: totals(inRange(entries, from, to)), prior, prev, avg: trailingAverage(entries, kind, from, to, now, start) };
}

/* ---------- spending habits ------------------------------------------------- */

export interface CategoryRow {
  cat: Bucket;
  amount: number;
  /** % of the period's spending */
  share: number;
  prev: number;
  /** % vs the previous stretch; null = nothing there before (NEW) */
  change: number | null;
  /** the period's spending entries in this category */
  entries: Entry[];
}

const inBucket = (e: Entry, c: Bucket) =>
  c === "Unfiled" ? e.category == null && !e.split?.length : e.category === c || !!e.split?.some((s) => s.category === c);

export function categoryRows(cur: Entry[], prev: Entry[]): CategoryRow[] {
  const now = buckets(cur);
  const before = buckets(prev);
  const total = [...now.values()].reduce((a, b) => a + b, 0);
  const spends = cur.filter(isSpend);
  return [...now.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amount]) => {
      const p = before.get(cat) ?? 0;
      return {
        cat,
        amount,
        share: total > 0 ? Math.round((amount / total) * 100) : 0,
        prev: p,
        change: pctChange(amount, p),
        entries: spends.filter((e) => inBucket(e, cat)),
      };
    });
}

/** Biggest peso swing up and down vs the previous stretch, across categories in either period. */
export function movers(cur: Entry[], prev: Entry[]) {
  const a = buckets(cur);
  const b = buckets(prev);
  const cats = new Set<Bucket>([...a.keys(), ...b.keys()]);
  let up: { cat: Bucket; diff: number } | null = null;
  let down: { cat: Bucket; diff: number } | null = null;
  for (const c of cats) {
    const diff = (a.get(c) ?? 0) - (b.get(c) ?? 0);
    if (diff > 0 && (!up || diff > up.diff)) up = { cat: c, diff };
    if (diff < 0 && (!down || diff < down.diff)) down = { cat: c, diff };
  }
  const pick = (c: Bucket) => [...cur, ...prev].filter((e) => isSpend(e) && inBucket(e, c));
  return { up: up ? { ...up, entries: pick(up.cat) } : null, down: down ? { ...down, entries: pick(down.cat) } : null };
}

/** "Grab", "grab " and "GRAB" are one merchant. */
export const merchantKey = (desc: string) => desc.trim().toLowerCase().replace(/\s+/g, " ");

function groupBy(entries: Entry[]) {
  const m = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = merchantKey(e.desc);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  }
  return m;
}

/** The spelling used most often for a merchant. */
function displayName(list: Entry[]) {
  const n = new Map<string, number>();
  for (const e of list) n.set(e.desc.trim(), (n.get(e.desc.trim()) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function topMerchants(entries: Entry[], limit = 5) {
  return [...groupBy(entries.filter(isSpend))]
    .map(([key, list]) => ({ key, name: displayName(list), amount: list.reduce((s, e) => s - e.amount, 0), entries: list }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/**
 * Spending by weekday (Monday first) over the elapsed part of [from, to) since the ledger began: total, the
 * number of those weekdays elapsed, and the average per day. Rent, bills and
 * subscriptions land on a date, not a habit, so they are left out.
 */
export function weekdayPattern(entries: Entry[], from: Date, to: Date, now = new Date(), start = from) {
  const end = Math.min(to.getTime(), addDays(startOfDay(now), 1).getTime());
  // days before the ledger began aren't "no spending" days
  const begin = new Date(Math.max(from.getTime(), startOfDay(start).getTime()));
  const days = Array.from({ length: 7 }, () => ({ total: 0, days: 0, entries: [] as Entry[] }));
  for (let d = new Date(begin); d.getTime() < end; d = addDays(d, 1)) days[(d.getDay() + 6) % 7].days++;
  for (const e of inRange(entries, begin, new Date(end))) {
    if (!isSpend(e) || FIXED.includes(e.category ?? "Other")) continue;
    const slot = days[(new Date(e.date).getDay() + 6) % 7];
    slot.total -= e.amount;
    slot.entries.push(e);
  }
  return days.map((x, i) => ({ ...x, dow: i, avg: x.days ? x.total / x.days : 0 }));
}

/* ---------- recurring ------------------------------------------------------- */

export interface Recurring {
  name: string;
  category: Category | null;
  /** typical charge (median) */
  amount: number;
  /** typical day of the month */
  day: number;
  months: number;
  last: Date;
  entries: Entry[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Bills that come back about monthly: the same merchant charged in at least 3 of the
 * 6 months up to `to`, about once a month (never more than one extra), each charge
 * within 25% of the typical amount, on roughly the same day of the month (± 5 days).
 */
export function recurringBills(entries: Entry[], to: Date): Recurring[] {
  const from = new Date(to.getFullYear(), to.getMonth() - 6, to.getDate());
  const out: Recurring[] = [];
  for (const [, list] of groupBy(inRange(entries, from, to).filter(isSpend))) {
    const months = new Set(list.map((e) => e.date.slice(0, 7)));
    if (months.size < 3 || list.length > months.size + 1) continue;
    const amounts = list.map((e) => -e.amount);
    const typical = median(amounts);
    if (amounts.some((a) => Math.abs(a - typical) > typical * 0.25)) continue;
    const doms = list.map((e) => new Date(e.date).getDate());
    if (Math.max(...doms) - Math.min(...doms) > 10) continue;
    const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
    out.push({
      name: displayName(list),
      category: sorted[0].category,
      amount: Math.round(typical),
      day: Math.round(median(doms)),
      months: months.size,
      last: new Date(sorted[0].date),
      entries: sorted,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/* ---------- income ---------------------------------------------------------- */

export function incomeSources(cur: Entry[], prev: Entry[]) {
  const before = groupBy(prev.filter(isIncome));
  return [...groupBy(cur.filter(isIncome))]
    .map(([key, list]) => {
      const amount = list.reduce((s, e) => s + e.amount, 0);
      const p = (before.get(key) ?? []).reduce((s, e) => s + e.amount, 0);
      return { key, name: displayName(list), category: list[0].category, amount, prev: p, change: pctChange(amount, p), entries: list };
    })
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Monthly income over the last (up to) 6 finished months since the ledger began:
 * range, average and a plain verdict by how much it varies (coefficient of variation:
 * under 10% steady, under 25% varies, else irregular). null under 2 months.
 */
export function incomeConsistency(entries: Entry[], now = new Date(), start = now) {
  const cur = monthBounds(now)[0];
  const first = monthBounds(start)[0].getTime();
  const months: { from: Date; in: number; entries: Entry[] }[] = [];
  for (let k = 1; k <= 6; k++) {
    const from = new Date(cur.getFullYear(), cur.getMonth() - k, 1);
    if (from.getTime() < first) break;
    const list = inRange(entries, from, new Date(from.getFullYear(), from.getMonth() + 1, 1)).filter(isIncome);
    months.unshift({ from, in: list.reduce((s, e) => s + e.amount, 0), entries: list });
  }
  if (months.length < 2) return null;
  const xs = months.map((m) => m.in);
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - avg) ** 2, 0) / xs.length);
  const cv = avg > 0 ? sd / avg : 1;
  return {
    months,
    min: Math.min(...xs),
    max: Math.max(...xs),
    avg,
    verdict: (cv < 0.1 ? "steady" : cv < 0.25 ? "varies" : "irregular") as "steady" | "varies" | "irregular",
  };
}
