import { fixedCategories } from "./categories";
import { startOfDay } from "./format";
import { budgetPace, byCategory, inRange, isIncome, monthBounds, monthBudget } from "./selectors";
import type { Category, Entry, LedgerState } from "./types";

/*
 * Pure numbers behind the Budget tab: one row for every spending category (spent, budget,
 * left or over, pace), the allocation of the monthly budget, and a category's month history.
 * Spend uses the app-wide definition (selectors.byCategory: split receipts count per part).
 */

export interface BudgetRow {
  category: Category;
  spent: number;
  /** 0 = no budget set */
  budget: number;
  /** budget - spent (negative when over); 0 with no budget */
  left: number;
  status: "none" | "ok" | "ahead" | "over";
  /** share of the budget used, 0..1 (capped); 0 with no budget */
  fraction: number;
  /** bills land on a date, so they get no pace marker */
  paced: boolean;
}

/** Share of the month gone: today's pace for the current month, 1 for a month that has ended. */
export function monthPace(s: LedgerState, at: Date, now: Date): number {
  const [from, to] = monthBounds(at);
  const current = now >= from && now < to;
  return current ? budgetPace(monthBudget(s, now), now) : 1;
}

export function budgetRows(s: LedgerState, cats: Category[], at: Date, now: Date = new Date()): BudgetRow[] {
  const [from, to] = monthBounds(at);
  const spentBy = new Map(byCategory(inRange(s.entries, from, to)));
  const pace = monthPace(s, at, now);
  const fixed = fixedCategories(s);
  return cats.map((category) => {
    const spent = Math.round(spentBy.get(category) ?? 0);
    const budget = s.profile.categoryBudgets[category] ?? 0;
    const paced = !fixed.includes(category);
    if (!(budget > 0)) return { category, spent, budget: 0, left: 0, status: "none", fraction: 0, paced };
    const status = spent > budget ? "over" : paced && pace < 1 && spent > budget * pace ? "ahead" : "ok";
    return { category, spent, budget, left: budget - spent, status, fraction: Math.min(1, spent / budget), paced };
  });
}

/** What the category budgets add up to against the month's full budget. */
export function allocation(s: LedgerState, cats: Category[]) {
  const allocated = cats.reduce((n, c) => n + Math.max(0, s.profile.categoryBudgets[c] ?? 0), 0);
  const total = s.profile.monthlyBudget || monthBudget(s).full;
  return { allocated, total, unallocated: Math.max(0, total - allocated), over: Math.max(0, allocated - total) };
}

const spentOf = (entries: Entry[], cat: Category, from: Date, to: Date) =>
  Math.round(byCategory(inRange(entries, from, to)).find(([c]) => c === cat)?.[1] ?? 0);

/** This month, last month, and the average of the three full months before this one. */
export function categoryHistory(entries: Entry[], cat: Category, at: Date) {
  const m = (back: number) => monthBounds(new Date(at.getFullYear(), at.getMonth() - back, 1));
  const [f0, t0] = monthBounds(at);
  const prior = [1, 2, 3].map((b) => spentOf(entries, cat, ...m(b)));
  return { thisMonth: spentOf(entries, cat, f0, t0), lastMonth: prior[0], avg3: Math.round(prior.reduce((a, b) => a + b, 0) / 3) };
}

/** Income received per category in a month. */
export function receivedBy(entries: Entry[], at: Date): Map<Category, number> {
  const [from, to] = monthBounds(at);
  const m = new Map<Category, number>();
  for (const e of inRange(entries, from, to)) if (isIncome(e) && e.category) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  return m;
}

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const lastDayOf = (d: Date) => startOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
