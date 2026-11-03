import { SPEND_CATEGORIES } from "./providers";
import type { Category, CategoryDef, CategoryKind, LedgerState } from "./types";

export type { CategoryDef, CategoryKind };

/** Never renamed, deleted or added: they carry meaning the app relies on (moves, adjustments, the fallback). */
export const SYSTEM_CATEGORIES: Category[] = ["Transfer", "Investments", "Adjustment", "Other"];

/** Bills that arrive once a month on a schedule. */
export const FIXED_BUILT_INS: Category[] = ["Rent & bills", "Subscriptions"];
/** Paid from the month's pool rather than today's allowance (fixed bills, plus these two). */
export const MONTHLY_BUILT_INS: Category[] = [...FIXED_BUILT_INS, "Groceries", "Household"];

export const MAX_CATEGORY_NAME = 32;

/** What a ledger has until the Owner changes it: today's built-ins, in today's order. */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  ...SPEND_CATEGORIES.filter((c) => !SYSTEM_CATEGORIES.includes(c)).map((name): CategoryDef => ({ name, kind: "expense" })),
  { name: "Salary", kind: "income" },
  { name: "Income", kind: "income" },
];

/** Same cap as add_category on the server. */
export const MAX_CATEGORIES = 50;

export const userCategories = (s: Pick<LedgerState, "categories">): CategoryDef[] => s.categories ?? DEFAULT_CATEGORIES;

/** Expense categories in the Owner's order, "Other" always last. */
export const spendCategories = (s: Pick<LedgerState, "categories">): Category[] => [
  ...userCategories(s)
    .filter((d) => d.kind === "expense" && !SYSTEM_CATEGORIES.includes(d.name))
    .map((d) => d.name),
  "Other",
];

export const incomeCategories = (s: Pick<LedgerState, "categories">): Category[] =>
  userCategories(s)
    .filter((d) => d.kind === "income" && !SYSTEM_CATEGORIES.includes(d.name))
    .map((d) => d.name);

/** Fixed bills: not paced against the month. */
export const fixedCategories = (s: Pick<LedgerState, "categories">): Category[] =>
  userCategories(s)
    .filter((d) => d.kind === "expense" && (d.fixed ?? FIXED_BUILT_INS.includes(d.name)))
    .map((d) => d.name);

/** Categories paid from the month's pool, not today's allowance. */
export const monthlyCategories = (s: Pick<LedgerState, "categories">): Category[] =>
  userCategories(s)
    .filter((d) => d.kind === "expense" && (d.monthly ?? d.fixed ?? MONTHLY_BUILT_INS.includes(d.name)))
    .map((d) => d.name);

/** Why a name can't be used (null = fine). `except` is the category being renamed: its own name is allowed. */
export function categoryNameError(name: string, defs: CategoryDef[], except?: Category): string | null {
  const n = name.trim();
  if (!n) return "Give it a name.";
  if (n.length > MAX_CATEGORY_NAME) return `Keep it under ${MAX_CATEGORY_NAME} characters.`;
  const key = n.toLowerCase();
  if ([...SYSTEM_CATEGORIES, "Unallocated", "Unfiled", "Everything else"].some((c) => c.toLowerCase() === key)) return `“${n}” is used by the app. Pick another name.`;
  if (defs.some((d) => d.name !== except && d.name.toLowerCase() === key)) return `You already have “${n}”.`;
  if (except === undefined && defs.length >= MAX_CATEGORIES) return `You can have up to ${MAX_CATEGORIES} categories.`;
  return null;
}

/** A per-category map with one key renamed (budgets, % budgets). */
export function renameKey<T>(m: Partial<Record<Category, T>>, from: Category, to: Category): Partial<Record<Category, T>> {
  if (!(from in m)) return m;
  const { [from]: v, ...rest } = m;
  return { ...rest, [to]: v };
}

/** A per-category map without one key. */
export function dropKey<T>(m: Partial<Record<Category, T>>, key: Category): Partial<Record<Category, T>> {
  const { [key]: _gone, ...rest } = m;
  return rest;
}
