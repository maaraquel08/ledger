import { describe, expect, test } from "vitest";
import { canRefund } from "../../src/lib/entry-rules";
import { patternWindow } from "../../src/lib/selectors";
import { reducer } from "../../src/lib/store";
import { todayBudget } from "../../src/lib/today";
import { EMPTY_STATE } from "../../src/lib/seed";
import { respond, suggestionsFor } from "../../src/screens/chat";
import type { Account, Entry, LedgerState } from "../../src/lib/types";

const at = (m: number, d: number, h = 12) => new Date(2026, m, d, h).toISOString();
const e = (id: string, category: Entry["category"], amount: number, date: string, extra: Partial<Entry> = {}): Entry =>
  ({ id, desc: id, accountId: "bpi", category, amount, date, ...extra });
const acct = (id: string, type: Account["type"], balance: number): Account =>
  ({ id, name: id, provider: "other", providerLabel: id, type, kind: "X", balance }) as Account;

const state = (entries: Entry[], extra: Partial<LedgerState["profile"]> = {}): LedgerState => ({
  ...EMPTY_STATE,
  onboarded: true,
  accounts: [acct("bpi", "bank", 50_000), acct("ibkr", "investments", 8_000), acct("gcash", "ewallet", 4_000)],
  entries,
  profile: { ...EMPTY_STATE.profile, monthlyBudget: 33_000, ...extra },
});

/* ---------- A: refunds only on plain expenses ---------------------------- */

describe("A · refund eligibility", () => {
  const voo = [
    e("ei9", "Investments", -8000, at(9, 6), { linkId: "l1" }),
    e("ei10", "Investments", 8000, at(9, 6), { accountId: "ibkr", linkId: "l1" }),
  ];
  const adj = e("adj", "Adjustment", -500, at(9, 7));
  const lunch = e("lunch", "Food & drink", -300, at(9, 8));

  test("canRefund: plain expenses only", () => {
    expect(canRefund(lunch)).toBe(true);
    expect(canRefund(e("x", null, -10, at(9, 8)))).toBe(true);
    expect(canRefund(voo[0])).toBe(false);
    expect(canRefund(adj)).toBe(false);
    expect(canRefund(e("inc", "Income", 500, at(9, 8)))).toBe(false);
    expect(canRefund(e("t", "Transfer", -500, at(9, 8)))).toBe(false);
  });

  test("the reducer refuses a refund on a move leg or an Adjustment; net worth stays put", () => {
    const s = state([...voo, adj, lunch]);
    for (const id of ["ei9", "ei10", "adj"]) {
      expect(reducer(s, { type: "update-entry", id, patch: { refunded: true } })).toBe(s);
    }
    const ok = reducer(s, { type: "update-entry", id: "lunch", patch: { refunded: true } });
    expect(ok.accounts.find((a) => a.id === "bpi")!.balance).toBe(50_300);
    // unmarking stays possible
    const back = reducer(ok, { type: "update-entry", id: "lunch", patch: { refunded: false } });
    expect(back.accounts.find((a) => a.id === "bpi")!.balance).toBe(50_000);
  });
});

/* ---------- B: a move's legs stay in different accounts ------------------ */

describe("B · transfer legs", () => {
  const legs = [
    e("out", "Transfer", -4000, at(9, 6), { linkId: "t1" }),
    e("in", "Transfer", 4000, at(9, 6), { accountId: "gcash", linkId: "t1" }),
  ];
  test("moving a leg into the other leg's account is refused", () => {
    const s = state(legs);
    expect(reducer(s, { type: "update-entry", id: "out", patch: { accountId: "gcash" } })).toBe(s);
    expect(reducer(s, { type: "update-entry", id: "in", patch: { accountId: "bpi" } })).toBe(s);
  });
  test("moving a leg to a third account is fine", () => {
    const s = state(legs);
    const next = reducer(s, { type: "update-entry", id: "out", patch: { accountId: "ibkr" } });
    expect(next.entries.find((x) => x.id === "out")!.accountId).toBe("ibkr");
  });
});

/* ---------- G: today / yesterday / this week in chat --------------------- */

describe("G · spend questions by period", () => {
  const today = new Date(2026, 9, 29, 18); // Thursday
  const s = state([
    e("t1", "Food & drink", -200, at(9, 29, 9)),
    e("t2", "Transport", -50, at(9, 29, 10)),
    e("y1", "Food & drink", -700, at(9, 28)),
    e("w1", "Shopping", -1000, at(9, 26)), // Monday
    e("m1", "Shopping", -5000, at(9, 3)),
  ]);
  test("today", () => {
    const a = respond("How much did I spend today?", s, today);
    expect(a.text).toContain("₱250 today");
    expect(a.matched.n).toBe(2);
  });
  test("yesterday", () => {
    expect(respond("How much did I spend yesterday?", s, today).text).toContain("₱700 yesterday");
  });
  test("this week", () => {
    expect(respond("How much did I spend this week?", s, today).text).toContain("₱1,950 this week");
  });
  test("this month still means the month", () => {
    expect(respond("How much did I spend this month?", s, today).text).toContain("₱6,950 this month");
  });
});

/* ---------- F / J: over budget and suggestions ---------------------------- */

describe("F · J · chat", () => {
  test("over budget says so, with no per-day line", () => {
    const today = new Date(2026, 9, 29, 18);
    const s = state([e("old", "Shopping", -10, at(8, 20)), e("big", "Shopping", -40_000, at(9, 2))]);
    const a = respond("Am I over budget?", s, today);
    expect(a.text).toContain("You’re ₱7,000 over this month’s budget");
    expect(a.text).not.toMatch(/a day/);
  });
  test("suggestions come from the user's own data", () => {
    const none = suggestionsFor(state([]));
    expect(none.join(" ")).not.toMatch(/Japan|goal/i);
    const withGoal = suggestionsFor(state([], { goals: [{ id: "g", name: "Emergency fund", saved: 0, target: 10_000, by: "2027-06" }] }));
    expect(withGoal).toContain("Am I on track for Emergency fund?");
  });
});

/* ---------- H: weekday pattern window ------------------------------------ */

describe("H · pattern window", () => {
  test("the current week: the 28 days before today, today excluded", () => {
    const now = new Date(2026, 9, 29, 15); // Thursday
    const to = new Date(2026, 10, 2); // the Monday after this week
    const [from, end] = patternWindow(to, now);
    expect(end).toEqual(new Date(2026, 9, 29));
    expect(from).toEqual(new Date(2026, 9, 1));
    // exactly four Fridays, all finished: 2, 9, 16, 23 Oct (not 30 Oct, still to come)
    const fridays: number[] = [];
    for (let d = new Date(from); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) if (d.getDay() === 5) fridays.push(d.getDate());
    expect(fridays).toEqual([2, 9, 16, 23]);
  });
  test("a past week ends at that week's end", () => {
    const now = new Date(2026, 9, 29, 15);
    const to = new Date(2026, 9, 19);
    expect(patternWindow(to, now)).toEqual([new Date(2026, 8, 21), to]);
  });
});

/* ---------- I: one daily figure ------------------------------------------ */

describe("I · the daily figure", () => {
  test("after onboarding the headline, the tile and the math share todayBudget().allowance", () => {
    const now = new Date(2026, 9, 29, 10);
    const tb = todayBudget(state([]), now);
    if (!tb.hasBudget) throw new Error("has a budget");
    // 33,000 × 3/31 = 3,194; ÷ 3 days = 1,064.67 → 1,065 everywhere (the headline used to floor to 1,064)
    expect(tb.allowance).toBe(1065);
    expect(tb.left).toBe(1065);
  });
});
