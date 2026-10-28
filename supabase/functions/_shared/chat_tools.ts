// M8's read-only chat tools, mapped to the metric RPCs and views (supabase/CONTRACT.md).
// Pure module: the database is injected, so the mapping is unit-testable. Every number a tool
// returns is registered as a fact (facts.ts) before Claude sees it.
import { factify, type FactRegistry } from "./facts.ts";
import { localParts, tzOffsetMs } from "./time.ts";

export interface LedgerReader {
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** account_balances (live accounts), net_worth, reconciliation rows for the caller */
  accounts(): Promise<{ balances: Record<string, unknown>[]; netWorth: Record<string, unknown> | null; reconciliation: Record<string, unknown>[] }>;
}

export const PERIODS = [
  "today", "this_week", "last_week", "this_month", "last_month", "this_year", "last_year",
  "last_30_days", "last_90_days", "custom",
] as const;
export type PeriodName = (typeof PERIODS)[number];

const LABEL: Record<PeriodName, string> = {
  today: "today", this_week: "this week", last_week: "last week", this_month: "this month",
  last_month: "last month", this_year: "this year", last_year: "last year",
  last_30_days: "the last thirty days", last_90_days: "the last ninety days", custom: "the chosen dates",
};

const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: "null" }] });
const periodProps = {
  period: { type: "string", enum: [...PERIODS], description: "Calendar period in the Owner's timezone. Weeks start Monday." },
  start: { ...nullable({ type: "string" }), description: "custom only: first day, YYYY-MM-DD" },
  end: { ...nullable({ type: "string" }), description: "custom only: last day (inclusive), YYYY-MM-DD" },
};
const tool = (name: string, description: string, properties: Record<string, unknown>) => ({
  name,
  description,
  strict: true,
  input_schema: { type: "object", additionalProperties: false, required: Object.keys(properties), properties },
});

/** Tool definitions in a fixed order (the tool list is part of the cached prefix). */
export const CHAT_TOOLS = [
  tool("period_summary", "Income, spending, net, savings rate, amount invested, entry count, spending by category and top merchants for a period.", periodProps),
  tool("compare_periods", "A period versus the one before it (previous week, month or year, or the same length before): income, spending, net and per-category changes.", periodProps),
  tool("spending_by_category", "Spending per category for a period, with each category's share.", periodProps),
  tool("find_entries", "Search entries by words in the description, merchant, category or what the Owner typed (e.g. 'coffee', 'grab', 'meralco'). Returns count, total, spending and income of all matches plus the best matching entries.", {
    query: { type: "string", description: "One or two words" },
    ...periodProps,
  }),
  tool("monthly_spend", "Spending per month from January of this year to this month, either for one category or for entries matching a search query (for trends and month-by-month charts).", {
    category: { ...nullable({ type: "string" }), description: "A category name, e.g. 'Food & drink'" },
    query: { ...nullable({ type: "string" }), description: "Search words, e.g. 'coffee'" },
  }),
  tool("goal_progress", "Each savings goal: saved, target, remaining, percent done, months left and the amount needed per month.", {}),
  tool("today_budget", "Today's spending allowance: what's left to spend today, what tomorrow's allowance becomes, spent today, days left in the month.", {}),
  tool("accounts_and_net_worth", "Every account's derived balance (credit cards: amount owed), net worth (cash + investments − credit owed), and any gap between a reported balance and the ledger.", {}),
  tool("what_if_purchase", "Affordability of a one-off purchase: cash on hand, average monthly spending over the last three full months, and the cash buffer in months now and after buying.", {
    amount: { type: "number", description: "The price, in pesos, exactly as the Owner stated it" },
  }),
] as const;

export type ToolName = (typeof CHAT_TOOLS)[number]["name"];

/** Midnight at the start of a local date in a timezone, as an ISO instant. */
export function zonedStart(date: string, tz: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const off = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - off).toISOString();
}

export interface Bounds {
  start: string;
  end: string;
  label: string;
  prev?: { start: string; end: string };
}

type PB = { start: string; end: string };

