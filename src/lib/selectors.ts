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

/** The verdict: what you can spend per day for the rest of the month. */
export function verdict(s: LedgerState, today = new Date()) {
  const [from, to] = monthBounds(today);
  const month = inRange(s.entries, from, to);
  const t = totals(month);
  const budget = s.profile.monthlyBudget || suggestedBudget(monthlyIncome(s));
  const left = budget - t.out;
  const daysInMonth = Math.round((to.getTime() - from.getTime()) / 86400000);
  const daysLeft = Math.max(1, daysInMonth - today.getDate() + 1);
  const perDay = Math.max(0, Math.floor(left / daysLeft));

  const [pf, pt] = monthBounds(new Date(today.getFullYear(), today.getMonth() - 1, 15));
  const prev = totals(inRange(s.entries, pf, pt));
  const prevDays = Math.round((pt.getTime() - pf.getTime()) / 86400000);
  const prevPerDay = Math.max(0, Math.floor((budget - prev.out * (today.getDate() / prevDays)) / daysLeft));

  const over = byCategory(month)
    .map(([c, v]) => ({ category: c, spent: v, budget: s.profile.categoryBudgets[c] ?? 0 }))
    // fixed costs land on a date, not a pace — only discretionary spend is paced
    .filter((x) => x.budget > 0 && !FIXED.includes(x.category))
    .map((x) => ({ ...x, delta: x.spent - x.budget * (today.getDate() / daysInMonth) }))
    .sort((a, b) => b.delta - a.delta);

  const income = month.filter(isIncome);
  const savedRate = t.in > 0 ? Math.round((t.net / t.in) * 100) : 0;

  return { budget, spent: t.out, left, daysLeft, daysInMonth, perDay, prevPerDay, worst: over[0], income, savedRate, totals: t };
}

export function entriesOnDay(entries: Entry[], d: Date) {
  return entries.filter((e) => sameDay(new Date(e.date), d));
}

/** Distinct days with at least one entry. */
export function daysLogged(entries: Entry[]) {
  return new Set(entries.map((e) => e.date.slice(0, 10))).size;
}

export function accountLabel(a: Account | undefined) {
  if (!a) return "ACCOUNT?";
  return `${a.providerLabel.toUpperCase()}${a.last4 ? ` ·${a.last4}` : ""}`;
}
