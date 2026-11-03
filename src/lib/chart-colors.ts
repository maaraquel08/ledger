import { byCategory } from "./selectors";
import type { Category, LedgerState } from "./types";

/**
 * Categorical slots for composition charts (tokens --viz-1…6 in the brand layer, validated
 * with the dataviz skill). Color follows the category, never its rank in one period: the six
 * categories with the most spending across the whole ledger get a slot each, for good, and
 * everything else is the neutral --viz-other. So Food stays blue in every month and chart.
 */
export const VIZ_SLOTS = ["var(--color-viz-1)", "var(--color-viz-2)", "var(--color-viz-3)", "var(--color-viz-4)", "var(--color-viz-5)", "var(--color-viz-6)"] as const;
export const VIZ_OTHER = "var(--color-viz-other)";
/** Label for the folded remainder. */
export const EVERYTHING_ELSE = "Everything else";

/**
 * The categories that own a color, in slot order: budgeted ones first (largest budget first),
 * because the Budget tab's plan bar is where telling them apart matters most, then the biggest
 * spenders across the whole ledger. Same answer on every page, so a category keeps one color.
 */
export function colorCategories(s: Pick<LedgerState, "entries" | "profile">): Category[] {
  const budgeted = Object.entries(s.profile.categoryBudgets)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([c]) => c);
  const spenders = byCategory(s.entries)
    .map(([c]) => c)
    .filter((c) => c !== "Unfiled" && !budgeted.includes(c));
  return [...budgeted, ...spenders].slice(0, VIZ_SLOTS.length);
}

/** Category → its color for every chart on every page; the rest share --viz-other. */
export function categoryColors(s: Pick<LedgerState, "entries" | "profile">): (c: Category | typeof EVERYTHING_ELSE) => string {
  const slot = new Map<string, string>(colorCategories(s).map((c, i) => [c, VIZ_SLOTS[i]]));
  return (c) => slot.get(c) ?? VIZ_OTHER;
}
