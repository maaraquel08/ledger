import { describe, expect, test } from "vitest";
import { buildAnswer, fallbackAnswer, type ModelAnswer } from "../../supabase/functions/_shared/answer";
import { factify, FactRegistry, formatFact, peso, renderProse, strayDigits, userNumbers } from "../../supabase/functions/_shared/facts";

const E1 = "9f1e2d3c-0000-4000-8000-000000000001";
const E2 = "9f1e2d3c-0000-4000-8000-000000000002";
const E3 = "9f1e2d3c-0000-4000-8000-000000000003";

function packet() {
  const reg = new FactRegistry();
  const view = factify(
    {
      start: "2026-09-30T16:00:00+00:00",
      spend: { value: 24865, entry_ids: [E1, E2] },
      savings_rate: { value: 59, entry_ids: [E1] },
      entry_count: { value: 16, entry_ids: [E1, E2, E3] },
      by_category: [{ category_code: "Food & drink", value: 1500.4, share_pct: 74.4, entry_ids: [E2] }],
      entries: [{ id: E3, occurred_at: "2026-10-08T03:00:00+00:00", description: "7-Eleven", merchant: "7-Eleven", amount: -135 }],
    },
    reg,
    { label: "this month" },
  ) as Record<string, any>;
  return { reg, view };
}

describe("formatting", () => {
  test("pesos are whole, unsigned, en-PH like the app", () => {
    expect(peso(24865)).toBe("₱24,865");
    expect(peso(-1200.6)).toBe("₱1,201");
    expect(formatFact({ value: 74.4, kind: "pct" })).toBe("74%");
    expect(formatFact({ value: 2.345, kind: "months" })).toBe("2.3");
    expect(formatFact({ value: 4, kind: "ratio" })).toBe("4.0×");
    expect(formatFact({ value: 1234, kind: "count" })).toBe("1,234");
    expect(formatFact({ value: null, kind: "peso" })).toBe("no data");
  });
});

describe("factify", () => {
  test("every number becomes a fact; entry ids stay server-side", () => {
    const { reg, view } = packet();
    expect(view.spend).toEqual({ fact: "f1", shows: "₱24,865", entries: 2 });
    expect(view.savings_rate.shows).toBe("59%");
    expect(view.entry_count.shows).toBe("16");
    expect(view.by_category[0].value.shows).toBe("₱1,500");
    expect(view.by_category[0].share_pct.shows).toBe("74%");
    expect(view.by_category[0].entries).toBe(1);
    expect(reg.get(view.by_category[0].value.fact)!.entry_ids).toEqual([E2]); // sibling entry_ids source the row
    expect(view.entries[0].amount).toEqual({ fact: expect.any(String), shows: "₱135" });
    expect(view.entries[0].direction).toBe("out");
    expect(reg.get(view.entries[0].amount.fact)!.entry_ids).toEqual([E3]); // an entry row sources its own numbers
    expect(view.entries[0].id).toBe(E3);
    expect(JSON.stringify(view)).not.toContain("entry_ids");
  });
});

