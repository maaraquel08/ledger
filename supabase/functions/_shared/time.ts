// Timezone helpers on Intl only. Pure module.

/** Wall-clock parts of an instant in a timezone. */
export function localParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

/** Offset (ms) of a timezone at an instant: local wall time − UTC. */
export function tzOffsetMs(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, "0");

/** "2026-10-29T21:04:05+08:00 (Thursday)": the Owner's local now, for prompts. */
export function localIso(at: Date, timeZone: string): string {
  const p = localParts(at, timeZone);
  const off = Math.round(tzOffsetMs(at, timeZone) / 60_000);
  const sign = off < 0 ? "-" : "+";
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(off / 60)}:${pad(off % 60)} (${day})`;
}

/** The Owner's local date, YYYY-MM-DD. */
export function localDate(at: Date, timeZone: string): string {
  const p = localParts(at, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
