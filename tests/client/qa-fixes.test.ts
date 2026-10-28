import { describe, expect, test } from "vitest";
import { backTarget, depthOf, parentOf } from "../../src/lib/router";
import { clearChatHistory, chatKey } from "../../src/lib/chat-history";
import { ledgerStart, monthBudget, priorPeriod, verdict, weekBounds } from "../../src/lib/selectors";
import { todayBudget } from "../../src/lib/today";
import { EMPTY_STATE } from "../../src/lib/seed";
import { respond } from "../../src/screens/chat";
import type { Entry, LedgerState } from "../../src/lib/types";

const at = (m: number, d: number, h = 12) => new Date(2026, m, d, h).toISOString();
const e = (id: string, category: Entry["category"], amount: number, date: string, extra: Partial<Entry> = {}): Entry =>
  ({ id, desc: id, accountId: "a1", category, amount, date, ...extra });

const state = (entries: Entry[], monthlyBudget = 33_000): LedgerState => ({
  ...EMPTY_STATE,
  onboarded: true,
  accounts: [{ id: "a1", name: "Wallet", provider: "gcash", providerLabel: "GCash", type: "ewallet", kind: "WALLET", balance: 50_000 }],
  entries,
  profile: { ...EMPTY_STATE.profile, monthlyBudget },
});

/* ---------- #4 like-for-like comparison --------------------------------- */

describe("priorPeriod", () => {
  test("an unfinished week compares with the same weekdays of last week", () => {
    const now = new Date(2026, 9, 29, 15); // Thursday
    const [from, to] = weekBounds(now);
    const p = priorPeriod("week", from, to, now);
    expect(p.partial).toBe(true);
    expect(p.from).toEqual(new Date(2026, 9, 19)); // Monday before
    expect(p.to).toEqual(new Date(2026, 9, 23)); // through Thursday
  });

  test("a finished week compares with the whole week before", () => {
    const now = new Date(2026, 9, 29, 15);
    const [from, to] = weekBounds(new Date(2026, 9, 20));
    expect(priorPeriod("week", from, to, now)).toEqual({ from: new Date(2026, 9, 12), to: new Date(2026, 9, 19), partial: false });
  });

  test("month so far against the same days last month, clamped to its end", () => {
    const p = priorPeriod("month", new Date(2026, 9, 1), new Date(2026, 10, 1), new Date(2026, 9, 29, 9));
    expect(p).toEqual({ from: new Date(2026, 8, 1), to: new Date(2026, 8, 30), partial: true });
    const end = priorPeriod("month", new Date(2026, 2, 1), new Date(2026, 3, 1), new Date(2026, 2, 30, 9));
    expect(end.to).toEqual(new Date(2026, 2, 1)); // 1–30 March vs all of February
  });

  test("year to date against the same dates last year", () => {
    const p = priorPeriod("year", new Date(2026, 0, 1), new Date(2027, 0, 1), new Date(2026, 9, 29, 9));
    expect(p).toEqual({ from: new Date(2025, 0, 1), to: new Date(2025, 9, 30), partial: true });
  });
});

/* ---------- #7 first-month proration ------------------------------------ */

describe("first month prorated", () => {
  const now = new Date(2026, 9, 29, 10); // onboarded today, 29 Oct
  test("no entries yet: the budget covers today to month end", () => {
    const s = state([]);
    expect(ledgerStart(s, now)).toEqual(new Date(2026, 9, 29));
    const mb = monthBudget(s, now);
    expect(mb).toEqual({ budget: Math.round((33_000 * 3) / 31), full: 33_000, proratedFrom: new Date(2026, 9, 29) });
    const tb = todayBudget(s, now);
    if (!tb.hasBudget) throw new Error("has a budget");
    expect(tb.budget).toBe(3_194);
    expect(tb.allowance).toBe(Math.round(3_194 / 3)); // not 11,000 a day
    expect([tb.budgetDays, tb.daysInMonth, tb.fullBudget]).toEqual([3, 31, 33_000]);
  });

  test("the earliest entry starts the ledger", () => {
    const s = state([e("x", "Food & drink", -200, at(9, 27))]);
    expect(monthBudget(s, now).budget).toBe(Math.round((33_000 * 5) / 31));
    expect(verdict(s, now).budget).toBe(Math.round((33_000 * 5) / 31));
  });

  test("a ledger older than this month gets the full budget", () => {
    const s = state([e("x", "Food & drink", -200, at(8, 20))]);
    expect(monthBudget(s, now)).toEqual({ budget: 33_000, full: 33_000, proratedFrom: null });
    const tb = todayBudget(s, now);
    expect(tb.hasBudget && tb.budgetDays).toBe(31);
  });
});

