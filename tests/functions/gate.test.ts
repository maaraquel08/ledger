import { describe, expect, test } from "vitest";
import { amountIsLiteral, CHECKS, type GateInput, numbersIn, runGate } from "../../supabase/functions/_shared/gate";

const NOW = new Date("2026-10-29T12:00:00+08:00");
const ok: GateInput = {
  sourceText: "grab gcash 248",
  amountSpan: "248",
  amount: 248,
  kind: "expense",
  accountResolved: true,
  category: "Transport",
  categoryFromRule: false,
  regexCategory: "Transport",
  occurredAt: null,
  now: NOW,
  duplicateOf: null,
  categoryMedian: 200,
  ambiguousFields: [],
  merchant: "Grab",
};

describe("confidence gate", () => {
  test("everything passes → saved, all seven checks ran in order", () => {
    const g = runGate(ok);
    expect(g.passed).toBe(true);
    expect(g.failed_check).toBeUndefined();
    expect(g.checks.map((c) => c.name)).toEqual([...CHECKS]);
  });

  const cases: [string, Partial<GateInput>, string, RegExp][] = [
    ["amount_literal: span not in text", { amountSpan: "284", amount: 284 }, "amount_literal", /exact amount/],
    ["amount_literal: span in text but value differs", { amountSpan: "248", amount: 284 }, "amount_literal", /exact amount/],
    ["account_alias: unresolved", { accountResolved: false }, "account_alias", /pay from/],
    ["account_alias: transfer destination unresolved", { kind: "transfer", toAccountResolved: false, regexCategory: "Transfer", category: "Transfer" }, "account_alias", /go to/],
    ["category_agreed: regex disagrees", { regexCategory: "Food & drink" }, "category_agreed", /Should this go under Transport\?/],
    ["category_agreed: regex has no opinion", { regexCategory: null }, "category_agreed", /Transport/],
    ["category_agreed: no category", { category: null }, "category_agreed", /Which category/],
    ["date_valid: future", { occurredAt: "2026-10-30T12:00:00+08:00" }, "date_valid", /When/],
    ["date_valid: unparseable", { occurredAt: "kahapon" }, "date_valid", /When/],
    ["not_duplicate", { duplicateOf: "9f1e2d3c-0000-4000-8000-000000000000" }, "not_duplicate", /second Grab/],
    ["amount_typical: over 3× median", { amountSpan: "2,500", sourceText: "grab gcash 2,500", amount: 2500, categoryMedian: 500 }, "amount_typical", /much bigger than your usual Transport/],
    ["unambiguous", { ambiguousFields: ["category", "account"] }, "unambiguous", /confirm the category/],
  ];
  test.each(cases)("%s → fails with one targeted question", (_n, patch, check, question) => {
    const g = runGate({ ...ok, ...patch });
    expect(g.passed).toBe(false);
    expect(g.failed_check).toBe(check);
    expect(g.question).toMatch(question);
  });

  test("passing variants", () => {
    expect(runGate({ ...ok, regexCategory: "Food & drink", categoryFromRule: true }).passed).toBe(true); // learned rule wins
    expect(runGate({ ...ok, occurredAt: "2026-10-28T09:00:00+08:00" }).passed).toBe(true);
    expect(runGate({ ...ok, occurredAt: new Date(NOW.getTime() + 60_000).toISOString() }).passed).toBe(true); // clock slack
    expect(runGate({ ...ok, categoryMedian: null, amount: 99_999, amountSpan: "99,999", sourceText: "grab 99,999 gcash" }).passed).toBe(true); // no history
    expect(runGate({ ...ok, amount: 600, amountSpan: "600", sourceText: "grab gcash 600", categoryMedian: 200 }).passed).toBe(true); // exactly 3×
    expect(runGate({ ...ok, kind: "transfer", toAccountResolved: true }).passed).toBe(true);
  });

  test("the first failing check is the one asked about", () => {
    const g = runGate({ ...ok, accountResolved: false, duplicateOf: "x", ambiguousFields: ["amount"] });
    expect(g.failed_check).toBe("account_alias");
    expect(g.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(["account_alias", "not_duplicate", "unambiguous"]);
  });

  test("questions never carry an amount", () => {
    for (const [, patch] of cases) expect(runGate({ ...ok, ...patch }).question).not.toMatch(/\d/);
  });
});

describe("amount literal", () => {
  test("numbers in Taglish text, commas, k and pesos", () => {
    expect(numbersIn("Groceries sa SM ₱2,340 tapos 1.5k sa grab")).toEqual([2340, 1500]);
    expect(amountIsLiteral("Groceries sa SM ₱2,340 cash", "₱2,340", 2340)).toBe(true);
    expect(amountIsLiteral("load 1.5k gcash", "1.5k", 1500)).toBe(true);
    expect(amountIsLiteral("load 1.5k gcash", "1500", 1500)).toBe(false); // not what was written
    expect(amountIsLiteral("TOTAL   1,234.50\nCASH 1,500.00", "1,234.50", 1234.5)).toBe(true);
    expect(amountIsLiteral("lunch", "", 250)).toBe(false);
  });
});
