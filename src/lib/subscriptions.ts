import { addDays, localDay, startOfDay } from "./format";
import type { Account, Entry, LedgerState, Subscription } from "./types";

/*
 * Subscriptions and card bills: what's due next. Nothing here is stored. A month is paid when
 * an entry looks like its payment (spec 2026-11-14-subscriptions), so a payment logged any
 * way (typed, voice, receipt, Mark paid, the server's capture) counts, and deleting it un-pays.
 */

/** an entry may land up to this many days before the first due date and still pay it */
export const EARLY_DAYS = 10;

/** "YYYY-MM-DD" as local midnight */
export const parseDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** `day` of the month `offset` months after (year, month), clamped to that month's end */
function dayIn(year: number, month: number, day: number, offset = 0) {
  const end = new Date(year, month + offset + 1, 0).getDate();
  return new Date(year, month + offset, Math.min(day, end));
}

/** The `index`-th due date of a subscription, counting from startsOn's month. */
export function dueOn(sub: Pick<Subscription, "day" | "startsOn">, index: number): Date {
  const s = parseDay(sub.startsOn);
  return dayIn(s.getFullYear(), s.getMonth(), sub.day, index);
}

/** The first date on `day` of the month that is today or later, as "YYYY-MM-DD". */
export function firstDue(day: number, today = new Date()): string {
  const t = startOfDay(today);
  const d = dayIn(t.getFullYear(), t.getMonth(), day);
  return localDay(d < t ? dayIn(t.getFullYear(), t.getMonth(), day, 1) : d);
}

/** Spending that could pay a bill: not a move, a refund, an Adjustment or a Review draft. */
const isSpend = (e: Entry) => e.amount < 0 && !e.refunded && e.linkId == null && e.status !== "review" && e.category !== "Adjustment";

/** The subscription's name in the entry's words, or the entry's words inside the name ("Apple" pays "Apple One"). */
function sameName(sub: Subscription, e: Entry) {
  const name = sub.name.trim().toLowerCase();
  if (!name) return false;
  const words = [e.desc, e.raw ?? ""].map((w) => w.trim().toLowerCase());
  return words.some((w) => w.includes(name) || (w.length >= 3 && name.includes(w)));
}

/** within 50–150% of the amount, the band the server's recurring_missed uses */
const closeAmount = (sub: Subscription, e: Entry) => Math.abs(e.amount) >= sub.amount * 0.5 && Math.abs(e.amount) <= sub.amount * 1.5;

export function pays(sub: Subscription, e: Entry): boolean {
  return isSpend(e) && sameName(sub, e) && closeAmount(sub, e) && new Date(e.date) >= addDays(parseDay(sub.startsOn), -EARLY_DAYS);
}

/**
 * Each subscription's payments, oldest first. An entry pays one subscription only: the one
 * with the longest matching name ("Apple One" before "Apple"), then the lowest id.
 */
export function payments(subs: Subscription[], entries: Entry[]): Map<string, Entry[]> {
  const ranked = [...subs].sort((a, b) => b.name.trim().length - a.name.trim().length || a.id.localeCompare(b.id));
  const out = new Map<string, Entry[]>(subs.map((s) => [s.id, []]));
  for (const e of entries) {
    const sub = ranked.find((s) => pays(s, e));
    if (sub) out.get(sub.id)!.push(e);
  }
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export interface SubscriptionStatus {
  /** the first month not yet paid: each payment moves it one month on */
  due: Date;
  overdue: boolean;
  /** days past `due` (0 when not overdue) */
  daysLate: number;
  paid: Entry[];
}

export function subscriptionStatus(sub: Subscription, paid: Entry[], today = new Date()): SubscriptionStatus {
  const due = dueOn(sub, paid.length);
  const t = startOfDay(today);
  const daysLate = Math.max(0, Math.round((t.getTime() - due.getTime()) / 86_400_000));
  return { due, overdue: daysLate > 0, daysLate, paid };
}

export interface CardStatus {
  due: Date;
  /** a transfer went into the card since its last due date */
  paid: boolean;
}

/**
 * A credit card's bill: due on its due date, or once that has passed, the next time its day
 * comes round (today counts).
 * Never overdue, Ledger can't see the statement. null = no due date or nothing owed.
 */
export function cardStatus(card: Account, entries: Entry[], today = new Date()): CardStatus | null {
  if (card.type !== "credit" || !card.dueDate || card.balance <= 0) return null;
  // the date the Owner set while it's ahead; once past, the same day next time round
  const set = startOfDay(new Date(card.dueDate));
  const day = set.getDate();
  const due = set >= startOfDay(today) ? set : parseDay(firstDue(day, today));
  const last = dayIn(due.getFullYear(), due.getMonth(), day, -1);
  const since = addDays(last, 1);
  // a payment is a move into the card (D-0007); an Adjustment or a stray credit isn't one
  const paid = entries.some((e) => e.accountId === card.id && e.amount > 0 && e.linkId != null && new Date(e.date) >= since);
  return { due, paid };
}

export type Upcoming =
  | ({ kind: "subscription"; id: string; name: string; amount: number; accountId: string | null; sub: Subscription } & SubscriptionStatus)
  | ({ kind: "card"; id: string; name: string; amount: number; accountId: string; overdue: false; daysLate: 0 } & CardStatus);

const settled = (u: Upcoming) => u.kind === "card" && u.paid;

/** Everything due, overdue first, then by date; paid cards last. */
export function upcoming(s: Pick<LedgerState, "subscriptions" | "accounts" | "entries">, today = new Date()): Upcoming[] {
  const subs = s.subscriptions ?? [];
  const paid = payments(subs, s.entries);
  const items: Upcoming[] = subs.map((sub) => ({
    kind: "subscription",
    id: sub.id,
    name: sub.name,
    amount: sub.amount,
    accountId: sub.accountId,
    sub,
    ...subscriptionStatus(sub, paid.get(sub.id) ?? [], today),
  }));
  for (const a of s.accounts) {
    const c = cardStatus(a, s.entries, today);
    if (c) items.push({ kind: "card", id: a.id, name: a.name, amount: a.balance, accountId: a.id, overdue: false, daysLate: 0, ...c });
  }
  return items.sort((a, b) => Number(settled(a)) - Number(settled(b)) || a.due.getTime() - b.due.getTime() || a.name.localeCompare(b.name));
}

/** What's still to pay by `days` from today, overdue included (paid cards aren't). */
export function dueWithin(items: Upcoming[], days: number, today = new Date()): number {
  const by = addDays(startOfDay(today), days);
  return items.filter((u) => !settled(u) && u.due <= by).reduce((t, u) => t + u.amount, 0);
}
