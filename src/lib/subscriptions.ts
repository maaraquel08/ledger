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

/**
 * A card's due date as local midnight. Stored as "YYYY-MM-DD" (accounts.due_date); an older
 * ISO datetime is read in local time. new Date("YYYY-MM-DD") would be UTC and land a day early
 * west of Greenwich, and writing local midnight as ISO lands a day early east of it (PH).
 */
export const dueDayOf = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? parseDay(iso) : startOfDay(new Date(iso)));

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
  /** the earliest due date not yet paid (it can be past: cards are never overdue, it just waits) */
  due: Date;
  /** that due date's index from the card's first one */
  index: number;
  /** what the card owes now: a hint, never the amount due (the Owner decides how much to pay) */
  owed: number;
}

/** The card's `k`-th due date, counting from its first: the stored due date (spec 2026-11-14-card-payments). */
export function cardDueOn(card: Pick<Account, "dueDate">, k: number): Date {
  const first = dueDayOf(card.dueDate!);
  return dayIn(first.getFullYear(), first.getMonth(), first.getDate(), k);
}

/** The due date in the month `today` is in, for `day`, as "YYYY-MM-DD" (past or not): a new reminder's first. */
export function dueThisMonth(day: number, today = new Date()): string {
  return localDay(dayIn(today.getFullYear(), today.getMonth(), day));
}

/**
 * Which due date each payment into a card settles. A payment is a move into the card (D-0007;
 * an Adjustment or a stray credit isn't one), counted from the day after the month before the
 * first due date. Oldest first, each goes to the earliest unpaid due date if one is behind its own,
 * else to its own (the one it lands on or before), so several payments in a month add up there.
 * `next` is the earliest due date still unpaid.
 */
export function cardPayments(card: Account, entries: Entry[]): { paid: Entry[][]; next: number } {
  const from = addDays(cardDueOn(card, -1), 1);
  const ins = entries
    .filter((e) => e.accountId === card.id && e.amount > 0 && e.linkId != null && new Date(e.date) >= from)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = dueDayOf(card.dueDate!);
  const paid: Entry[][] = [];
  let next = 0;
  for (const e of ins) {
    const day = startOfDay(new Date(e.date));
    let own = Math.max(0, monthsBetween(first, day));
    if (day > cardDueOn(card, own)) own++;
    const k = next < own ? next : own;
    (paid[k] ??= []).push(e);
    while (paid[next]?.length) next++;
  }
  return { paid, next };
}

/**
 * A card reminder: a credit card whose first due date the Owner set (spec 2026-11-14-card-payments).
 * Due on the earliest due date not yet paid. null = not a card, or no reminder.
 */
export function cardStatus(card: Account, entries: Entry[]): CardStatus | null {
  if (card.type !== "credit" || !card.dueDate) return null;
  const { next } = cardPayments(card, entries);
  return { due: cardDueOn(card, next), index: next, owed: Math.max(0, card.balance) };
}

export type Upcoming =
  | ({ kind: "subscription"; id: string; name: string; amount: number; accountId: string | null; sub: Subscription } & SubscriptionStatus)
  | ({ kind: "card"; id: string; name: string; accountId: string; overdue: false; daysLate: 0 } & CardStatus);

/** Everything due, by date (overdue and unpaid card months first). */
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
    const c = cardStatus(a, s.entries);
    if (c) items.push({ kind: "card", id: a.id, name: a.name, accountId: a.id, overdue: false, daysLate: 0, ...c });
  }
  return items.sort((a, b) => a.due.getTime() - b.due.getTime() || a.name.localeCompare(b.name));
}

/** Subscriptions still to pay by `days` from today, overdue included. Cards have no amount to add. */
export function dueWithin(items: Upcoming[], days: number, today = new Date()): number {
  const by = addDays(startOfDay(today), days);
  return items.reduce((t, u) => (u.kind === "subscription" && u.due <= by ? t + u.amount : t), 0);
}

/* ---------- the calendar: every due date in a month (spec 2026-11-14-calendar-due) ---------- */

export interface DueItem {
  key: string;
  kind: "subscription" | "card";
  id: string;
  name: string;
  due: Date;
  /** cards are never overdue */
  status: "paid" | "due" | "overdue";
  /** paid: what was paid; a subscription still due: its amount; a card still due: null */
  amount: number | null;
  /** a card's current due date only: what it owes now, a hint */
  owed?: number;
  /** paid: the entry that paid it (for a card, the leg into the card) */
  entry?: Entry;
  /** paid: the account the money came from */
  paidFrom?: string | null;
  /** paid: every entry that paid it, oldest first (a card can be paid in parts) */
  payments?: Entry[];
  /** the one due date Mark paid / Pay acts on (the earliest unpaid one) */
  actionable: boolean;
}

const monthsBetween = (a: Date, b: Date) => (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();

/** Every subscription and card due date in the month `month` falls in, by day of the month. */
export function dueInMonth(s: Pick<LedgerState, "subscriptions" | "accounts" | "entries">, month: Date, today = new Date()): Map<number, DueItem[]> {
  const out = new Map<number, DueItem[]>();
  const put = (it: DueItem) => out.set(it.due.getDate(), [...(out.get(it.due.getDate()) ?? []), it]);
  const y = month.getFullYear();
  const m = month.getMonth();
  const t = startOfDay(today);

  const subs = s.subscriptions ?? [];
  const paid = payments(subs, s.entries);
  for (const sub of subs) {
    const i = monthsBetween(parseDay(sub.startsOn), new Date(y, m, 1));
    if (i < 0) continue;
    const due = dueOn(sub, i);
    const list = paid.get(sub.id) ?? [];
    const entry = list[i];
    put({
      key: `subscription:${sub.id}:${localDay(due)}`,
      kind: "subscription",
      id: sub.id,
      name: sub.name,
      due,
      status: entry ? "paid" : due < t ? "overdue" : "due",
      amount: entry ? Math.abs(entry.amount) : sub.amount,
      ...(entry ? { entry, payments: [entry], paidFrom: entry.accountId } : {}),
      actionable: i === list.length,
    });
  }

  for (const card of s.accounts) {
    if (card.type !== "credit" || !card.dueDate) continue;
    const k = monthsBetween(dueDayOf(card.dueDate), new Date(y, m, 1));
    if (k < 0) continue;
    const due = cardDueOn(card, k);
    const { paid, next } = cardPayments(card, s.entries);
    const ins = paid[k] ?? [];
    const entry = ins.at(-1);
    put({
      key: `card:${card.id}:${localDay(due)}`,
      kind: "card",
      id: card.id,
      name: card.name,
      due,
      status: ins.length ? "paid" : "due",
      amount: ins.length ? ins.reduce((n, e) => n + e.amount, 0) : null,
      ...(k === next ? { owed: Math.max(0, card.balance) } : {}),
      ...(entry ? { entry, payments: ins, paidFrom: s.entries.find((x) => x.linkId === entry.linkId && x.id !== entry.id)?.accountId ?? null } : {}),
      actionable: k === next,
    });
  }
  for (const list of out.values()) list.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return out;
}
