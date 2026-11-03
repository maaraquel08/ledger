import { fixedCategories } from "../categories";
import { colorCategories, categoryColors, EVERYTHING_ELSE, VIZ_OTHER } from "../chart-colors";
import { isSpend, totals, spendParts } from "../selectors";
import type { Entry, LedgerState } from "../types";

type S = Pick<LedgerState, "entries" | "categories" | "profile">;

export interface DonutSegment {
  key: string;
  label: string;
  amount: number;
  /** share of the period's spending, 0–100 (not rounded) */
  pct: number;
  color: string;
}

/**
 * Spending by category for the entries given. Categories holding a colour slot (colorCategories)
 * that have spend keep their own segment in slot order; everything else folds into "Everything else".
 * Splits count per part; refunds and transfers/investments are not spend (isSpend).
 */
export function donutSegments(list: Entry[], state: S): DonutSegment[] {
  const slots = colorCategories(state);
  const color = categoryColors(state);
  const by = new Map<string, number>();
  let other = 0;
  let total = 0;
  for (const e of list) {
    if (!isSpend(e)) continue;
    for (const p of spendParts(e)) {
      total += p.amount;
      if (slots.includes(p.category)) by.set(p.category, (by.get(p.category) ?? 0) + p.amount);
      else other += p.amount;
    }
  }
  if (total <= 0) return [];
  const out: DonutSegment[] = slots
    .filter((c) => (by.get(c) ?? 0) > 0)
    .map((c) => ({ key: c, label: c, amount: by.get(c)!, pct: (by.get(c)! / total) * 100, color: color(c) }));
  if (other > 0) out.push({ key: EVERYTHING_ELSE, label: EVERYTHING_ELSE, amount: other, pct: (other / total) * 100, color: VIZ_OTHER });
  return out;
}

export interface IncomePart {
  key: "bills" | "everyday" | "invested" | "saved" | "overspent";
  label: string;
  amount: number;
  /** share of income, 0–100 (not rounded) */
  pct: number;
  /** share of the bar's width, 0–1 (0 = legend only) */
  fraction: number;
  color: string;
}

export interface IncomeSplitResult {
  income: number;
  parts: IncomePart[];
  /** income − bills − everyday − invested; negative = overspent */
  saved: number;
  overspent: boolean;
}

/**
 * Where the period's income went. Bills = spend in fixed categories; Everyday = all other spend;
 * Invested = negative "Investments" legs on accounts that are NOT investment accounts (cash that left
 * for investing; the matching positive leg on the brokerage is ignored so it is counted once);
 * Saved = what is left. If that is negative the bar is scaled to total outflow and an "Overspent"
 * part replaces Saved. Income 0 → no parts.
 */
export function incomeSplit(list: Entry[], state: S & Pick<LedgerState, "accounts">): IncomeSplitResult {
  const income = totals(list).in;
  const fixed = fixedCategories(state);
  let bills = 0;
  let everyday = 0;
  let invested = 0;
  const investAcc = new Set(state.accounts.filter((a) => a.type === "investments").map((a) => a.id));
  for (const e of list) {
    if (isSpend(e)) {
      for (const p of spendParts(e)) {
        if (fixed.includes(p.category)) bills += p.amount;
        else everyday += p.amount;
      }
    } else if (e.category === "Investments" && e.amount < 0 && !(e.accountId && investAcc.has(e.accountId))) {
      invested += -e.amount;
    }
  }
  const saved = income - bills - everyday - invested;
  const overspent = saved < 0;
  if (income <= 0) return { income, parts: [], saved, overspent };
  // overspent: the bar is the total outflow and the shortfall is a legend-only part (fraction 0)
  const base = overspent ? income - saved : income;
  const mk = (key: IncomePart["key"], label: string, amount: number, color: string): IncomePart => ({
    key, label, amount, pct: (amount / income) * 100, fraction: amount / base, color,
  });
  const parts = [
    mk("bills", "Bills", bills, FLOW.bills),
    mk("everyday", "Everyday spending", everyday, FLOW.everyday),
    mk("invested", "Invested", invested, FLOW.invested),
  ].filter((p) => p.amount > 0);
  if (overspent) parts.push({ ...mk("overspent", "Overspent", -saved, "var(--color-danger)"), fraction: 0 });
  else if (saved > 0) parts.push(mk("saved", "Saved", saved, FLOW.saved));
  return { income, parts, saved, overspent };
}

/**
 * Money-flow parts share one neutral ink ramp (dark → light), so the category hues on the
 * same page only ever mean categories; Saved is income kept, in the trend chart's income green.
 */
export const FLOW = {
  bills: "color-mix(in oklab, var(--color-fg) 90%, var(--color-bg))",
  everyday: "color-mix(in oklab, var(--color-fg) 55%, var(--color-bg))",
  invested: "color-mix(in oklab, var(--color-fg) 28%, var(--color-bg))",
  saved: "var(--color-chart-in)",
} as const;