/* ---------- #8 in-app Back -------------------------------------------- */

describe("back()", () => {
  test("a deep link (no in-app history) goes to the parent route", () => {
    expect(depthOf(null)).toBe(0);
    expect(backTarget(null, "/activity/e1")).toBe("/money");
    expect(backTarget(null, "/money/a1?type=expense")).toBe("/money");
    expect(backTarget(null, "/chat")).toBe("/today");
    expect(backTarget({ other: 1 }, "/chat", "/money")).toBe("/money");
  });
  test("after an in-app push it steps back through history", () => {
    expect(backTarget({ ledgerDepth: 2 }, "/activity/e1")).toBe("history");
    expect(parentOf("/sign-in")).toBe("/");
  });
});

/* ---------- #5 chat history cleared ------------------------------------- */

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

test("chat history is keyed per user and cleared on erase / switch", () => {
  const st = new MemoryStorage();
  st.setItem(chatKey(null), "[]");
  st.setItem(chatKey("u1"), "[1]");
  st.setItem(chatKey("u2"), "[2]");
  st.setItem("ledger:today-period", "Week");
  clearChatHistory(chatKey("u2"), st); // u2 signed in
  expect([st.getItem(chatKey(null)), st.getItem(chatKey("u1")), st.getItem(chatKey("u2"))]).toEqual([null, null, "[2]"]);
  clearChatHistory(undefined, st); // sign-out / erase
  expect(st.getItem(chatKey("u2"))).toBeNull();
  expect(st.getItem("ledger:today-period")).toBe("Week");
});

/* ---------- #12 / #20 local chat intents --------------------------------- */

describe("local M8 responder", () => {
  const today = new Date(2026, 9, 15, 18);
  const s = state(
    [
      e("o1", "Food & drink", -1_000, at(9, 3)),
      e("o2", "Shopping", -3_000, at(9, 10)),
      e("o3", "Food & drink", -500, at(9, 14)),
      e("o4", "Transfer", -9_000, at(9, 5), { linkId: "L" }),
      e("s1", "Food & drink", -1_000, at(8, 4)),
      e("s2", "Transport", -1_000, at(8, 12)),
      e("s3", "Shopping", -9_999, at(8, 25)), // after the 15th: outside the like-for-like stretch
      e("old", "Food & drink", -100, at(7, 1)), // ledger started in August: no proration
    ],
    30_000,
  );

  test("how much did I spend this month", () => {
    const a = respond("How much did I spend this month?", s, today);
    expect(a.text).toBe("You’ve spent ₱4,500 this month, across 3 entries. That’s 15% of your ₱30,000 budget.");
    expect([...a.sources].sort()).toEqual(["o1", "o2", "o3"]);
  });

  test("spend on a category last month", () => {
    const a = respond("how much did I spend on food last month", s, today);
    expect(a.text).toBe("You spent ₱1,000 on food & drink in September, across 1 entry.");
    expect(a.sources).toEqual(["s1"]);
  });

  test("compare to last month is like for like", () => {
    const a = respond("Compare to last month", s, today);
    expect(a.text).toContain("So far this month you’ve spent ₱4,500, 125% more than the ₱2,000 you spent in the same days of September.");
    expect(a.text).toContain("The biggest change is shopping, up ₱3,000.");
  });

  test("biggest category", () => {
    const a = respond("What’s my biggest category?", s, today);
    expect(a.text).toBe("Shopping is your biggest category this month: ₱3,000, 67% of the ₱4,500 you spent. Next is food & drink at ₱1,500.");
    expect(a.sources).toEqual(["o2"]);
  });

  test("goal pace says 1 month, not 1 months", () => {
    const g = { ...s, profile: { ...s.profile, goals: [{ id: "g", name: "Trip", saved: 0, target: 10_000, by: "2026-11" }] } };
    expect(respond("Am I on track for my goal?", g, today).text).toContain("for 1 month.");
    expect(respond("Am I on track for my goal?", g, today).text).not.toContain("1 months");
  });

  test("over budget reads as over, not ₱0 left", () => {
    const over = state([e("x", "Shopping", -40_000, at(9, 2)), e("old", "Food & drink", -100, at(7, 1))], 30_000);
    const a = respond("Can I afford a 20000 phone?", over, today);
    expect(a.text).toContain("₱10,000 over this month’s budget");
    expect(a.text).not.toContain("₱0 left");
  });
});
