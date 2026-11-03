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

/** Category → its color for every chart on the page. */
export function categoryColors(s: Pick<LedgerState, "entries">): (c: Category | typeof EVERYTHING_ELSE) => string {
  const top = byCategory(s.entries)
    .filter(([c]) => c !== "Unfiled")
    .slice(0, VIZ_SLOTS.length)
    .map(([c]) => c);
  const slot = new Map<string, string>(top.map((c, i) => [c, VIZ_SLOTS[i]]));
  return (c) => slot.get(c) ?? VIZ_OTHER;
}

/** Categories that keep their own slice/segment; the rest fold into Everything else. */
export function colorCategories(s: Pick<LedgerState, "entries">): Category[] {
  return byCategory(s.entries)
    .filter(([c]) => c !== "Unfiled")
    .slice(0, VIZ_SLOTS.length)
    .map(([c]) => c);
}
