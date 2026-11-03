import { periodBounds, shiftPeriod } from "../analytics";
import { colorCategories, EVERYTHING_ELSE } from "../chart-colors";
import { fixedCategories } from "../categories";
import { inRange, isSpend, ledgerStart, spendParts, type PeriodKind } from "../selectors";
import type { Category, Entry, LedgerState } from "../types";

/*
 * Pure math behind the Category mix and Bills vs Everyday charts: the last N periods ending at
 * the selected one, each split per category part (a split receipt counts against each of its
 * categories). Refunded, Transfer, Investments and Adjustment entries are not spending (isSpend).
 */

/** How many periods each chart shows. */
export const MIX_PERIODS: Record<PeriodKind, number> = { week: 8, month: 6, year: 5 };

/** Starts of the periods shown, oldest first, ending at `from`. Periods before the ledger's first entry are dropped, but the selected one always stays. */
export function mixWindow(state: Pick<LedgerState, "entries">, kind: PeriodKind, from: Date, now: Date): Date[] {
  const first = periodBounds(kind, ledgerStart(state as LedgerState, now))[0].getTime();
  const out: Date[] = [];
  for (let i = MIX_PERIODS[kind] - 1; i >= 0; i--) {
    const d = shiftPeriod(kind, from, -i);
    if (d.getTime() >= first || i === 0) out.push(d);
  }
  return out;
}

const spendIn = (entries: Entry[], kind: PeriodKind, from: Date) => inRange(entries, from, shiftPeriod(kind, from, 1)).filter(isSpend);

export interface MixPart {
  /** a colour-slot category or EVERYTHING_ELSE */
  name: Category | typeof EVERYTHING_ELSE;
  amount: number;
  /** 0–1 of the period's spending */
  share: number;
}

export interface MixPeriod {
  from: Date;
  total: number;
  /** segments bottom to top: slot order, then Everything else; zero amounts omitted */
  parts: MixPart[];
}

export interface MixSeries {
  periods: MixPeriod[];
  /** index of the selected period (always the last) */
  selected: number;
  /** names with spending anywhere in the window, in stacking order */
  present: (Category | typeof EVERYTHING_ELSE)[];
}

export function mixSeries(state: Pick<LedgerState, "entries">, kind: PeriodKind, from: Date, now: Date): MixSeries {
  const slots = colorCategories(state);
  const periods = mixWindow(state, kind, from, now).map((start): MixPeriod => {
    const sums = new Map<string, number>();
    let total = 0;
    for (const e of spendIn(state.entries, kind, start)) {
      for (const p of spendParts(e)) {
        const key = slots.includes(p.category) ? p.category : EVERYTHING_ELSE;
        sums.set(key, (sums.get(key) ?? 0) + p.amount);
        total += p.amount;
      }
    }
    const parts = [...slots, EVERYTHING_ELSE]
      .filter((n) => (sums.get(n) ?? 0) > 0)
      .map((n): MixPart => ({ name: n, amount: sums.get(n)!, share: sums.get(n)! / total }));
    return { from: start, total, parts };
  });
  const present = [...slots, EVERYTHING_ELSE].filter((n) => periods.some((p) => p.parts.some((x) => x.name === n)));
  return { periods, selected: periods.length - 1, present };
}

export interface BillsPeriod {
  from: Date;
  bills: number;
  everyday: number;
  total: number;
}

export interface BillsSeries {
  periods: BillsPeriod[];
  selected: number;
  /** tallest bar, for the axis */
  max: number;
}

/** Bills (fixed categories) against everything else spent, in pesos. */
export function billsSeries(state: Pick<LedgerState, "entries" | "categories">, kind: PeriodKind, from: Date, now: Date): BillsSeries {
  const fixed = new Set<Category>(fixedCategories(state));
  const periods = mixWindow(state, kind, from, now).map((start): BillsPeriod => {
    let bills = 0;
    let everyday = 0;
    for (const e of spendIn(state.entries, kind, start)) {
      for (const p of spendParts(e)) {
        if (fixed.has(p.category)) bills += p.amount;
        else everyday += p.amount;
      }
    }
    return { from: start, bills, everyday, total: bills + everyday };
  });
  return { periods, selected: periods.length - 1, max: Math.max(...periods.map((p) => p.total), 0) };
}

/** Share of spending that is flexible (everyday), whole percent; null when nothing was spent. */
export const flexiblePct = (p: Pick<BillsPeriod, "everyday" | "total">) => (p.total > 0 ? Math.round((p.everyday / p.total) * 100) : null);
