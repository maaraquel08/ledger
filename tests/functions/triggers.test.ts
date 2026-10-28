import { describe, expect, test } from "vitest";
import { alertTemplate, reviewTemplate } from "../../supabase/functions/_shared/narrate";
import { type ExistingInsight, headline, isQuiet, type PeriodCompare, reviewNotables, shouldWrite, subjectOf } from "../../supabase/functions/_shared/triggers";

const NOW = new Date("2026-10-29T12:00:00Z");
const f = (value: number, ids: string[] = []) => ({ value, entry_ids: ids });
const cmp = (patch: Partial<PeriodCompare> = {}): PeriodCompare => ({
  current: { spend: f(10000, ["a"]), income: f(0), entry_count: f(5) },
  previous: { spend: f(9800), income: f(0), entry_count: f(4) },
  delta: { spend: { value: 200, pct: 2 } },
  by_category: [{ category_code: "Food & drink", current: f(3000), previous: f(2900), delta: 100 }],
  ...patch,
});

describe("cooldown and suppression", () => {
  const ins = (fingerprint: string, created: string, dismissed: string | null = null, kind = "alert"): ExistingInsight => ({ kind, fingerprint, created_at: created, dismissed_at: dismissed });

  test("one insight per fingerprint; dismissed never comes back", () => {
    expect(shouldWrite("weekly", "weekly:2026-10-26", [], NOW)).toEqual({ write: true });
    expect(shouldWrite("weekly", "weekly:2026-10-26", [ins("weekly:2026-10-26", "2026-10-26", null, "weekly")], NOW)).toEqual({ write: false, reason: "exists" });
    expect(shouldWrite("alert", "category_spike:Health:2026-10", [ins("category_spike:Health:2026-10", "2026-10-01", "2026-10-02")], NOW)).toEqual({ write: false, reason: "dismissed" });
  });

  test("alerts cool down per subject for a week", () => {
    expect(subjectOf("category_spike:Health:2026-10")).toBe("category_spike:Health");
    const recent = [ins("category_spike:Health:2026-09", "2026-10-25T00:00:00Z")];
    expect(shouldWrite("alert", "category_spike:Health:2026-10", recent, NOW)).toEqual({ write: false, reason: "cooldown" });
    expect(shouldWrite("alert", "category_spike:Food:2026-10", recent, NOW)).toEqual({ write: true });
    const old = [ins("category_spike:Health:2026-09", "2026-09-01T00:00:00Z")];
    expect(shouldWrite("alert", "category_spike:Health:2026-10", old, NOW)).toEqual({ write: true });
  });

  test("a subject dismissed twice in 90 days is suppressed", () => {
    const dismissed = [
      ins("recurring_missed:item1:2026-08-08", "2026-08-11", "2026-08-12"),
      ins("recurring_missed:item1:2026-09-08", "2026-09-11", "2026-09-12"),
    ];
    expect(shouldWrite("alert", "recurring_missed:item1:2026-10-08", dismissed, NOW)).toEqual({ write: false, reason: "suppressed" });
  });
});

describe("review triggers", () => {
  test("nothing notable → nothing to flag (no Claude call)", () => {
    expect(reviewNotables(cmp(), [])).toEqual([]);
    expect(reviewTemplate("weekly", cmp()).narrative).toBe("Nothing to flag this week. You spent ₱10,000.");
  });

  test("quiet period", () => {
    const quiet = cmp({ current: { spend: f(0), income: f(0), entry_count: f(0) } });
    expect(isQuiet(quiet)).toBe(true);
    expect(reviewTemplate("monthly", quiet).narrative).toBe("Nothing was logged last month, so there’s nothing to flag.");
  });

  test("notables are digit-free hints", () => {
    const notes = reviewNotables(
      cmp({
        delta: { spend: { value: 4000, pct: 40 } },
        by_category: [{ category_code: "Shopping", current: f(5000), previous: f(1000), delta: 4000 }],
        current: { spend: f(14000), income: f(12000), entry_count: f(9) },
      }),
      [{ kind: "category_spike", severity: "warn", fingerprint: "x", facts: {}, entry_ids: [] }, { kind: "likely_duplicate", severity: "info", fingerprint: "y", facts: {}, entry_ids: [] }],
    );
    expect(notes).toEqual(["spending is up versus the previous period", "Shopping moved the most versus the previous period", "spending was above income", "open alert: category spike"]);
    for (const n of notes) expect(n).not.toMatch(/\d/);
  });

  test("alert templates render numbers from facts only", () => {
    expect(alertTemplate({ kind: "category_spike", facts: { category_code: "Health", current: f(4000), trailing_avg: f(1000), ratio: 4 }, entry_ids: ["a"] }).narrative)
      .toBe("Health is at ₱4,000 this month, well above your usual ₱1,000.");
    expect(alertTemplate({ kind: "reconciliation_gap", facts: { name: "Daily wallet", gap: -152 }, entry_ids: [] }).narrative).toContain("₱152 off");
  });

  test("headline = first sentence", () => {
    expect(headline("Spending is up. Shopping led it.")).toBe("Spending is up.");
  });
});
