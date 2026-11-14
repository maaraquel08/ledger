import { describe, expect, test } from "vitest";
import { callsFor, overlay } from "../../src/lib/cloud/outbox";
import { subscriptionPayload, toSubscription } from "../../src/lib/cloud/map";
import { reducer } from "../../src/lib/store";
import { EMPTY_STATE } from "../../src/lib/seed";
import type { Subscription } from "../../src/lib/types";

const sub: Subscription = { id: "s1", name: "Netflix", amount: 549, day: 18, startsOn: "2026-11-18", accountId: "a1", category: "Subscriptions" };

describe("subscription sync", () => {
  test("upsert-subscription writes a signed monthly active recurring_items row", () => {
    expect(callsFor({ type: "upsert-subscription", sub }, EMPTY_STATE)).toEqual([
      {
        kind: "upsert",
        table: "recurring_items",
        onConflict: "id",
        rows: {
          id: "s1",
          description: "Netflix",
          amount: -549,
          day_of_month: 18,
          starts_on: "2026-11-18",
          account_id: "a1",
          category_code: "Subscriptions",
          cadence: "monthly",
          active: true,
        },
      },
    ]);
  });

  test("remove-subscription sets active = false and keeps the row", () => {
    expect(callsFor({ type: "remove-subscription", id: "s1" }, EMPTY_STATE)).toEqual([
      { kind: "update", table: "recurring_items", values: { active: false }, id: "s1" },
    ]);
  });

  test("a subscription with no account sends account_id null", () => {
    const c = callsFor({ type: "upsert-subscription", sub: { ...sub, accountId: null } }, EMPTY_STATE)![0];
    expect(c.kind === "upsert" && (c.rows as Record<string, unknown>).account_id).toBeNull();
  });

  test("round-trips through a row, including string numerics and a negative amount", () => {
    expect(toSubscription(subscriptionPayload(sub))).toEqual(sub);
    const row = { id: "s2", description: "Spotify", amount: "-149.00", day_of_month: "5", starts_on: "2026-12-05", account_id: null, category_code: "Subscriptions" };
    expect(toSubscription(row)).toEqual({ id: "s2", name: "Spotify", amount: 149, day: 5, startsOn: "2026-12-05", accountId: null, category: "Subscriptions" });
  });

  test("unsent actions replay over server state", () => {
    const cmd = (action: Parameters<typeof callsFor>[0]) => ({ id: "c", at: 0, action, calls: [], done: 0, tries: 0 });
    const added = overlay(EMPTY_STATE, [cmd({ type: "upsert-subscription", sub })], reducer);
    expect(added.subscriptions).toEqual([sub]);
    const removed = overlay(added, [cmd({ type: "remove-subscription", id: "s1" })], reducer);
    expect(removed.subscriptions).toEqual([]);
  });
});
