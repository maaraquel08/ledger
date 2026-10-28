import { addDays, sameDay, startOfDay } from "./format";
import type { Account, Category, Entry, LedgerState } from "./types";

/** Categories that move money between your own pockets — never "spend". */
const NOT_SPEND: (Category | null)[] = ["Investments", "Transfer", "Adjustment"];

/** Bills that arrive once a month on a schedule. */
export const FIXED: Category[] = ["Rent & bills", "Subscriptions"];

export const isSpend = (e: Entry) => e.amount < 0 && !NOT_SPEND.includes(e.category) && !e.refunded;
export const isIncome = (e: Entry) => e.amount > 0 && !NOT_SPEND.includes(e.category);

export function inRange(entries: Entry[], from: Date, to: Date) {
  const a = from.getTime();
  const b = to.getTime();
  return entries.filter((e) => {
    const t = new Date(e.date).getTime();
    return t >= a && t < b;
  });
}

export const monthBounds = (d: Date) => [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 1)] as const;

/** Monday-start week containing d. */
export function weekBounds(d: Date) {
  const s = startOfDay(d);
  const offset = (s.getDay() + 6) % 7;
  const from = addDays(s, -offset);
  return [from, addDays(from, 7)] as const;
}

export function totals(entries: Entry[]) {
  let inn = 0;
  let out = 0;
  let deposits = 0;
  let outs = 0;
  for (const e of entries) {
    if (isIncome(e)) {
      inn += e.amount;
      deposits++;
    } else if (isSpend(e)) {
      out += -e.amount;
      outs++;
    }
  }
  return { in: inn, out, net: inn - out, deposits, outs };
}

/** What an outflow cost, per category — a split receipt counts against each of its categories. */
export function spendParts(e: Entry): { category: Category; amount: number }[] {
  if (e.split?.length) return e.split.map((s) => ({ category: s.category, amount: s.amount }));
  return [{ category: e.category ?? "Other", amount: -e.amount }];
}

