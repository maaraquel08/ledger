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
  due: Date;
  /** what the card owes now: a hint, never the amount due (the Owner decides how much to pay) */
  owed: number;
  /** a transfer went into the card since its last due date */
  paid: boolean;
}

/**
 * A card reminder: a credit card whose due date the Owner set (spec 2026-11-14-card-reminders).
 * Due on that date, or once it has passed, the next time its day comes round (today counts).
 * Never overdue, Ledger can't see the statement. null = not a card, or no reminder.
 */
export function cardStatus(card: Account, entries: Entry[], today = new Date()): CardStatus | null {
  if (card.type !== "credit" || !card.dueDate) return null;
  // the date the Owner set while it's ahead; once past, the same day next time round
  const set = dueDayOf(card.dueDate);
  const day = set.getDate();
  const due = set >= startOfDay(today) ? set : parseDay(firstDue(day, today));
  const last = dayIn(due.getFullYear(), due.getMonth(), day, -1);
  const since = addDays(last, 1);
  // a payment is a move into the card (D-0007); an Adjustment or a stray credit isn't one
  const paid = entries.some((e) => e.accountId === card.id && e.amount > 0 && e.linkId != null && new Date(e.date) >= since);
  return { due, paid, owed: Math.max(0, card.balance) };
}

export type Upcoming =
  | ({ kind: "subscription"; id: string; name: string; amount: number; accountId: string | null; sub: Subscription } & SubscriptionStatus)
  | ({ kind: "card"; id: string; name: string; accountId: string; overdue: false; daysLate: 0 } & CardStatus);

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
    if (c) items.push({ kind: "card", id: a.id, name: a.name, accountId: a.id, overdue: false, daysLate: 0, ...c });
  }
  return items.sort((a, b) => Number(settled(a)) - Number(settled(b)) || a.due.getTime() - b.due.getTime() || a.name.localeCompare(b.name));
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
      ...(entry ? { entry, paidFrom: entry.accountId } : {}),
      actionable: i === list.length,
    });
  }

  for (const card of s.accounts) {
    const now = cardStatus(card, s.entries, today);
    if (!now) continue;
    const day = now.due.getDate();
    // the current due date and every month after it, and last month's while it is past and in this month:
    // the first month the Owner tracks is the one the reminder was set in (Owner, 2026-11-14)
    const k = monthsBetween(now.due, new Date(y, m, 1));
    let due = k >= 0 ? dayIn(y, m, day) : null;
    if (k === -1) {
      const prev = dayIn(now.due.getFullYear(), now.due.getMonth(), day, -1);
      if (prev < t && prev.getFullYear() === y && prev.getMonth() === m) due = prev;
    }
    if (!due) continue;
    const since = addDays(dayIn(due.getFullYear(), due.getMonth(), day, -1), 1);
    const until = addDays(due, 1);
    const ins = s.entries.filter((e) => e.accountId === card.id && e.amount > 0 && e.linkId != null && new Date(e.date) >= since && new Date(e.date) < until);
    const entry = ins.sort((a, b) => b.date.localeCompare(a.date))[0];
    const current = due.getTime() === now.due.getTime();
    put({
      key: `card:${card.id}:${localDay(due)}`,
      kind: "card",
      id: card.id,
      name: card.name,
      due,
      status: entry ? "paid" : "due",
      amount: entry ? entry.amount : null,
      ...(current ? { owed: now.owed } : {}),
      ...(entry ? { entry, paidFrom: s.entries.find((x) => x.linkId === entry.linkId && x.id !== entry.id)?.accountId ?? null } : {}),
      actionable: current && !entry,
    });
  }
  for (const list of out.values()) list.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return out;
}
