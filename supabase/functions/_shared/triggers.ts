// Deterministic triggers for proactive insights (D-0016): decide whether anything is worth
// saying BEFORE Claude is called. Pure module.

export type RunKind = "daily" | "weekly" | "monthly" | "alerts";
export type InsightKind = "daily" | "weekly" | "monthly" | "alert";

type Fact = { value: number | null; entry_ids: string[] };

export interface Anomaly {
  kind: string;
  severity: "warn" | "info" | string;
  fingerprint: string;
  facts: Record<string, unknown>;
  entry_ids: string[];
}

export interface ExistingInsight {
  kind: string;
  fingerprint: string;
  dismissed_at: string | null;
  created_at: string;
}

export const insightKind = (k: RunKind): InsightKind => (k === "alerts" ? "alert" : k);

/* ---------- cooldown / suppression ---------------------------------------- */

/** The subject of a fingerprint without its period: "category_spike:Health:2026-10" → "category_spike:Health". */
export function subjectOf(fingerprint: string): string {
  const parts = fingerprint.split(":");
  return parts.length > 2 ? parts.slice(0, 2).join(":") : fingerprint;
}

export const ALERT_COOLDOWN_DAYS = 7;
export const SUPPRESS_AFTER_DISMISSALS = 2;
export const SUPPRESS_WINDOW_DAYS = 90;

export type WriteDecision = { write: true } | { write: false; reason: "exists" | "dismissed" | "cooldown" | "suppressed" };

/**
 * One insight per fingerprint (fingerprints carry their period, so re-runs are no-ops and a
 * dismissed one never comes back). Alerts also cool down per subject for a week, and a subject
 * the Owner dismissed twice in 90 days is suppressed.
 */
export function shouldWrite(kind: InsightKind, fingerprint: string, existing: ExistingInsight[], now: Date): WriteDecision {
  const same = existing.find((e) => e.kind === kind && e.fingerprint === fingerprint);
  if (same) return { write: false, reason: same.dismissed_at ? "dismissed" : "exists" };
  if (kind !== "alert") return { write: true };
  const subject = subjectOf(fingerprint);
  const ofSubject = existing.filter((e) => e.kind === "alert" && subjectOf(e.fingerprint) === subject);
  const day = 86_400_000;
  const dismissed = ofSubject.filter((e) => e.dismissed_at && now.getTime() - Date.parse(e.dismissed_at) < SUPPRESS_WINDOW_DAYS * day);
  if (dismissed.length >= SUPPRESS_AFTER_DISMISSALS) return { write: false, reason: "suppressed" };
  if (ofSubject.some((e) => now.getTime() - Date.parse(e.created_at) < ALERT_COOLDOWN_DAYS * day)) return { write: false, reason: "cooldown" };
  return { write: true };
}

/* ---------- triggers ------------------------------------------------------ */

export interface DailyInput {
  today: { has_budget: boolean; spent_today?: Fact; left?: Fact };
  entriesToday: number;
}
export function dailyWorthIt(d: DailyInput): boolean {
  return d.today.has_budget === true || d.entriesToday > 0;
}

export interface PeriodCompare {
  current: { spend: Fact; income: Fact; entry_count: Fact };
  previous: { spend: Fact; income: Fact; entry_count: Fact };
  delta: { spend: { value: number; pct: number | null } };
  by_category: { category_code: string; current: Fact; previous: Fact; delta: number }[];
}
export interface Goal {
  name: string;
  needed_per_month: number | null;
  remaining: number | null;
}

/** Digit-free notes telling Claude what is worth saying. Empty = "nothing to flag". */
export function reviewNotables(c: PeriodCompare, anomalies: Anomaly[]): string[] {
  const notes: string[] = [];
  const spendPct = c.delta.spend.pct;
  if (spendPct != null && Math.abs(spendPct) >= 15 && Math.abs(c.delta.spend.value) >= 1000) {
    notes.push(spendPct > 0 ? "spending is up versus the previous period" : "spending is down versus the previous period");
  }
  const mover = c.by_category.find((r) => Math.abs(r.delta) >= 1000);
  if (mover) notes.push(`${mover.category_code} moved the most versus the previous period`);
  if ((c.current.income.value ?? 0) > 0 && (c.current.spend.value ?? 0) > (c.current.income.value ?? 0)) notes.push("spending was above income");
  for (const a of anomalies.filter((x) => x.severity === "warn")) notes.push(`open alert: ${a.kind.replace(/_/g, " ")}`);
  return notes;
}

export function isMaterial(a: Anomaly): boolean {
  return a.severity === "warn";
}

/** "nothing logged" periods get a fixed line and no Claude call. */
export const isQuiet = (c: PeriodCompare) => (c.current.entry_count.value ?? 0) === 0;

/** First sentence of a narrative, for the "don't repeat" list. */
export function headline(narrative: string): string {
  const m = narrative.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : narrative).trim().slice(0, 160);
}
