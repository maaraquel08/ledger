import { addDays, sameDay, startOfDay } from "./format";
import { FIXED, inRange, isSpend, monthBounds, monthlyIncome, spendParts, suggestedBudget } from "./selectors";
import type { Category } from "./types";
import type { LedgerState } from "./types";

/**
 * Today's number. The month's budget left at the start of today, spread
 * over the days remaining, minus what today has already spent. Bills land
 * on a date, not a habit, and groceries come from the monthly budget —
 * so neither touches today; both come out of the pool from tomorrow.
 */
const MONTHLY: Category[] = [...FIXED, "Groceries", "Household"];

export function todayBudget(s: LedgerState, now = new Date()) {
  const budget = s.profile.monthlyBudget || suggestedBudget(monthlyIncome(s));
  if (!budget) return { hasBudget: false as const };
  const [from, to] = monthBounds(now);
  const today = startOfDay(now);
  const month = inRange(s.entries, from, to).filter(isSpend);
  const before = month.filter((e) => new Date(e.date) < today).reduce((n, e) => n - e.amount, 0);
  const todays = month.filter((e) => sameDay(new Date(e.date), now));
  const spentToday = todays
    .flatMap(spendParts)
    .filter((p) => !MONTHLY.includes(p.category))
    .reduce((n, p) => n + p.amount, 0);
  const daysLeft = Math.round((to.getTime() - today.getTime()) / 86400000);
  const allowance = Math.max(0, (budget - before) / Math.max(1, daysLeft));
  const left = Math.round(allowance - spentToday);
  const spentAll = month.reduce((n, e) => n - e.amount, 0);
  const tomorrow = daysLeft > 1 ? Math.max(0, Math.round((budget - spentAll) / (daysLeft - 1))) : 0;
  return {
    hasBudget: true as const,
    budget,
    left,
    allowance: Math.round(allowance),
    tomorrow,
    tomorrowDate: addDays(today, 1),
    // the rows The math shows — the same formula as the number it explains
    spentBefore: Math.round(before),
    spentToday: Math.round(spentToday),
    daysLeft: Math.max(1, daysLeft),
  };
}
