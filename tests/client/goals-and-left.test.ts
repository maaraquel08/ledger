import { describe, expect, test } from "vitest";
import { categoryRows } from "../../src/lib/analytics";
import { MAX_AMOUNT } from "../../src/lib/format";
import { addToGoal, goalProgress } from "../../src/lib/selectors";
import type { Entry, Goal } from "../../src/lib/types";

const goal: Goal = { id: "g1", name: "Trip", saved: 1000, target: 5000, by: "" };

describe("goal add money", () => {
  test("adds to saved, shows what is to go", () => {
    const g = addToGoal(goal, 500);
    expect(g.saved).toBe(1500);
    expect(goalProgress(g)).toEqual({ pct: 30, toGo: 3500 });
  });
  test("ignores zero, negative and non-finite amounts", () => {
    for (const n of [0, -50, NaN, Infinity]) expect(addToGoal(goal, n)).toBe(goal);
  });
  test("may pass the target but never the ceiling; to-go floors at 0", () => {
    expect(goalProgress(addToGoal(goal, 9000)).toGo).toBe(0);
    expect(addToGoal(goal, 99_999_999).saved).toBe(MAX_AMOUNT);
  });
});

describe("unfiled spend", () => {
  const es: Entry[] = [
    { id: "a", desc: "mystery", accountId: "x", category: null, amount: -300, date: new Date(2026, 9, 2).toISOString() },
    { id: "b", desc: "grab", accountId: "x", category: "Transport", amount: -100, date: new Date(2026, 9, 3).toISOString() },
  ];
  test("category chart rows carry bar fractions summing to 1", () => {
    const rows = categoryRows(es, []);
    expect(rows.map((r) => r.cat)).toEqual(["Unfiled", "Transport"]);
    expect(rows[0].fraction).toBeCloseTo(0.75);
    expect(rows.reduce((n, r) => n + r.fraction, 0)).toBeCloseTo(1);
  });
});
