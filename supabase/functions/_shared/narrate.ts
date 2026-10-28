// Deterministic fallback narratives for insights (used when nothing is worth a Claude call,
// when no key is set, or when the validator rejects Claude twice). Pure module: every number is
// rendered from an SQL fact with the same formatter as the app.
import { peso } from "./facts.ts";

type Fact = { value: number | null; entry_ids: string[] };
const ids = (...fs: (Fact | undefined)[]) => [...new Set(fs.flatMap((f) => f?.entry_ids ?? []))];
const n = (f?: Fact) => Number(f?.value ?? 0);

export interface Narrative {
  narrative: string;
  cited_entry_ids: string[];
}

export function dailyTemplate(tb: { has_budget: boolean; left?: Fact; spent_today?: Fact }, today: { spend: Fact; entry_count: Fact }): Narrative {
  if (tb.has_budget && tb.left) {
    const left = n(tb.left);
    return {
      narrative: left >= 0 ? `You have ${peso(left)} left to spend today.` : `You’re ${peso(left)} over today’s budget; tomorrow’s allowance absorbs it.`,
      cited_entry_ids: ids(tb.left),
    };
  }
  return { narrative: `You spent ${peso(n(today.spend))} today.`, cited_entry_ids: ids(today.spend) };
}

export function reviewTemplate(kind: "weekly" | "monthly", c: { current: { spend: Fact; income: Fact; entry_count: Fact } }): Narrative {
  const when = kind === "weekly" ? "this week" : "last month";
  if (n(c.current.entry_count) === 0) {
    return { narrative: `Nothing was logged ${when}, so there’s nothing to flag.`, cited_entry_ids: [] };
  }
  const income = n(c.current.income);
  return {
    narrative: `Nothing to flag ${when}. You spent ${peso(n(c.current.spend))}${income > 0 ? ` and brought in ${peso(income)}` : ""}.`,
    cited_entry_ids: ids(c.current.spend, c.current.income),
  };
}

export function alertTemplate(a: { kind: string; facts: Record<string, unknown>; entry_ids: string[] }): Narrative {
  const f = a.facts;
  const fact = (k: string) => (f[k] && typeof f[k] === "object" ? (f[k] as Fact) : undefined);
  switch (a.kind) {
    case "category_spike":
      return {
        narrative: `${f.category_code} is at ${peso(n(fact("current")))} this month, well above your usual ${peso(n(fact("trailing_avg")))}.`,
        cited_entry_ids: a.entry_ids,
      };
    case "recurring_missed":
      return { narrative: `${f.description} hasn’t shown up yet this cycle. Was it paid another way?`, cited_entry_ids: a.entry_ids };
    case "reconciliation_gap":
      return {
        narrative: `${f.name} is ${peso(Number(f.gap ?? 0))} off from the balance you reported. An adjustment can close the gap.`,
        cited_entry_ids: a.entry_ids,
      };
    case "likely_duplicate":
      return { narrative: `Two ${peso(Number(f.amount ?? 0))} entries look like the same purchase. Delete one if it is.`, cited_entry_ids: a.entry_ids };
    default:
      return { narrative: "Something in your entries looks unusual.", cited_entry_ids: a.entry_ids };
  }
}
