import { SPEND_CATEGORIES } from "./providers";
import type { Account, Category, Entry } from "./types";

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

/* ---------- moves: transfers and investments (D-0007, D-0010) ------------ */

/** Money leaving a cash, bank, wallet or investments account can't take it below zero; a card is exempt. */
export const overdraws = (from: Pick<Account, "type" | "balance">, amount: number) => from.type !== "credit" && amount > from.balance;

/**
 * The two linked legs of a move from one account to another. Money into an
 * investments account files as Investments (D-0010); any other move is a Transfer.
 * Same linkId on both; the legs sum to zero.
 */
export function moveLegs(o: {
  from: Pick<Account, "id" | "name">;
  to: Pick<Account, "id" | "name" | "type">;
  amount: number;
  date: string;
  newId: (prefix: string) => string;
  /** what the Owner called it; both legs share it */
  desc?: string;
  queued?: boolean;
}): Entry[] {
  const category: Category = o.to.type === "investments" ? "Investments" : "Transfer";
  const linkId = o.newId("l");
  const base = { category, date: o.date, linkId, ...(o.queued ? { queued: true } : {}) };
  return [
    { ...base, id: o.newId("e"), desc: o.desc || `${category === "Investments" ? "Invest in" : "Transfer to"} ${o.to.name}`, accountId: o.from.id, amount: -o.amount },
    { ...base, id: o.newId("e"), desc: o.desc || `${category === "Investments" ? "Invested from" : "Transfer from"} ${o.from.name}`, accountId: o.to.id, amount: o.amount },
  ];
}

/**
 * Entries once their account is gone (removed locally, archived in the cloud). A leg of a move
 * goes with its account; the twin on a surviving account stays as a plain entry (the money did
 * leave or arrive there), so no balance moves and nothing orphans. Other entries fall into the
 * review queue with no account rather than pointing nowhere.
 */
export function detachAccounts(entries: Entry[], gone: (accountId: string) => boolean): Entry[] {
  const isGone = (e: Entry) => e.accountId != null && gone(e.accountId);
  const goneLinks = new Set(entries.filter((e) => isGone(e) && e.linkId != null).map((e) => e.linkId));
  const out: Entry[] = [];
  for (const e of entries) {
    if (isGone(e) && e.linkId != null) continue;
    if (e.linkId != null && goneLinks.has(e.linkId)) {
      const { linkId: _drop, ...plain } = e;
      out.push(plain);
    } else out.push(isGone(e) ? { ...e, accountId: null } : e);
  }
  return out;
}
