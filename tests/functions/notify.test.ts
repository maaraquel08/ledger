import { describe, expect, test } from "vitest";
import { decidePush, inQuietHours, type PushSettings, pushText, quietEndsAt } from "../../supabase/functions/_shared/notify_policy";

const S: PushSettings = { pushEnabled: true, timezone: "Asia/Manila", quietStart: "22:00:00", quietEnd: "07:00:00", maxPerWeek: 3 };
const manila = (hhmm: string, day = 1) => new Date(`2026-11-0${day}T${hhmm}:00+08:00`);
const weekly = { kind: "weekly" as const, material: false };

describe("push policy (D-0016)", () => {
  test("weekly review and material alerts only", () => {
    const at = manila("20:00");
    expect(decidePush(weekly, S, 0, at)).toEqual({ action: "send" });
    expect(decidePush({ kind: "alert", material: true }, S, 0, at)).toEqual({ action: "send" });
    expect(decidePush({ kind: "alert", material: false }, S, 0, at)).toEqual({ action: "skip", reason: "not_pushable" });
    expect(decidePush({ kind: "daily", material: false }, S, 0, at)).toEqual({ action: "skip", reason: "not_pushable" });
    expect(decidePush({ kind: "monthly", material: false }, S, 0, at)).toEqual({ action: "skip", reason: "not_pushable" });
  });

  test("push off → skip", () => {
    expect(decidePush(weekly, { ...S, pushEnabled: false }, 0, manila("20:00"))).toEqual({ action: "skip", reason: "push_disabled" });
  });

  test("at most 3 a week, and the Owner can only lower it", () => {
    expect(decidePush(weekly, S, 2, manila("20:00")).action).toBe("send");
    expect(decidePush(weekly, S, 3, manila("20:00"))).toEqual({ action: "skip", reason: "weekly_limit" });
    expect(decidePush(weekly, { ...S, maxPerWeek: 10 }, 3, manila("20:00"))).toEqual({ action: "skip", reason: "weekly_limit" });
    expect(decidePush(weekly, { ...S, maxPerWeek: 1 }, 1, manila("20:00"))).toEqual({ action: "skip", reason: "weekly_limit" });
    expect(decidePush(weekly, { ...S, maxPerWeek: 0 }, 0, manila("20:00"))).toEqual({ action: "skip", reason: "weekly_limit" });
  });

  test("quiet hours 22:00–07:00 Manila defer to 07:00, never drop", () => {
    expect(inQuietHours(manila("21:59"), S)).toBe(false);
    expect(inQuietHours(manila("22:00"), S)).toBe(true);
    expect(inQuietHours(manila("03:30"), S)).toBe(true);
    expect(inQuietHours(manila("07:00"), S)).toBe(false);

    const late = decidePush(weekly, S, 0, manila("23:15", 1));
    expect(late).toEqual({ action: "defer", reason: "quiet_hours", until: new Date("2026-11-02T07:00:00+08:00") });
    const early = decidePush({ kind: "alert", material: true }, S, 0, manila("05:00", 2));
    expect(early).toEqual({ action: "defer", reason: "quiet_hours", until: new Date("2026-11-02T07:00:00+08:00") });
  });

  test("quiet hours follow the Owner's timezone, not the server's", () => {
    const ny = { ...S, timezone: "America/New_York" };
    // 2026-11-01T12:00Z = 07:00 New York (EST after the DST change) and 20:00 Manila
    expect(inQuietHours(new Date("2026-11-01T11:59:00Z"), ny)).toBe(true);
    expect(inQuietHours(new Date("2026-11-01T12:00:00Z"), ny)).toBe(false);
    expect(quietEndsAt(new Date("2026-11-01T04:00:00Z"), ny).toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });

  test("a daytime quiet window (start < end) works too", () => {
    const s = { ...S, quietStart: "13:00", quietEnd: "14:00" };
    expect(inQuietHours(manila("13:30"), s)).toBe(true);
    expect(inQuietHours(manila("14:30"), s)).toBe(false);
    expect(quietEndsAt(manila("13:30"), s)).toEqual(manila("14:00"));
  });

  test("push text never contains an amount (or any digit)", () => {
    for (const k of ["weekly", "monthly", "alert"] as const)
      for (const a of [undefined, "category_spike", "recurring_missed", "reconciliation_gap", "likely_duplicate", "other"]) {
        const t = pushText(k, a);
        expect(t.title).toBe("M8"); // the persona's name is the only digit allowed
        expect(t.body).not.toMatch(/[\d₱]/);
      }
  });
});
