import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[], replies: [] as { ok: boolean; status: number; data: unknown }[], refresh: 0, fail: false }));
vi.mock("../../src/lib/cloud/api", () => ({
  timezone: () => "Asia/Manila",
  callFunction: async (...a: unknown[]) => {
    h.calls.push(a);
    if (h.fail) throw new Error("network");
    return h.replies.shift()!;
  },
}));
vi.mock("../../src/lib/supabase", () => ({ cloud: true, sb: () => ({ auth: { refreshSession: async () => void h.refresh++ } }) }));

import { askCloud, respond, WHY_OFFLINE, WHY_UNREACHABLE } from "../../src/screens/chat";
import { EMPTY_STATE } from "../../src/lib/seed";
import type { Entry, LedgerState } from "../../src/lib/types";

const ask = [{ role: "user" as const, text: "hi" }];
const answer = { text: "You spent ₱5.", matched: { n: 1, label: "x" }, read: 1, compareYear: 2025, sources: [], followups: [] };

beforeEach(() => {
  h.calls.length = 0;
  h.replies.length = 0;
  h.refresh = 0;
  h.fail = false;
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
});

describe("askCloud", () => {
  test("a server fallback answer is marked basic", async () => {
    h.replies.push({ ok: true, status: 200, data: { ...answer, fallback: true } });
    const r = (await askCloud(ask)) as any;
    expect(r.kind).toBe("answer");
    expect(r.ans.basic).toMatch(/Basic answer/);
    expect(r.ans.fallback).toBeUndefined();
  });

  test("a normal answer carries no note", async () => {
    h.replies.push({ ok: true, status: 200, data: answer });
    expect(((await askCloud(ask)) as any).ans.basic).toBeUndefined();
  });

  test("401 refreshes the session once and asks again", async () => {
    h.replies.push({ ok: false, status: 401, data: null }, { ok: true, status: 200, data: answer });
    const r = await askCloud(ask);
    expect(r.kind).toBe("answer");
    expect(h.refresh).toBe(1);
    expect(h.calls).toHaveLength(2);
  });

  test("a second 401 is an error, not a loop", async () => {
    h.replies.push({ ok: false, status: 401, data: null }, { ok: false, status: 401, data: null });
    expect((await askCloud(ask)).kind).toBe("error");
    expect(h.calls).toHaveLength(2);
  });

  test("offline, a network error, 503 and 404 fall back locally with the reason", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
    expect(await askCloud(ask)).toEqual({ kind: "local", why: WHY_OFFLINE });
    Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
    h.fail = true;
    expect(await askCloud(ask)).toEqual({ kind: "local", why: WHY_UNREACHABLE });
    h.fail = false;
    h.replies.push({ ok: false, status: 503, data: { error: "ai_unconfigured" } });
    expect(await askCloud(ask)).toEqual({ kind: "local", why: WHY_UNREACHABLE });
    h.replies.push({ ok: false, status: 404, data: null });
    expect((await askCloud(ask)).kind).toBe("local");
  });
});

describe("local responder: named months and the biggest expense", () => {
  const today = new Date(2026, 10, 3, 12);
  const e = (id: string, category: Entry["category"], amount: number, m: number, d: number): Entry =>
    ({ id, desc: id, accountId: null, category, amount, date: new Date(2026, m, d, 12).toISOString() });
  const s: LedgerState = {
    ...EMPTY_STATE,
    entries: [e("Jollibee", "Food & drink", -400, 7, 5), e("Dinner", "Food & drink", -1_200, 7, 20), e("Rent", "Rent & bills", -15_000, 7, 1), e("Grab", "Transport", -250, 8, 4), e("Laptop", "Shopping", -30_000, 9, 9)],
  };

  test("“food in August” sums that month’s food", () => {
    const a = respond("food in August", s, today);
    expect(a.text).toContain("₱1,600");
    expect(a.text).toContain("in August");
    expect(a.matched.n).toBe(2);
  });

  test("“spending in September”", () => {
    expect(respond("spending in September", s, today).text).toContain("₱250");
  });

  test("a month later in the year than today means last year, and “may” needs a preposition", () => {
    expect(respond("spending in December", s, today).text).toContain("Nothing spent");
    expect(respond("how much did I spend, may I ask", s, today).text).toContain("this month");
  });

  test("biggest expense last month and in a named month", () => {
    const a = respond("What was my biggest expense last month?", s, today);
    expect(a.text).toContain("Laptop");
    expect(a.text).toContain("₱30,000");
    expect(a.sources).toEqual(["Laptop"]);
    const aug = respond("biggest expense in August", s, today);
    expect(aug.text).toContain("Rent: ₱15,000");
    expect(aug.sources).toEqual(["Rent", "Dinner", "Jollibee"]);
  });

  test("“biggest category” is still the category answer", () => {
    expect(respond("what's my biggest category last month", s, today).text).toContain("Shopping is your biggest category");
  });
});
