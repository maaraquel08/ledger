// Web Push limits (D-0016). Pure module.
//   - only the weekly review and material alerts are pushed
//   - at most 3 pushes in any 7 days (profiles.push_max_per_week, capped at 3)
//   - no amounts (no digits at all) in push text
//   - quiet hours 22:00–07:00 in the Owner's timezone: defer to the end, never drop

import { localParts, tzOffsetMs } from "./time.ts";

export type InsightKind = "daily" | "weekly" | "monthly" | "alert" | "answer";

export interface PushCandidate {
  kind: InsightKind;
  /** alerts: insights.metrics.material */
  material: boolean;
}

export interface PushSettings {
  pushEnabled: boolean;
  timezone: string;
  quietStart: string; // "22:00" or "22:00:00"
  quietEnd: string; // "07:00"
  maxPerWeek: number;
}

export type PushDecision =
  | { action: "send" }
  | { action: "defer"; until: Date; reason: "quiet_hours" }
  | { action: "skip"; reason: "push_disabled" | "not_pushable" | "weekly_limit" };

export const HARD_WEEKLY_MAX = 3;

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h % 24) * 60 + (m || 0);
};

export function inQuietHours(at: Date, s: Pick<PushSettings, "timezone" | "quietStart" | "quietEnd">): boolean {
  const p = localParts(at, s.timezone);
  const now = p.hour * 60 + p.minute;
  const start = minutes(s.quietStart);
  const end = minutes(s.quietEnd);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** The next instant quiet hours end (local quietEnd), as UTC. */
export function quietEndsAt(at: Date, s: Pick<PushSettings, "timezone" | "quietEnd">): Date {
  const p = localParts(at, s.timezone);
  const end = minutes(s.quietEnd);
  const nowMin = p.hour * 60 + p.minute;
  const dayShift = nowMin < end ? 0 : 1;
  const wall = Date.UTC(p.year, p.month - 1, p.day + dayShift, Math.floor(end / 60), end % 60, 0);
  // the offset at the target instant, not now: quiet hours can span a DST change
  const guess = wall - tzOffsetMs(at, s.timezone);
  return new Date(wall - tzOffsetMs(new Date(guess), s.timezone));
}

export function isPushable(c: PushCandidate): boolean {
  return c.kind === "weekly" || (c.kind === "alert" && c.material);
}

export function decidePush(c: PushCandidate, s: PushSettings, sentLast7Days: number, now: Date): PushDecision {
  if (!s.pushEnabled) return { action: "skip", reason: "push_disabled" };
  if (!isPushable(c)) return { action: "skip", reason: "not_pushable" };
  const max = Math.max(0, Math.min(HARD_WEEKLY_MAX, Number.isFinite(s.maxPerWeek) ? s.maxPerWeek : HARD_WEEKLY_MAX));
  if (sentLast7Days >= max) return { action: "skip", reason: "weekly_limit" };
  if (inQuietHours(now, s)) return { action: "defer", until: quietEndsAt(now, s), reason: "quiet_hours" };
  return { action: "send" };
}

/** Push copy: never an amount, never a digit. */
export function pushText(kind: InsightKind, alertKind?: string): { title: string; body: string } {
  if (kind === "weekly") return { title: "M8", body: "Your weekly review is ready." };
  if (kind === "monthly") return { title: "M8", body: "Your monthly close is ready." };
  switch (alertKind) {
    case "category_spike":
      return { title: "M8", body: "One of your categories is running well above usual." };
    case "recurring_missed":
      return { title: "M8", body: "A recurring payment hasn’t shown up yet." };
    case "reconciliation_gap":
      return { title: "M8", body: "An account doesn’t match the balance you reported." };
    case "likely_duplicate":
      return { title: "M8", body: "Two entries look like the same purchase." };
    default:
      return { title: "M8", body: "Something in your money needs a look." };
  }
}