export function byCategory(entries: Entry[]) {
  const m = new Map<Category, number>();
  for (const e of entries) if (isSpend(e)) for (const p of spendParts(e)) m.set(p.category, (m.get(p.category) ?? 0) + p.amount);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function netWorth(accounts: Account[]) {
  let cash = 0;
  let credit = 0;
  let invested = 0;
  for (const a of accounts) {
    if (a.type === "credit") credit += a.balance;
    else if (a.type === "investments") invested += a.balance;
    else cash += a.balance;
  }
  return { cash, credit, invested, total: cash + invested - credit };
}

export function monthlyIncome(s: LedgerState) {
  const per = s.profile.income;
  const f = s.profile.frequency;
  const base = f === "Twice a month" ? per * 2 : f === "Weekly" ? per * 4.33 : per;
  return Math.round(base);
}

/** The AI's starting plan: hold spending near two thirds of income. */
export function suggestedBudget(monthly: number) {
  return Math.round((monthly * 0.656) / 1000) * 1000;
}

/** The day the ledger starts: its earliest entry, or today when nothing earlier is logged. */
export function ledgerStart(s: LedgerState, now = new Date()) {
  let t = startOfDay(now).getTime();
  for (const e of s.entries) {
    const x = new Date(e.date).getTime();
    if (x < t) t = x;
  }
  return startOfDay(new Date(t));
}

/**
 * The budget for the month containing `now`. The month the ledger starts in is
 * partial: its budget is the monthly budget prorated by the days from the start
 * to the end of the month, so onboarding on the 29th doesn't spread a whole
 * month over three days. Mirrored by SQL today_budget().
 */
export function monthBudget(s: LedgerState, now = new Date()) {
  const full = s.profile.monthlyBudget || suggestedBudget(monthlyIncome(s));
  const [from, to] = monthBounds(now);
  const start = ledgerStart(s, now);
  if (!full || start <= from || start >= to) return { budget: full, full, proratedFrom: null as Date | null };
  const days = Math.round((to.getTime() - from.getTime()) / 86400000);
  const active = Math.round((to.getTime() - start.getTime()) / 86400000);
  return { budget: Math.round((full * active) / days), full, proratedFrom: start as Date | null };
}

/**
 * Share of this month's budget period gone by the end of `today`, in (0, 1]. A prorated first month
 * (monthBudget) starts on the ledger's first day, so its pace runs over the active days only.
 */
export function budgetPace(mb: Pick<ReturnType<typeof monthBudget>, "proratedFrom">, today = new Date()): number {
  const [from, to] = monthBounds(today);
  const periodFrom = mb.proratedFrom ?? from;
  const periodDays = Math.max(1, Math.round((to.getTime() - periodFrom.getTime()) / 86400000));
  const gone = Math.round((startOfDay(today).getTime() - periodFrom.getTime()) / 86400000) + 1;
  return Math.min(1, Math.max(1, gone) / periodDays);
}

/** The verdict: where the month stands. The daily figure is todayBudget().allowance (lib/today.ts), only. */
export function verdict(s: LedgerState, today = new Date()) {
  const [from, to] = monthBounds(today);
  const month = inRange(s.entries, from, to);
  const t = totals(month);
  const mb = monthBudget(s, today);
  const budget = mb.budget;
  const left = budget - t.out;
  const daysInMonth = Math.round((to.getTime() - from.getTime()) / 86400000);
  const daysLeft = Math.max(1, daysInMonth - today.getDate() + 1);
  const pace = budgetPace(mb, today);

  const over = byCategory(month)
    .map(([c, v]) => ({ category: c, spent: v, budget: s.profile.categoryBudgets[c] ?? 0 }))
    // fixed costs land on a date, not a pace — only discretionary spend is paced
    .filter((x) => x.budget > 0 && !FIXED.includes(x.category))
    .map((x) => ({ ...x, delta: x.spent - x.budget * (today.getDate() / daysInMonth) }))
    .sort((a, b) => b.delta - a.delta);

  const income = month.filter(isIncome);
  const savedRate = t.in > 0 ? Math.round((t.net / t.in) * 100) : 0;

  return { budget, fullBudget: mb.full, proratedFrom: mb.proratedFrom, spent: t.out, left, daysLeft, daysInMonth, pace, worst: over[0], income, savedRate, totals: t };
}

export function entriesOnDay(entries: Entry[], d: Date) {
  return entries.filter((e) => sameDay(new Date(e.date), d));
}

/** Distinct days with at least one entry. */
export function daysLogged(entries: Entry[]) {
  return new Set(entries.map((e) => e.date.slice(0, 10))).size;
}

/**
 * How rows and pickers name an account: GCASH ·8871. A known provider goes by its brand; an
 * "other" account goes by the name the Owner gave it (its provider label is free text such as
 * "App" or "Bank", which named a GoTyme account "APP ·1381").
 */
export function accountLabel(a: Account | undefined) {
  if (!a) return "ACCOUNT?";
  const base = a.provider === "other" ? a.name || a.providerLabel : a.providerLabel;
  return `${base.toUpperCase()}${a.last4 ? ` ·${a.last4}` : ""}`;
}

/** Money is spent from cash, banks, wallets and cards; an investments account is never the source of a purchase. */
export const canSpendFrom = (a: Account) => a.type !== "investments";

export type PeriodKind = "week" | "month" | "year";

/**
 * The stretch of the previous period to compare [from, to) with, like for like.
 * A finished period compares with the whole previous one. The current, unfinished
 * one compares with the same elapsed days of the previous period: Monday–Thursday
 * with last Monday–Thursday, 1–29 October with 1–29 September (clamped to its end),
 * 1 January–29 October with the same dates last year. `back` steps further:
 * 2 is the period before that, with the same like-for-like stretch.
 */
export function priorPeriod(kind: PeriodKind, from: Date, to: Date, now = new Date(), back = 1) {
  const pf =
    kind === "week"
      ? addDays(from, -7 * back)
      : kind === "month"
        ? new Date(from.getFullYear(), from.getMonth() - back, 1)
        : new Date(from.getFullYear() - back, 0, 1);
  const full = kind === "week" ? addDays(pf, 7) : kind === "month" ? new Date(pf.getFullYear(), pf.getMonth() + 1, 1) : new Date(pf.getFullYear() + 1, 0, 1);
  const partial = now >= from && now < to && addDays(startOfDay(now), 1).getTime() < to.getTime();
  if (!partial) return { from: pf, to: full, partial: false };
  const day = startOfDay(now);
  let end: Date;
  if (kind === "week") end = addDays(pf, Math.round((day.getTime() - from.getTime()) / 86400000) + 1);
  else if (kind === "month") end = new Date(pf.getFullYear(), pf.getMonth(), day.getDate() + 1);
  else end = new Date(pf.getFullYear(), day.getMonth(), day.getDate() + 1);
  return { from: pf, to: end.getTime() > full.getTime() ? full : end, partial: true };
}

/**
 * The window a weekday pattern reads: the 28 days before `to` or before today,
 * whichever is earlier. Exactly the last four completed occurrences of every
 * weekday; today (still going) and later days are never in it.
 */
export function patternWindow(to: Date, now = new Date()) {
  const today = startOfDay(now);
  const end = to.getTime() < today.getTime() ? to : today;
  return [addDays(end, -28), end] as const;
}
