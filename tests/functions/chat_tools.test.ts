import { describe, expect, test } from "vitest";
import { buildAnswer, fallbackAnswer } from "../../supabase/functions/_shared/answer";
import { buildSnapshot, CHAT_TOOLS, type LedgerReader, persistChat, runTool, threadTitle } from "../../supabase/functions/_shared/chat_tools";
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

describe("ledger snapshot", () => {
  const snapReader = (over: Partial<Record<string, unknown>> = {}, fail: string[] = []): LedgerReader => ({
    async rpc(name) {
      if (fail.includes(name)) throw new Error(`${name} down`);
      if (name in over) return over[name];
      if (name === "period_bounds") return { start: "2026-11-01T00:00:00+08:00", end: "2026-12-01T00:00:00+08:00" };
      if (name === "metrics_period") return { income: { value: 50000, entry_ids: ["i1"] }, spend: { value: 12000, entry_ids: ["s1"] }, net: { value: 38000, entry_ids: [] } };
      if (name === "today_budget") return { has_budget: true, budget: 30000, timezone: "Asia/Manila", left: { value: 900, entry_ids: [] }, allowance: { value: 1000, entry_ids: [] }, days_left: 27 };
      if (name === "goal_progress") return [{ goal_id: "g", name: "Trip", saved: 2000, target: 10000, remaining: 8000, pct: 20, by_month: null }];
      return null;
    },
    async accounts() {
      return { balances: [{ account_id: "a", name: "Bank", type: "bank", balance: 15000, user_id: "u" }], netWorth: null, reconciliation: [] };
    },
  });

  test("registers every number as a fact the model can cite, with amounts and names", async () => {
    const reg = new FactRegistry("Asia/Manila");
    const out = await buildSnapshot(snapReader(), reg, "Asia/Manila", NOW);
    const shown = reg.all().map((f) => reg.display(f.id));
    expect(shown).toEqual(expect.arrayContaining(["₱50,000", "₱12,000", "₱900", "₱1,000", "₱15,000", "₱2,000", "₱10,000"]));
    expect(out).toMatch(/Bank/);
    expect(out).toMatch(/Trip/);
    expect(out).not.toMatch(/user_id|timezone/);
    // a prose number that is not one of those facts is still rejected
    const f = reg.all().find((x) => reg.display(x.id) === "₱900")!;
    expect(buildAnswer({ text: `You can spend {{${f.id}}} today.`, marks: [], matched_label: "x", matched_fact: null, bars: null, compare: null, ask: null, offer: null, source_facts: [f.id], followups: [] } as never, reg, { year: 2026 }).violations).toEqual([]);
  });

  test("caps accounts and goals", async () => {
    const reg = new FactRegistry("Asia/Manila");
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `G${i}`, saved: 1, target: 2, by_month: null }));
    const out = await buildSnapshot(snapReader({ goal_progress: many }), reg, "Asia/Manila", NOW);
    expect(out).toMatch(/G11"/);
    expect(out).not.toMatch(/G12"/);
  });

  test("a part that fails is left out; all failing gives an empty snapshot", async () => {
    const reg = new FactRegistry("Asia/Manila");
    const out = await buildSnapshot(snapReader({}, ["goal_progress"]), reg, "Asia/Manila", NOW);
    expect(out).toMatch(/Bank/);
    expect(out).not.toMatch(/Trip/);
    const none: LedgerReader = { rpc: async () => { throw new Error("down"); }, accounts: async () => { throw new Error("down"); } };
    expect(await buildSnapshot(none, new FactRegistry("Asia/Manila"), "Asia/Manila", NOW)).toBe("");
  });

  test("no budget set is said plainly, without facts", async () => {
    const out = await buildSnapshot(snapReader({ today_budget: { has_budget: false } }), new FactRegistry(), "Asia/Manila", NOW);
    expect(out).toMatch(/"has_budget":false/);
  });

  test("the prompt tells the model about the snapshot", () => {
    expect(CHAT_SYSTEM).toMatch(/ledger snapshot/);
  });
});

describe("thread persistence", () => {
  test("titles: the first question, trimmed; over 60 characters is cut with an ellipsis", () => {
    expect(threadTitle("  How much did I spend\n on food? ")).toBe("How much did I spend on food?");
    const long = threadTitle("x".repeat(100));
    expect(long.length).toBe(60);
    expect(long.endsWith("…")).toBe(true);
    expect(threadTitle("y".repeat(60))).toBe("y".repeat(60));
  });

  /** a supabase-js-shaped fake that records writes */
  function fakeDb(opts: { existing?: string; failOn?: string } = {}) {
    const writes: { table: string; op: string; row?: any }[] = [];
    const db = {
      from(table: string) {
        const fail = opts.failOn === table;
        const res = (data: unknown) => ({ data: fail ? null : data, error: fail ? { message: `${table} failed` } : null });
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => res(opts.existing ? { id: opts.existing } : null),
          insert: (row: unknown) => { writes.push({ table, op: "insert", row }); return { select: () => ({ single: async () => res({ id: "new-thread" }) }), then: (ok: any) => ok(res(null)) }; },
          update: (row: unknown) => { writes.push({ table, op: "update", row }); return { eq: async () => res(null) }; },
        };
        return q;
      },
    };
    return { db: db as never, writes };
  }
  const ANSWER = { text: "You spent ₱12,000.", read: 1 };

  test("a missing thread_id creates a thread titled by the question, then saves both turns", async () => {
    const { db, writes } = fakeDb();
    expect(await persistChat(db, undefined, "How much on food?", ANSWER)).toBe("new-thread");
    expect(writes[0]).toMatchObject({ table: "chat_threads", op: "insert", row: { title: "How much on food?" } });
    const msgs = writes.find((w) => w.table === "chat_messages")!.row;
    expect(msgs.map((m: any) => [m.thread_id, m.role, m.text])).toEqual([["new-thread", "user", "How much on food?"], ["new-thread", "assistant", "You spent ₱12,000."]]);
    expect(msgs[1].answer).toEqual(ANSWER);
    expect(writes.at(-1)).toMatchObject({ table: "chat_threads", op: "update" });
  });

  test("a known thread_id is reused (no new thread); an unknown one starts a new thread", async () => {
    const tid = "0b8f6c1e-3d2a-4f5b-9c7d-1a2b3c4d5e6f";
    const known = fakeDb({ existing: tid });
    expect(await persistChat(known.db, tid, "q", ANSWER)).toBe(tid);
    expect(known.writes.some((w) => w.table === "chat_threads" && w.op === "insert")).toBe(false);
    const unknown = fakeDb();
    expect(await persistChat(unknown.db, tid, "q", ANSWER)).toBe("new-thread");
    expect(await persistChat(fakeDb().db, "not-a-uuid", "q", ANSWER)).toBe("new-thread");
  });

  test("a failing save does not throw and returns null", async () => {
    for (const failOn of ["chat_threads", "chat_messages"]) {
      const { db } = fakeDb({ failOn });
      const r = await persistChat(db, undefined, "q", ANSWER);
      expect(r).toBeNull();
    }
  });
});
