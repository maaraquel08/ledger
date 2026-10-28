import { describe, expect, test } from "vitest";
import { balance, inputDateTime, MAX_AMOUNT, parseWholePesos, peso, signed, wholePesos } from "../../src/lib/format";
import { BIG_AMOUNT, categoriesFor, fixedCategory, isUnusualAmount } from "../../src/lib/entry-rules";
import { SPEND_CATEGORIES } from "../../src/lib/providers";
import { buildDemo } from "../../src/lib/seed";
import { adjustmentAmount, reducer } from "../../src/lib/store";
import { isIncome, isSpend } from "../../src/lib/selectors";
import type { Account, Entry } from "../../src/lib/types";

describe("peso rounding", () => {
  test("rounds the absolute value, half away from zero, so sign never changes the digits", () => {
    expect(peso(1000.5)).toBe("₱1,001");
    expect(peso(-1000.5)).toBe("₱1,001");
    expect(peso(-1000.4)).toBe("₱1,000");
    expect(peso(0.5)).toBe("₱1");
    expect(peso(-0.5)).toBe("₱1");
    expect(wholePesos(-2.5)).toBe(3);
  });
  test("signed and balance keep the typographic minus and the same digits", () => {
    expect(signed(-1000.5)).toBe("−₱1,001");
    expect(signed(1000.5)).toBe("+₱1,001");
    expect(balance(-1000.5)).toBe("−₱1,001");
  });
});

describe("parseWholePesos", () => {
  test("whole pesos with or without commas", () => {
    expect(parseWholePesos("1,250")).toBe(1250);
    expect(parseWholePesos(" 80 ")).toBe(80);
    expect(parseWholePesos(String(MAX_AMOUNT))).toBe(MAX_AMOUNT);
  });
  test("no centavos, no zero, nothing over the keypad cap", () => {
    for (const s of ["12.50", "0", "", "-5", "abc", "1e3", String(MAX_AMOUNT + 1)]) expect(parseWholePesos(s), s).toBeNull();
  });
});

test("inputDateTime is local time to the minute", () => {
  expect(inputDateTime(new Date(2026, 9, 5, 7, 3, 59))).toBe("2026-10-05T07:03");
});

describe("categories on edit", () => {
  test("money out gets spend categories, money in gets income ones; never a lone Transfer or Investments", () => {
    expect(categoriesFor(-1, "Groceries")).toEqual(SPEND_CATEGORIES);
    expect(categoriesFor(1, "Salary")).toEqual(["Salary", "Income"]);
    for (const sign of [1, -1] as const) {
      expect(categoriesFor(sign, null)).not.toContain("Transfer");
      expect(categoriesFor(sign, null)).not.toContain("Investments");
    }
  });
  test("an entry that is already a Transfer (to a person) keeps it as an option", () => {
    expect(categoriesFor(-1, "Transfer")).toContain("Transfer");
  });
  test("legs of a move and Adjustments keep their category", () => {
    expect(fixedCategory({ linkId: "l1", category: "Transfer" })).toBe(true);
    expect(fixedCategory({ category: "Adjustment" })).toBe(true);
    expect(fixedCategory({ category: "Groceries" })).toBe(false);
  });
});

describe("isUnusualAmount", () => {
  const entries = [
    { amount: -500, category: "Food & drink" as const },
    { amount: -1200, category: "Food & drink" as const },
  ];
  test("over ₱100,000 always asks", () => {
    expect(isUnusualAmount(-(BIG_AMOUNT + 1), null, [])).toBe(true);
    expect(isUnusualAmount(-BIG_AMOUNT, null, [])).toBe(false);
  });
  test("more than three times the largest in that category asks", () => {
    expect(isUnusualAmount(-3600, "Food & drink", entries)).toBe(false);
    expect(isUnusualAmount(-3601, "Food & drink", entries)).toBe(true);
  });
  test("a first entry in a category doesn't ask under ₱100,000", () => {
    expect(isUnusualAmount(-50_000, "Health", entries)).toBe(false);
  });
});

describe("local Adjustment (D-0014)", () => {
  const wallet: Account = { id: "w", name: "Wallet", provider: "gcash", providerLabel: "GCash", type: "ewallet", kind: "WALLET", balance: 5000 };
  const card: Account = { id: "c", name: "Card", provider: "rcbc", providerLabel: "RCBC", type: "credit", kind: "CREDIT", balance: 5000 };

  test("the Adjustment entry brings the derived balance to what was reported", () => {
    for (const [acct, reported] of [
      [wallet, 4200],
      [wallet, 5800],
      [card, 4200],
      [card, 6100],
    ] as const) {
      const amount = adjustmentAmount(acct, reported);
      const entry: Entry = { id: "j", desc: "Balance adjustment", accountId: acct.id, category: "Adjustment", amount, date: new Date().toISOString() };
      const s = reducer({ ...buildDemo(), accounts: [acct], entries: [] }, { type: "add-entry", entry });
      expect(s.accounts[0].balance, `${acct.type} ${reported}`).toBe(reported);
      expect(isSpend(entry) || isIncome(entry)).toBe(false);
    }
  });
  test("no gap, no adjustment", () => {
    expect(adjustmentAmount(wallet, 5000)).toBe(0);
    expect(Object.is(adjustmentAmount(card, 5000), 0)).toBe(true);
  });
});

describe("demo seed", () => {
  test("nothing is logged after now, at any hour of the day", () => {
    for (const h of [0, 6, 7, 9, 14, 23]) {
      const now = new Date(2026, 9, 6, h, 5);
      const late = buildDemo(now).entries.filter((e) => new Date(e.date).getTime() > now.getTime());
      expect(late.map((e) => `${e.desc} ${e.date}`), `at ${h}:05`).toEqual([]);
    }
  });
  test("every invest is a move: two legs that share a linkId and sum to zero (D-0010)", () => {
    const demo = buildDemo(new Date(2026, 9, 15, 14));
    const invests = demo.entries.filter((e) => e.category === "Investments");
    expect(invests.length).toBeGreaterThan(0);
    const byLink = new Map<string, Entry[]>();
    for (const e of invests) {
      expect(e.linkId, e.id).toBeDefined();
      byLink.set(e.linkId!, [...(byLink.get(e.linkId!) ?? []), e]);
    }
    for (const legs of byLink.values()) {
      expect(legs).toHaveLength(2);
      expect(legs[0].amount + legs[1].amount).toBe(0);
      expect(legs[0].date).toBe(legs[1].date);
    }
  });
});
