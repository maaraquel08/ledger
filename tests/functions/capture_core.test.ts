import { describe, expect, test } from "vitest";
import {
  applyGate, type CaptureContext, matchRule, type ParsedEntry, planEntry, resolveAccount, segmentFor, summarize, toClientEntry,
} from "../../supabase/functions/_shared/capture_core";
import { runGate } from "../../supabase/functions/_shared/gate";
import type { AccountRow, AliasRow, RuleRow } from "../../supabase/functions/_shared/kb";

const BPI = "00000000-0000-4000-8000-0000000000b1";
const GC = "00000000-0000-4000-8000-0000000000c1";
const IB = "00000000-0000-4000-8000-0000000000d1";
const ACCOUNTS: AccountRow[] = [
  { id: BPI, name: "Payroll", provider: "bpi", provider_label: "BPI", type: "bank", last4: "2841" },
  { id: GC, name: "Daily wallet", provider: "gcash", provider_label: "GCash", type: "ewallet", last4: null },
  { id: IB, name: "IBKR", provider: "ibkr", provider_label: "IBKR", type: "investments", last4: null },
];
const ALIASES: AliasRow[] = [
  { account_id: GC, alias: "gcash" },
  { account_id: BPI, alias: "bpi" },
];

let n = 0;
const ctx = (patch: Partial<CaptureContext> = {}): CaptureContext => ({
  kind: "text",
  rawInputId: "00000000-0000-4000-8000-00000000aaaa",
  sourceText: "grab gcash 248",
  storagePath: null,
  accounts: ACCOUNTS,
  aliases: ALIASES,
  rules: [],
  now: new Date("2026-10-29T12:00:00+08:00"),
  newId: () => `id-${++n}`,
  ...patch,
});
const p = (patch: Partial<ParsedEntry> = {}): ParsedEntry => ({
  amount_span: "248", amount: 248, sign: "out", kind: "expense", account_hint: "gcash", to_account_hint: null,
  category: "Transport", merchant: "Grab", description: "Grab", occurred_at: null, ambiguous_fields: [], ...patch,
});

describe("account resolution is exact", () => {
  test("alias, own name, last four; nothing fuzzy", () => {
    expect(resolveAccount("GCash ", ACCOUNTS, ALIASES)).toBe(GC);
    expect(resolveAccount("payroll", ACCOUNTS, ALIASES)).toBe(BPI);
    expect(resolveAccount("2841", ACCOUNTS, ALIASES)).toBe(BPI);
    expect(resolveAccount("my gcash", ACCOUNTS, ALIASES)).toBeNull();
    expect(resolveAccount("gc", ACCOUNTS, ALIASES)).toBeNull();
    expect(resolveAccount(null, ACCOUNTS, ALIASES)).toBeNull();
    expect(resolveAccount("gcash", [{ ...ACCOUNTS[1], archived_at: "2026-01-01" }], ALIASES)).toBeNull();
  });
});

describe("learned rules", () => {
  const rules: RuleRow[] = [
    { id: "b", match: { text_contains: "palengke" }, set: { category_code: "Groceries" } },
    { id: "a", match: { merchant: "grab" }, set: { category_code: "Food & drink", account_id: BPI } },
    { id: "c", match: { merchant: "grab" }, set: { category_code: "Other" }, active: false },
  ];
  test("merchant rules beat text rules; inactive rules ignored; order-independent", () => {
    expect(matchRule({ merchant: "Grab", description: "palengke run" }, "", rules)).toEqual({ rule_id: "a", category_code: "Food & drink", account_id: BPI });
    expect(matchRule({ merchant: "Grab", description: "x" }, "", [...rules].reverse())?.rule_id).toBe("a");
    expect(matchRule({ merchant: null, description: "veggies" }, "palengke 300", rules)?.rule_id).toBe("b");
    expect(matchRule({ merchant: "Shell", description: "gas" }, "shell 1500", rules)).toBeNull();
  });

  test("a rule overrides Claude's category and account, and counts as an agreed category", () => {
    const plan = planEntry(p({ category: "Transport" }), ctx({ rules }), null);
    expect(plan.legs[0]).toMatchObject({ category_code: "Food & drink", account_id: BPI, created_by: "rule", rule_id: "a" });
    expect(plan.gate.categoryFromRule).toBe(true);
  });
});