export async function resolvePeriod(db: LedgerReader, input: { period?: string | null; start?: string | null; end?: string | null }, tz: string, now: Date): Promise<Bounds> {
  const period = (PERIODS as readonly string[]).includes(input.period ?? "") ? (input.period as PeriodName) : "this_month";
  const pb = async (p: string, anchor: string | Date) =>
    (await db.rpc("period_bounds", { p_period: p, p_anchor: typeof anchor === "string" ? anchor : anchor.toISOString() })) as PB;
  const before = (iso: string) => new Date(Date.parse(iso) - 1000).toISOString();
  const label = LABEL[period];

  if (period === "custom") {
    const ok = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (ok(input.start) && ok(input.end)) {
      const start = zonedStart(input.start!, tz);
      const endDay = new Date(Date.parse(`${input.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      return { start, end: zonedStart(endDay, tz), label };
    }
    return resolvePeriod(db, { period: "this_month" }, tz, now);
  }
  if (period === "today") {
    const b = await pb("day", now);
    return { ...b, label, prev: await pb("day", before(b.start)) };
  }
  if (period === "last_30_days" || period === "last_90_days") {
    const day = await pb("day", now);
    const n = period === "last_30_days" ? 30 : 90;
    const start = new Date(Date.parse(day.end) - n * 86_400_000).toISOString();
    return { start, end: day.end, label };
  }
  const unit = period.endsWith("week") ? "week" : period.endsWith("month") ? "month" : "year";
  let b = await pb(unit, now);
  if (period.startsWith("last_")) b = await pb(unit, before(b.start));
  return { start: b.start, end: b.end, label, prev: await pb(unit, before(b.start)) };
}

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Run one tool; returns the model view (numbers replaced by facts). Throws on bad input. */
export async function runTool(name: string, input: Record<string, unknown>, ctx: { db: LedgerReader; reg: FactRegistry; tz: string; now: Date }): Promise<unknown> {
  const { db, reg, tz, now } = ctx;
  const period = () => resolvePeriod(db, input as { period?: string; start?: string; end?: string }, tz, now);
  switch (name as ToolName) {
    case "period_summary": {
      const b = await period();
      const r = await db.rpc("metrics_period", { p_start: b.start, p_end: b.end });
      return { period: b.label, ...(factify(r, reg, { label: b.label, drop: ["currency"] }) as object) };
    }
    case "compare_periods": {
      const b = await period();
      const args: Record<string, unknown> = { p_start: b.start, p_end: b.end };
      if (b.prev) Object.assign(args, { p_prev_start: b.prev.start, p_prev_end: b.prev.end });
      const r = await db.rpc("compare_periods", args);
      return { period: b.label, ...(factify(r, reg, { label: `${b.label} vs before` }) as object) };
    }
    case "spending_by_category": {
      const b = await period();
      const r = await db.rpc("spend_by_category", { p_start: b.start, p_end: b.end });
      return { period: b.label, categories: factify(r, reg, { label: `spending ${b.label}` }) };
    }
    case "find_entries": {
      const q = String(input.query ?? "").trim();
      if (!q) throw new Error("query is empty");
      const b = input.period ? await period() : null;
      const r = await db.rpc("entries_matching", { p_query: q, p_start: b?.start ?? null, p_end: b?.end ?? null, p_limit: 25 });
      return { period: b?.label ?? "all time", ...(factify(r, reg, { label: `"${q}"${b ? ` ${b.label}` : ""}` }) as object) };
    }
    case "monthly_spend": {
      const category = typeof input.category === "string" && input.category.trim() ? input.category.trim() : null;
      const query = typeof input.query === "string" && input.query.trim() ? input.query.trim() : null;
      if (!category && !query) throw new Error("give a category or a query");
      const p = localParts(now, tz);
      const months: unknown[] = [];
      for (let m = 0; m < p.month; m++) {
        const start = zonedStart(`${p.year}-${String(m + 1).padStart(2, "0")}-01`, tz);
        const end = m + 1 === 12 ? zonedStart(`${p.year + 1}-01-01`, tz) : zonedStart(`${p.year}-${String(m + 2).padStart(2, "0")}-01`, tz);
        let fact: { value: number; entry_ids: string[] };
        if (category) {
          const rows = (await db.rpc("spend_by_category", { p_start: start, p_end: end })) as { category_code: string | null; value: number; entry_ids: string[] }[];
          const row = rows.find((r) => (r.category_code ?? "").toLowerCase() === category.toLowerCase());
          fact = { value: row ? Number(row.value) : 0, entry_ids: row?.entry_ids ?? [] };
        } else {
          const r = (await db.rpc("entries_matching", { p_query: query, p_start: start, p_end: end, p_limit: 0 })) as { spend: { value: number; entry_ids: string[] } };
          fact = { value: Number(r.spend.value), entry_ids: r.spend.entry_ids ?? [] };
        }
        const id = reg.add(fact.value, "peso", `${category ?? `"${query}"`} spending in ${MONTH[m]}`, fact.entry_ids);
        months.push({ month: MONTH[m], spend: { fact: id, shows: reg.display(id), entries: fact.entry_ids.length } });
      }
      return { filter: category ?? query, months };
    }
    case "goal_progress": {
      const r = await db.rpc("goal_progress", {});
      return { goals: factify(r, reg, { label: "goal" }) };
    }
    case "today_budget": {
      const r = await db.rpc("today_budget", { p_now: now.toISOString() });
      return factify(r, reg, { label: "today's budget", drop: ["timezone"] });
    }
    case "accounts_and_net_worth": {
      const a = await db.accounts();
      return {
        accounts: factify(a.balances, reg, { label: "balance", drop: ["user_id", "opening_balance", "archived_at", "currency"] }),
        net_worth: factify(a.netWorth ?? {}, reg, { label: "net worth", drop: ["user_id"] }),
        reconciliation: factify(a.reconciliation, reg, { label: "reported vs ledger", drop: ["user_id", "snapshot_id"] }),
      };
    }
    case "what_if_purchase": {
      const price = Math.abs(Number(input.amount));
      if (!Number.isFinite(price) || price <= 0) throw new Error("amount must be a positive number");
      const thisMonth = (await db.rpc("period_bounds", { p_period: "month", p_anchor: now.toISOString() })) as PB;
      const threeBack = (await db.rpc("period_bounds", {
        p_period: "month",
        p_anchor: new Date(Date.parse(thisMonth.start) - 80 * 86_400_000).toISOString(),
      })) as PB;
      const m = (await db.rpc("metrics_period", { p_start: threeBack.start, p_end: thisMonth.start })) as { spend: { value: number; entry_ids: string[] } };
      const { netWorth } = await db.accounts();
      const cash = Number(netWorth?.cash ?? 0);
      const avg = Number(m.spend.value ?? 0) / 3;
      const tb = (await db.rpc("today_budget", { p_now: now.toISOString() })) as { has_budget: boolean; left?: { value: number; entry_ids: string[] } };
      const ids = m.spend.entry_ids ?? [];
      const f = (v: number | null, kind: "peso" | "months", label: string, e: string[] = []) => {
        const id = reg.add(v, kind, label, e);
        return { fact: id, shows: reg.display(id) };
      };
      return {
        price: f(price, "peso", "the purchase"),
        cash_on_hand: f(cash, "peso", "cash on hand"),
        avg_monthly_spend: f(avg, "peso", "average monthly spending (last three full months)", ids),
        buffer_now_months: f(avg > 0 ? cash / avg : null, "months", "buffer now (months of spending)", ids),
        buffer_after_months: f(avg > 0 ? Math.max(0, cash - price) / avg : null, "months", "buffer after buying (months of spending)", ids),
        cash_after: f(Math.max(0, cash - price), "peso", "cash left after buying"),
        short_by: f(Math.max(0, price - cash), "peso", "short by"),
        left_today: tb.has_budget && tb.left ? f(tb.left.value, "peso", "left to spend today", tb.left.entry_ids) : null,
      };
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
