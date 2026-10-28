import { describe, expect, test } from "vitest";
import { headline } from "../../src/lib/analytics";
import { Outbox, overlay, parkCapture } from "../../src/lib/cloud/outbox";
import { accountLabel, budgetPace, canSpendFrom, inRange, ledgerStart, monthBounds, monthBudget } from "../../src/lib/selectors";
import { reducer } from "../../src/lib/store";
import { EMPTY_STATE } from "../../src/lib/seed";
import { findings } from "../../src/screens/analytics";
import { chatMessages } from "../../src/screens/chat";
import { chatTurns } from "../../supabase/functions/_shared/chat_tools";
import type { Account, LedgerState } from "../../src/lib/types";

/* ---------- 1 · chat payload ---------------------------------------------- */

describe("chat payload", () => {
  const ans = (text: string) => ({ read: 0, matched: { n: 0, label: "" }, compareYear: 2025, text, sources: [], followups: [] });

  test("the client sends {role, text}, the contract's shape", () => {
    expect(chatMessages([{ role: "user", text: "How much did I spend?" }])).toEqual([{ role: "user", text: "How much did I spend?" }]);
  });

  test("a failed reply is never sent as an assistant turn; its question is dropped with it", () => {
    const history = [
      { role: "user" as const, text: "first" },
      { role: "ai" as const, ans: ans("You spent ₱500.") },
      { role: "user" as const, text: "second" },
      { role: "ai" as const, text: "I couldn’t answer just now. Try again in a moment." },
      { role: "user" as const, text: "third" },
    ];
    expect(chatMessages(history)).toEqual([
      { role: "user", text: "first" },
      { role: "assistant", text: "You spent ₱500." },
      { role: "user", text: "third" },
    ]);
  });

  test("the function accepts text or content, and drops junk", () => {
    expect(chatTurns([{ role: "user", content: "a" }, { role: "assistant", text: "b" }, { role: "system", text: "x" }, { role: "user", text: "  " }, null, { role: "user", text: "c" }], 12)).toEqual([
      { role: "user", text: "a" },
      { role: "assistant", text: "b" },
      { role: "user", text: "c" },
    ]);
    expect(chatTurns("nope", 12)).toEqual([]);
    expect(chatTurns([{ role: "user", text: "1" }, { role: "user", text: "2" }, { role: "user", text: "3" }], 2).map((t) => t.text)).toEqual(["2", "3"]);
  });
});

/* ---------- 3 · a review with no entries is parked in Review --------------- */

describe("zero-entry review capture", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage;
  };
  const photo = parkCapture({ id: "c1", at: Date.UTC(2026, 9, 29, 3), kind: "photo", storagePath: "u1/r.jpg", question: "I couldn’t find an amount in that. How much was it?" });

  test("a photo becomes a Review draft that keeps the photo and the question", () => {
    expect(photo.calls).toEqual([]);
    expect(photo.parked!.entry).toMatchObject({
      id: "c1", desc: "Receipt photo", amount: 0, accountId: null, category: null, source: "receipt", status: "review",
      reviewQuestion: "I couldn’t find an amount in that. How much was it?", receipt: { items: [], path: "u1/r.jpg" },
    });
    const voice = parkCapture({ id: "c2", at: 0, kind: "voice", text: "lunch gcash", question: "How much was it?" });
    expect(voice.parked!.entry).toMatchObject({ desc: "lunch gcash", raw: "lunch gcash", source: "voice" });
    expect(voice.parked!.entry.receipt).toBeUndefined();
  });

  test("it is never sent, and it survives a reload as a Review entry", () => {
    const o = new Outbox("u1", memory());
    o.push(photo);
    expect(o.next()).toBeUndefined();
    expect(o.unsent).toBe(0);
    const s = overlay({ ...EMPTY_STATE }, [...o.all], reducer);
    expect(s.entries.map((e) => [e.id, e.status, e.reviewQuestion])).toEqual([["c1", "review", "I couldn’t find an amount in that. How much was it?"]]);
  });
});

/* ---------- 5 · Analytics pace uses the prorated first month --------------- */

describe("analytics pace", () => {
  const now = new Date(2026, 9, 29, 10);
  const s: LedgerState = {
    ...EMPTY_STATE,
    onboarded: true,
    accounts: [{ id: "a1", name: "Wallet", provider: "gcash", providerLabel: "GCash", type: "ewallet", kind: "WALLET", balance: 5_000 }],
    entries: [{ id: "x", desc: "Lunch", accountId: "a1", category: "Food & drink", amount: -200, date: new Date(2026, 9, 27, 12).toISOString() }],
    profile: { ...EMPTY_STATE.profile, monthlyBudget: 33_000 },
  };

  test("the first month's pace runs over its active days, like Today", () => {
    const mb = monthBudget(s, now);
    expect(mb.budget).toBe(Math.round((33_000 * 5) / 31));
    expect(budgetPace(mb, now)).toBeCloseTo(3 / 5); // 27, 28, 29 of 27–31 Oct
    expect(budgetPace({ proratedFrom: null }, now)).toBeCloseTo(29 / 31);
  });

  test("the PACE card compares spending with the prorated allowance so far", () => {
    const [from, to] = monthBounds(now);
    const start = ledgerStart(s, now);
    const list = inRange(s.entries, from, to);
    const mb = monthBudget(s, now);
    const cards = findings({
      kind: "month", from, to, now, label: "October", h: headline(s.entries, "month", from, to, now, start),
      list, prevList: [], all: s.entries, budget: { budget: mb.budget, current: true, pace: budgetPace(mb, now) },
    });
    const pace = cards.find((c) => c.key === "pace")!;
    // allowed = 5,323 × 3/5 = 3,194; spent 200 → 2,994 under (the full-month pace said 4,779)
    expect(pace.text).toContain("₱2,994 under pace for your ₱5,323 budget");
  });
});

/* ---------- 7 · account picker names and sources ---------------------------- */

describe("account picker", () => {
  const acct = (x: Partial<Account>): Account => ({ id: "a", name: "A", provider: "other", providerLabel: "A", type: "bank", kind: "SAVINGS", balance: 0, ...x }) as Account;

  test("an 'other' account goes by its own name, a known provider by its brand", () => {
    expect(accountLabel(acct({ name: "GoTyme", providerLabel: "App", last4: "1381" }))).toBe("GOTYME ·1381");
    expect(accountLabel(acct({ provider: "gcash", name: "Daily wallet", providerLabel: "GCash", last4: "8871" }))).toBe("GCASH ·8871");
  });

  test("investments accounts are not a source for spending", () => {
    const list = [acct({ id: "b", type: "bank" }), acct({ id: "i", type: "investments" }), acct({ id: "c", type: "credit" })];
    expect(list.filter(canSpendFrom).map((a) => a.id)).toEqual(["b", "c"]);
  });
});