describe("planning entries", () => {
  test("expense: one signed leg, regex agrees → gate passes", () => {
    const plan = planEntry(p(), ctx(), null);
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0]).toMatchObject({ amount: -248, account_id: GC, category_code: "Transport", merchant: "Grab", raw: "grab gcash 248", created_by: "claude", status: "posted" });
    expect(plan.gate.regexCategory).toBe("Transport");
    expect(runGate({ ...plan.gate, duplicateOf: null, categoryMedian: null }).passed).toBe(true);
  });

  test("multi-entry sentence: the regex reads only this entry's segment", () => {
    const text = "Groceries at SM 2,340 cash, Meralco 3,100 from BPI";
    expect(segmentFor(text, "3,100")).toBe("Meralco 3,100 from BPI");
    const plan = planEntry(p({ amount_span: "3,100", amount: 3100, account_hint: "bpi", category: "Rent & bills", merchant: "Meralco", description: "Meralco" }), ctx({ sourceText: text }), null);
    expect(plan.gate.regexCategory).toBe("Rent & bills");
    expect(plan.legs[0]).toMatchObject({ amount: -3100, account_id: BPI });
  });

  test("income is positive", () => {
    const plan = planEntry(p({ kind: "income", sign: "in", amount: 48000, amount_span: "48,000", category: "Salary", account_hint: "bpi" }), ctx({ sourceText: "sahod 48,000 bpi" }), null);
    expect(plan.legs[0].amount).toBe(48000);
  });

  test("transfer: two legs that sum to zero, same move id, category fixed by kind", () => {
    const plan = planEntry(p({ kind: "transfer", account_hint: "bpi", to_account_hint: "gcash", amount: 5000, amount_span: "5k", category: null, merchant: null, description: "" }), ctx({ sourceText: "bpi to gcash 5k" }), null);
    expect(plan.legs).toHaveLength(2);
    const [from, to] = plan.legs;
    expect(from.amount + to.amount).toBe(0);
    expect(from).toMatchObject({ account_id: BPI, amount: -5000, category_code: "Transfer", move_kind: "transfer", description: "To Daily wallet" });
    expect(to).toMatchObject({ account_id: GC, amount: 5000, category_code: "Transfer", description: "From Payroll" });
    expect(from.move_id).toBe(to.move_id);
    expect(plan.needsDataChecks).toBe(false);
  });

  test("invest move; unresolved destination fails the gate and both legs go to Review", () => {
    const plan = planEntry(p({ kind: "invest", account_hint: "bpi", to_account_hint: "col financial", amount: 8000, amount_span: "8000", category: null }), ctx({ sourceText: "bpi col financial 8000" }), null);
    expect(plan.legs.map((l) => l.move_kind)).toEqual(["invest", "invest"]);
    expect(plan.legs.map((l) => l.category_code)).toEqual(["Investments", "Investments"]);
    const gate = runGate({ ...plan.gate, duplicateOf: null, categoryMedian: null });
    expect(gate.failed_check).toBe("account_alias");
    const legs = applyGate(plan, gate);
    expect(legs.map((l) => l.status)).toEqual(["review", "review"]);
    expect(legs[0].review_question).toBe("Which account did the money go to?");
    expect(summarize([{ passed: true, checks: [] }, gate])).toEqual({ passed: false, failed_check: "account_alias", question: "Which account did the money go to?" });
  });

  test("receipt photo: items, splits, image path, regex reads Claude's receipt text", () => {
    const receiptText = "PUREGOLD\nRICE 5KG 600.00\nTISSUE 12R 200.00\nTOTAL 800.00\nGCASH 800.00";
    const plan = planEntry(
      p({ amount_span: "800.00", amount: 800, account_hint: "gcash", category: "Groceries", merchant: "Puregold", description: "Puregold" }),
      ctx({ kind: "photo", sourceText: receiptText, storagePath: "u/r.jpg" }),
      { text: receiptText, merchant: "Puregold", items: [{ name: "Rice 5kg", amount: 600, category: "Groceries", unsure: false }, { name: "Tissue 12R", amount: 200, category: "Household", unsure: true }] },
    );
    const leg = plan.legs[0];
    expect(leg).toMatchObject({ amount: -800, source: "receipt", raw: null, receipt_image_path: "u/r.jpg", category_code: "Groceries" });
    expect(leg.receipt_items).toEqual([
      { name: "Rice 5kg", amount: 600, category_code: "Groceries", unsure: false },
      { name: "Tissue 12R", amount: 200, category_code: "Household", unsure: true },
    ]);
    expect(leg.splits).toEqual([
      { category_code: "Groceries", amount: 600, items: ["Rice 5kg"] },
      { category_code: "Household", amount: 200, items: ["Tissue 12R"] },
    ]);
    expect(plan.gate.regexCategory).toBe("Groceries");
    expect(plan.gate.sourceText).toBe(receiptText);
  });
});

describe("EntryJson → client Entry", () => {
  test("exact client shape", () => {
    const e = toClientEntry({
      id: "e1", account_id: GC, category_code: "Groceries", amount: "-800.00", occurred_at: "2026-10-29T04:00:00+00:00",
      description: "Puregold", raw: null, method: null, auto: false, refunded_at: null, move_id: null, source: "receipt",
      splits: [{ category_code: "Groceries", amount: 600, items: ["Rice"] }, { category_code: "Household", amount: 200, items: ["Tissue"] }],
      receipt_items: [{ name: "Rice", amount: 600, category_code: "Groceries", unsure: false }, { name: "Tissue", amount: 200, category_code: "Household", unsure: true }],
    });
    expect(e).toEqual({
      id: "e1", desc: "Puregold", accountId: GC, category: "Groceries", amount: -800, date: "2026-10-29T04:00:00+00:00", source: "receipt",
      split: [{ category: "Groceries", amount: 600, items: ["Rice"] }, { category: "Household", amount: 200, items: ["Tissue"] }],
      receipt: { items: [{ name: "Rice", amount: 600, category: "Groceries" }, { name: "Tissue", amount: 200, category: "Household", unsure: true }] },
    });
    expect(toClientEntry({ id: "e2", account_id: null, category_code: "Adjustment", amount: 5, occurred_at: "x", description: "", move_id: "m", refunded_at: "y" }))
      .toEqual({ id: "e2", desc: "", accountId: null, category: null, amount: 5, date: "x", linkId: "m", refunded: true });
  });
});
