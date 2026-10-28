// Review fixes in the capture path: deterministic ids (A), captured_at clock (C), review fields on
// the client Entry (D), refunds to Review and photo totals checked by the regex parser (E).
import { describe, expect, test } from "vitest";
import {
  applyGate, type CaptureContext, captureClock, captureIds, type ParsedEntry, planEntry, REFUND_REVIEW, summarize, toClientEntry, uuidV5,
} from "../../supabase/functions/_shared/capture_core";
import { runGate } from "../../supabase/functions/_shared/gate";
import type { AccountRow, AliasRow } from "../../supabase/functions/_shared/kb";

const GC = "00000000-0000-4000-8000-0000000000c1";
const BPI = "00000000-0000-4000-8000-0000000000b1";
const ACCOUNTS: AccountRow[] = [
  { id: BPI, name: "Payroll", provider: "bpi", provider_label: "BPI", type: "bank", last4: "2841" },
  { id: GC, name: "Daily wallet", provider: "gcash", provider_label: "GCash", type: "ewallet", last4: null },
];
const ALIASES: AliasRow[] = [{ account_id: GC, alias: "gcash" }, { account_id: BPI, alias: "bpi" }];
const CLIENT = "6f1c2b8e-1d3a-4c5b-9e7f-0a1b2c3d4e5f";
const NOW = new Date("2026-10-29T12:00:00+08:00");

const ctx = async (patch: Partial<CaptureContext> = {}, n = 3): Promise<CaptureContext> => ({
  kind: "text", rawInputId: CLIENT, sourceText: "grab gcash 248", storagePath: null,
  accounts: ACCOUNTS, aliases: ALIASES, rules: [], now: NOW, newId: await captureIds(CLIENT, n), ...patch,
});
const p = (patch: Partial<ParsedEntry> = {}): ParsedEntry => ({
  amount_span: "248", amount: 248, sign: "out", kind: "expense", account_hint: "gcash", to_account_hint: null,
  category: "Transport", merchant: "Grab", description: "Grab", occurred_at: null, ambiguous_fields: [], ...patch,
});
const gateOf = (plan: ReturnType<typeof planEntry>) => runGate({ ...plan.gate, duplicateOf: null, categoryMedian: null });

