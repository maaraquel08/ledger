import { startOfDay } from "../format";
import { periodBounds, shiftPeriod } from "../analytics";
import { isSpend, netWorth, spendParts, type PeriodKind } from "../selectors";
import type { Account, Entry, LedgerState } from "../types";

/** Pure math behind the Accounts charts: spending per account, and net worth over time. */

export interface AccountSpend {
  /** null = spending logged with no account (or an account since removed) */
  accountId: string | null;
  account: Account | null;
  amount: number;
  /** share of the period's spending, 0–100 */
  share: number;
}

/** Spending per account in `list`, biggest first. Same spend rules as everywhere (refunds and transfers excluded). */
export function spendByAccount(list: Entry[], accounts: Account[]): AccountSpend[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const sums = new Map<string | null, number>();
  let total = 0;
  for (const e of list) {
    if (!isSpend(e)) continue;
    const amt = spendParts(e).reduce((s, p) => s + p.amount, 0);
    const id = e.accountId && byId.has(e.accountId) ? e.accountId : null;
    sums.set(id, (sums.get(id) ?? 0) + amt);
    total += amt;
  }
  return [...sums.entries()]
    .map(([accountId, amount]) => ({ accountId, account: accountId ? byId.get(accountId)! : null, amount, share: total ? (amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

/** How many periods the net worth trend shows. */
export const NET_WORTH_STEPS: Record<PeriodKind, number> = { week: 8, month: 6, year: 5 };

export interface NetWorthPoint {
  /** start of the period this point closes */
  from: Date;
  /** the moment measured: the period's end, or now for the current one */
  at: Date;
  total: number;
  cash: number;
  invested: number;
  owed: number;
}

/** Balances as they stood at `at`: the current ones with every later entry undone (inverse of the store's applyBalance). */
export function accountsAt(accounts: Account[], entries: Entry[], at: Date): Account[] {
  const t = at.getTime();
  const undo = new Map<string, number>();
  for (const e of entries) {
    if (!e.accountId || e.refunded || new Date(e.date).getTime() <= t) continue;
    undo.set(e.accountId, (undo.get(e.accountId) ?? 0) + e.amount);
  }
  return accounts.map((a) => {
    const later = undo.get(a.id) ?? 0;
    // a credit balance is what you owe: spending raised it, so undoing it lowers it
    return { ...a, balance: a.type === "credit" ? a.balance + later : a.balance - later };
  });
}

/**
 * Net worth at the end of each of the last N periods up to the one starting at `from`
 * (today for the current period), never before the ledger's first entry.
 */
export function netWorthSeries(state: Pick<LedgerState, "accounts" | "entries">, kind: PeriodKind, from: Date, now = new Date()): NetWorthPoint[] {
  const first = state.entries.reduce((m, e) => Math.min(m, new Date(e.date).getTime()), now.getTime());
  const firstDay = startOfDay(new Date(first)).getTime();
  const out: NetWorthPoint[] = [];
  for (let i = NET_WORTH_STEPS[kind] - 1; i >= 0; i--) {
    const start = shiftPeriod(kind, from, -i);
    const end = periodBounds(kind, start)[1];
    if (start.getTime() > now.getTime()) continue;
    if (end.getTime() <= firstDay) continue;
    // the end of a period is the start of the next, so an entry on that instant belongs to the next
    const at = end.getTime() > now.getTime() ? now : new Date(end.getTime() - 1);
    const nw = netWorth(accountsAt(state.accounts, state.entries, at));
    out.push({ from: start, at, total: nw.total, cash: nw.cash, invested: nw.invested, owed: nw.credit });
  }
  return out;
}
