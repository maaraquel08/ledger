import { SPEND_CATEGORIES } from "./providers";
import type { Category } from "./types";

/* ---------- what an entry can file into, and amounts worth a second look --- */

export const INCOME_CATEGORIES: Category[] = ["Salary", "Income"];
/** Categories that only make sense as a move (two linked legs) or a confirmed Adjustment. */
const MOVE_CATEGORIES: (Category | null)[] = ["Transfer", "Investments", "Adjustment"];

/**
 * The categories a lone entry may take on edit: spend categories for money out,
 * income categories for money in. Never Transfer or Investments (that would be a
 * one-legged move); an entry that already has one keeps it as an option.
 */
export function categoriesFor(sign: 1 | -1, current: Category | null): Category[] {
  const base = sign > 0 ? INCOME_CATEGORIES : SPEND_CATEGORIES;
  return current && !base.includes(current) && MOVE_CATEGORIES.includes(current) ? [...base, current] : base;
}

/** An entry whose category can't change on its own: a leg of a move, or an Adjustment. */
export const fixedCategory = (e: { linkId?: string; category: Category | null }) => e.linkId != null || e.category === "Adjustment";

export const BIG_AMOUNT = 100_000;

/**
 * Worth a "That's ₱X — is that right?" before saving: over ₱100,000, or more
 * than three times the largest entry already filed in that category.
 */
export function isUnusualAmount(amount: number, category: Category | null, entries: { amount: number; category: Category | null }[]) {
  const abs = Math.abs(amount);
  if (abs > BIG_AMOUNT) return true;
  if (!category) return false;
  let largest = 0;
  for (const e of entries) if (e.category === category) largest = Math.max(largest, Math.abs(e.amount));
  return largest > 0 && abs > largest * 3;
}

/**
 * Only a plain expense can be refunded: money out, not a leg of a move, filed as
 * spending (or not filed yet), never an Adjustment. Refunding a move leg would put
 * money back on one side while the other side keeps it. Mirrored by SQL mark_refunded.
 */
export const canRefund = (e: { amount: number; linkId?: string | null; category: Category | null }) =>
  e.amount < 0 && e.linkId == null && !MOVE_CATEGORIES.includes(e.category);
