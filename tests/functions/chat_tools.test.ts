import { describe, expect, test } from "vitest";
import { fallbackAnswer } from "../../supabase/functions/_shared/answer";
import { CHAT_TOOLS, type LedgerReader, runTool } from "../../supabase/functions/_shared/chat_tools";
import { FactRegistry } from "../../supabase/functions/_shared/facts";
import { toOpenAiTools } from "../../supabase/functions/_shared/openai_compat";
import { CHAT_SYSTEM } from "../../supabase/functions/_shared/prompts";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const reader = (results: Record<string, unknown> = {}): LedgerReader => ({
  async rpc(name, args) {
    calls.push({ name, args });
    if (name === "period_bounds") return { start: "2026-10-01T00:00:00+08:00", end: "2026-11-01T00:00:00+08:00" };
    return results[name] ?? { count: { value: 0, entry_ids: [] }, spend: { value: 0, entry_ids: [] }, entries: [] };
  },
  async accounts() {
    return { balances: [], netWorth: null, reconciliation: [] };
  },
});
const NOW = new Date("2026-11-03T04:00:00Z");
const run = (name: string, input: Record<string, unknown>, db = reader()) => runTool(name, input, { db, reg: new FactRegistry("Asia/Manila"), tz: "Asia/Manila", now: NOW });
const last = (name: string) => calls.filter((c) => c.name === name).at(-1)!.args;

describe("tool definitions", () => {
  test("every tool is strict-shaped: all properties required, no extras; new tools exist", () => {
    const names = CHAT_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["top_entries", "budget_status", "monthly_spend", "find_entries"]));
    for (const t of CHAT_TOOLS) {
      expect(t.input_schema.additionalProperties).toBe(false);
      expect([...t.input_schema.required].sort(), t.name).toEqual(Object.keys(t.input_schema.properties).sort());
    }
  });

  test("they convert to OpenAI-compatible function tools (Groq) with plain JSON-schema parameters", () => {
    const fns = toOpenAiTools(CHAT_TOOLS as never);
    expect(fns).toHaveLength(CHAT_TOOLS.length);
    const top = fns.find((f) => f.function.name === "top_entries")!;
    expect(JSON.stringify(top.function.parameters)).not.toMatch(/\$ref|oneOf|allOf/);
  });

  test("the prompt allows advice with actions but keeps the number rule and no stock picks", () => {
    expect(CHAT_SYSTEM).toMatch(/advice question/);
    expect(CHAT_SYSTEM).toMatch(/Never type digits yourself/);
    expect(CHAT_SYSTEM).toMatch(/never recommend specific stocks/);
  });
});

describe("top_entries", () => {
  test("maps to the RPC, clamps n, and registers each amount as a fact sourced by its entry", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const db = reader({ top_entries: { kind: "spend", entries: [{ id, occurred_at: "2026-10-03T04:00:00Z", description: "Rent", merchant: null, amount: -15000, category_code: "Rent & bills", account_id: null, account_name: "Payroll", status: "posted" }] } });
    const reg = new FactRegistry("Asia/Manila");
    const out = (await runTool("top_entries", { period: "last_month", kind: "spend", n: 99, category: null }, { db, reg, tz: "Asia/Manila", now: NOW })) as any;
    expect(last("top_entries")).toMatchObject({ p_kind: "spend", p_limit: 20, p_category: null });
    const f = out.entries[0].amount.fact;
    expect(reg.display(f)).toBe("₱15,000");
    expect(reg.get(f)!.entry_ids).toEqual([id]);
    await run("top_entries", { period: "this_month", kind: "income", n: "x", category: " Food & drink " });
    expect(last("top_entries")).toMatchObject({ p_kind: "income", p_limit: 5, p_category: "Food & drink" });
  });
});

describe("find_entries", () => {
  test("category and dates go to the RPC; no period means all time", async () => {
    await run("find_entries", { query: "grab", category: "Transport", period: "custom", start: "2026-08-01", end: "2026-08-31" });
    expect(last("entries_matching")).toMatchObject({ p_query: "grab", p_category: "Transport" });
    expect(String(last("entries_matching").p_start)).toMatch(/^2026-07-31T16:00:00/);
    await run("find_entries", { query: "grab", category: null, period: null });
    expect(last("entries_matching")).toMatchObject({ p_start: null, p_end: null, p_category: null });
  });
});

describe("monthly_spend", () => {
  const fact = { spend: { value: 100, entry_ids: [] } };
  test("current year runs January to this month; a past year runs all twelve", async () => {
    const db = reader({ entries_matching: fact });
    const now = (await run("monthly_spend", { query: "coffee", category: null, year: null }, db)) as any;
    expect(now.months).toHaveLength(11);
    const past = (await run("monthly_spend", { query: "coffee", category: null, year: 2025 }, db)) as any;
    expect(past.months).toHaveLength(12);
    expect(String(last("entries_matching").p_start)).toMatch(/^2025-11-30T16:00:00/);
    expect(last("entries_matching").p_end).toBe("2025-12-31T16:00:00.000Z");
  });
  test("a future or absurd year is refused", async () => {
    await expect(run("monthly_spend", { query: "coffee", category: null, year: 2027 })).rejects.toThrow(/year/);
    await expect(run("monthly_spend", { query: "coffee", category: null, year: 1850 })).rejects.toThrow(/year/);
  });
});

describe("budget_status", () => {
  test("every number becomes a fact", async () => {
    const reg = new FactRegistry("Asia/Manila");
    const db = reader({
      budget_status: {
        has_budget: true, month: "November", budget: 30000, budget_source: "profile", spent: { value: 1000, entry_ids: [] }, left: 29000,
        categories: [{ category_code: "Food & drink", budget: 2000, spent: { value: 700, entry_ids: [] }, left: 1300 }],
        savings: [{ month: "October", income: { value: 40000, entry_ids: [] }, spend: { value: 20000, entry_ids: [] }, savings_rate: { value: 50, entry_ids: [] } }],
      },
    });
    const out = (await runTool("budget_status", {}, { db, reg, tz: "Asia/Manila", now: NOW })) as any;
    expect(reg.display(out.categories[0].left.fact)).toBe("₱1,300");
    expect(reg.display(out.savings[0].savings_rate.fact)).toBe("50%");
    expect(reg.display(out.budget.fact)).toBe("₱30,000");
  });
});

describe("fallback flag", () => {
  test("the server's template answer says it is one", () => {
    expect(fallbackAnswer(new FactRegistry(), { year: 2026 }).fallback).toBe(true);
  });
});