describe("placeholder rendering and the digit validator", () => {
  test("placeholders render from facts", () => {
    const { reg } = packet();
    const r = renderProse("You spent {{f1}} this month, saving {{ f2 }}.", reg);
    expect(r.text).toBe("You spent ₱24,865 this month, saving 59%.");
    expect(r.used).toEqual(["f1", "f2"]);
    expect(r.violations).toEqual([]);
  });

  test("adversarial: a literal ₱5,000 is rejected", () => {
    const { reg } = packet();
    const r = renderProse("You could save ₱5,000 a month.", reg);
    expect(r.violations).toEqual(['number not from a fact: "₱5,000"']);
  });

  test("adversarial: writing a fact's own number literally is still rejected", () => {
    const { reg } = packet();
    expect(renderProse("You spent ₱24,865 this month.", reg).violations).toHaveLength(1);
    expect(renderProse("That's 59% of income.", reg).violations).toHaveLength(1);
  });

  test("adversarial: unknown fact ids, years, digits glued to words", () => {
    const { reg } = packet();
    expect(renderProse("You spent {{f99}}.", reg).violations).toContain("unknown fact f99");
    expect(strayDigits("Since 2025 you've done well.", reg)).toEqual(["2025"]);
    expect(strayDigits("Top 3 categories", reg)).toEqual(["3"]);
    expect(strayDigits("a 17-Eleven run", reg)).toEqual(["17-"]); // "7-Eleven" literal can't hide a bigger number
  });

  test("allowed: merchant names and dates from tool results, and M8", () => {
    const { reg } = packet();
    expect(renderProse("Your 7-Eleven run on Oct 8 was {{f1}}. M8 checked.", reg).violations).toEqual([]);
    expect(renderProse("On October 8, 2026 you went to 7-eleven.", reg).violations).toEqual([]);
    expect(renderProse("On Oct 9 you went out.", reg).violations).toHaveLength(1); // not a date in the data
  });

  test("numbers the Owner asked about become facts", () => {
    const reg = new FactRegistry();
    const ids = userNumbers("Can I afford a ₱65,000 laptop or a 1.5k bag?", reg);
    expect(ids.map((id) => reg.display(id))).toEqual(["₱65,000", "₱1,500"]);
  });
});

describe("Answer assembly", () => {
  const model = (patch: Partial<ModelAnswer> = {}): ModelAnswer => ({
    text: "You spent {{f1}} this month across {{f3}} entries.",
    marks: ["{{f1}} this month", "not in text"],
    matched_label: "spending entries",
    matched_fact: "f3",
    bars: { title: "Where it went", kind: "share", items: [{ label: "Food & drink", fact: "f4" }] },
    compare: null,
    ask: null,
    offer: null,
    source_facts: ["f1"],
    followups: ["What should I cut first?"],
    ...patch,
  });

  test("valid model output → client Answer with numbers, bars and sources from facts only", () => {
    const { reg } = packet();
    const { answer, violations } = buildAnswer(model(), reg, { year: 2026 });
    expect(violations).toEqual([]);
    expect(answer).toEqual({
      read: 3,
      matched: { n: 16, label: "spending entries" },
      compareYear: 2025,
      text: "You spent ₱24,865 this month across 16 entries.",
      marks: ["₱24,865 this month"],
      bars: { title: "WHERE IT WENT", kind: "share", items: [{ label: "Food & drink", value: 1500.4, display: "₱1,500" }] },
      sources: [E1, E2, E3],
      followups: ["What should I cut first?"],
    });
    // exactly the keys of the client type, nothing extra
    expect(Object.keys(answer).sort()).toEqual(["bars", "compareYear", "followups", "marks", "matched", "read", "sources", "text"]);
  });

  test("a literal number anywhere (text, followups, bar labels) is a violation", () => {
    const { reg } = packet();
    expect(buildAnswer(model({ text: "You could save ₱5,000." }), reg, { year: 2026 }).violations.length).toBe(1);
    expect(buildAnswer(model({ followups: ["Cut 10%?"] }), reg, { year: 2026 }).violations.length).toBe(1);
    expect(buildAnswer(model({ bars: { title: "x", kind: "share", items: [{ label: "Top 3", fact: "f4" }] } }), reg, { year: 2026 }).violations.length).toBe(1);
    expect(buildAnswer(model({ compare: { title: "If you buy", now_fact: "f99", after_fact: "f1", unit: "mo" } }), reg, { year: 2026 }).violations.length).toBe(1);
  });

  test("fallback template only uses facts and is digit-safe by construction", () => {
    const { reg } = packet();
    const a = fallbackAnswer(reg, { year: 2026 });
    expect(a.text).toBe("Here’s what the numbers say. This month: spend: ₱24,865; This month: savings rate: 59%; This month: entry count: 16.");
    expect(a.sources.sort()).toEqual([E1, E2, E3]);
    expect(fallbackAnswer(new FactRegistry(), { year: 2026 }).text).not.toMatch(/\d/);
  });
});
