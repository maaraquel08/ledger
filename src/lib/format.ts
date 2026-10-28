const nf = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 });

/** ₱18,900 — always unsigned. */
export const peso = (n: number) => `₱${nf.format(Math.abs(Math.round(n)))}`;

/** ₱18,900 or −₱1,200 — a balance keeps its sign when it goes under. */
export const balance = (n: number) => `${n < 0 ? "−" : ""}${peso(n)}`;

/** +₱12,000 / −₱248 — the typographic minus, as in the design. */
export const signed = (n: number) => `${n < 0 ? "−" : "+"}${peso(n)}`;

/** ₱1.28M, ₱386k */
export const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `₱${(a / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (a >= 10_000) return `₱${Math.round(a / 1000)}k`;
  return peso(a);
};

/** 1.2k for chart labels */
export const kilo = (n: number) => `${(Math.abs(n) / 1000).toFixed(1)}k`;

export const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const monthName = (d: Date) => MONTHS[d.getMonth()];
export const monthShort = (d: Date) => MONTHS[d.getMonth()].slice(0, 3);
export const dayName = (d: Date) => DAYS[d.getDay()];

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
}

/** "TODAY · 10 AUGUST", "MONDAY · 9 AUGUST" */
export function dayHeading(d: Date, today = new Date()) {
  const label = sameDay(d, today) ? "Today" : sameDay(d, addDays(today, -1)) ? "Yesterday" : dayName(d);
  return `${label} · ${d.getDate()} ${monthName(d)}`.toUpperCase();
}

/** "Today, 10 Aug · 8:14 AM" */
export function stamp(iso: string, today = new Date()) {
  const d = new Date(iso);
  const t = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  const prefix = sameDay(d, today) ? "Today, " : sameDay(d, addDays(today, -1)) ? "Yesterday, " : "";
  return `${prefix}${d.getDate()} ${monthShort(d)} · ${t}`;
}

/** "TODAY", "9 AUG" — mono meta */
export function shortDay(iso: string, today = new Date()) {
  const d = new Date(iso);
  if (sameDay(d, today)) return "TODAY";
  return `${d.getDate()} ${monthShort(d).toUpperCase()}`;
}

/** Goal.by is "YYYY-MM"; returns the first of that month, or null when unset / unparseable. */
export function goalMonth(by: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(by ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Jan 2027", or "No date". */
export function goalLabel(by: string) {
  const d = goalMonth(by);
  return d ? `${monthShort(d)} ${d.getFullYear()}` : "No date";
}

/** Legacy "Jan 2027" → "2027-01"; already-ISO or unknown strings pass through ("" when unparseable). */
export function normalizeGoalBy(by: string | undefined): string {
  if (!by) return "";
  if (goalMonth(by)) return by;
  const d = new Date(`1 ${by}`);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Local calendar day as YYYY-MM-DD (never the UTC date). */
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