describe("A: ids derive from client_id", () => {
  test("uuidV5 matches the RFC 4122 vector", async () => {
    expect(await uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  test("a retry plans the same entry and move ids; entries and legs never collide", async () => {
    const parsed = [p(), p({ kind: "transfer", account_hint: "bpi", to_account_hint: "gcash", amount: 500, amount_span: "500", category: null })];
    const plan = async () => {
      const c = await ctx({ sourceText: "grab gcash 248, bpi to gcash 500" }, parsed.length);
      return parsed.map((x, i) => planEntry(x, c, null, i));
    };
    const [a, b] = [await plan(), await plan()];
    const ids = (ps: Awaited<ReturnType<typeof plan>>) => ps.flatMap((x) => x.legs.flatMap((l) => [l.id, l.move_id ?? ""])).filter(Boolean);
    expect(ids(a)).toEqual(ids(b));
    expect(new Set(ids(a)).size).toBe(4);
    for (const id of ids(a)) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const other = await captureIds("00000000-0000-4000-8000-000000000001", 1);
    expect(other("0:leg0")).not.toBe(a[0].legs[0].id);
  });

  test("asking for an id outside the capture is an error, not a random id", async () => {
    const id = await captureIds(CLIENT, 1);
    expect(() => id("1:leg0")).toThrow(/no capture id/);
  });
});

describe("C: captured_at is the capture's clock", () => {
  test("missing → server clock; in range → captured_at; unparseable → null", () => {
    expect(captureClock(undefined, NOW)).toEqual({ now: NOW, suspect: false });
    const yesterday = new Date(NOW.getTime() - 86_400_000);
    expect(captureClock(yesterday.toISOString(), NOW)).toEqual({ now: yesterday, suspect: false });
    expect(captureClock("not a date", NOW)).toBeNull();
    expect(captureClock(42, NOW)).toBeNull();
  });

  test("small clock skew is clamped to now; future or older than 30 days is suspect", () => {
    expect(captureClock(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toEqual({ now: NOW, suspect: false });
    expect(captureClock(new Date(NOW.getTime() + 3_600_000).toISOString(), NOW)).toEqual({ now: NOW, suspect: true });
    expect(captureClock(new Date(NOW.getTime() - 31 * 86_400_000).toISOString(), NOW)).toEqual({ now: NOW, suspect: true });
  });

  test("the date default and the future check use the capture clock; a suspect clock sends it to Review", async () => {
    const offline = new Date("2026-10-27T09:00:00+08:00");
    const plan = planEntry(p(), await ctx({ now: offline }), null);
    expect(plan.legs[0].occurred_at).toBe(offline.toISOString());
    // "tomorrow" relative to the capture time is in the future even if the server is later
    const later = planEntry(p({ occurred_at: "2026-10-28T09:00:00+08:00" }), await ctx({ now: offline }), null);
    expect(gateOf(later).failed_check).toBe("date_valid");
    const suspect = planEntry(p(), await ctx({ clockSuspect: true }), null);
    const g = gateOf(suspect);
    expect(g).toMatchObject({ passed: false, failed_check: "date_valid", question: "When did this happen?" });
    expect(applyGate(suspect, g)[0].status).toBe("review");
  });
});

describe("D: review fields on the client Entry", () => {
  test("status and reviewQuestion come through; void and empty are left out", () => {
    const base = { id: "e", account_id: null, category_code: null, amount: -5, occurred_at: "x", description: "" };
    expect(toClientEntry({ ...base, status: "review", review_question: "Which account did you pay from?" }))
      .toMatchObject({ status: "review", reviewQuestion: "Which account did you pay from?" });
    expect(toClientEntry({ ...base, status: "posted", review_question: null })).toEqual({
      id: "e", desc: "", accountId: null, category: null, amount: -5, date: "x", status: "posted",
    });
    expect(toClientEntry({ ...base, status: "void" })).not.toHaveProperty("status");
  });
});

describe("E: refunds and photo totals", () => {
  test("a refund always goes to Review with the one question", () => {
    expect(REFUND_REVIEW).toMatchObject({ passed: false, failed_check: "category_agreed", question: "Which purchase was this refund for?" });
    expect(summarize([{ passed: true, checks: [] }, REFUND_REVIEW]).passed).toBe(false);
  });

  const receipt = (text: string) => ({ text, merchant: "Puregold", items: [] });
  const photo = async (text: string, amount: number, span: string) =>
    planEntry(
      p({ amount, amount_span: span, category: "Groceries", merchant: "Puregold", description: "Puregold" }),
      await ctx({ kind: "photo", sourceText: text, storagePath: "u/r.jpg" }),
      receipt(text),
    );

  test("photo amount passes only when it equals the regex parser's TOTAL", async () => {
    const ok = await photo("PUREGOLD\nRICE 5KG 600.00\nTISSUE 200.00\nTOTAL 800.00", 800, "800.00");
    expect(gateOf(ok).checks.find((c) => c.name === "amount_literal")?.passed).toBe(true);
    // Claude picked a number that is in its own transcription but is not the receipt total
    const wrong = await photo("PUREGOLD\nRICE 5KG 600.00\nTISSUE 200.00\nTOTAL 800.00", 600, "600.00");
    expect(gateOf(wrong)).toMatchObject({ passed: false, failed_check: "amount_literal" });
    // no TOTAL line: the regex parser's total is the sum of the items it read
    const summed = await photo("PUREGOLD\nRICE 5KG 600.00\nTISSUE 200.00", 800, "800");
    expect(gateOf(summed).checks.find((c) => c.name === "amount_literal")?.passed).toBe(false); // 800 is not in the text
    const first = await photo("PUREGOLD\nRICE 5KG 600.00\nTISSUE 200.00", 600, "600.00");
    expect(gateOf(first).checks.find((c) => c.name === "amount_literal")).toMatchObject({ passed: false, detail: "receipt_total" });
  });

  test("text captures are unaffected by the receipt rule", async () => {
    const plan = planEntry(p(), await ctx(), null);
    expect(plan.gate.receiptTotal).toBeUndefined();
    expect(gateOf(plan).checks.find((c) => c.name === "amount_literal")?.passed).toBe(true);
  });
});
