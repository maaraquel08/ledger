// Facts: every number M8 may say. Pure module (no Deno globals, no npm imports) so vitest can
// import it.
//
// Flow (D-0013): tool / RPC results are walked; every number becomes a fact with an id (f1, f2…)
// and the entry ids that produced it. Claude sees the id and the formatted value and writes prose
// with {{fN}} placeholders. The server renders the numbers. The validator rejects any digit in the
// prose that did not come from a fact, except inside literals that appeared in the data (dates,
// merchant names like "7-Eleven") and the persona name "M8".

import { localDate } from "./time.ts";

export type FactKind = "peso" | "count" | "pct" | "ratio" | "months" | "number" | "date";

export interface Fact {
  id: string;
  value: number | null;
  /** for kind "date": the ISO date (YYYY-MM-DD) */
  date?: string;
  kind: FactKind;
  label: string;
  entry_ids: string[];
}

const nf = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** ₱18,900: whole pesos, unsigned, en-PH (same as src/lib/format.ts peso). */
export const peso = (n: number) => `₱${nf.format(Math.abs(Math.round(n)))}`;

export function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${Number(m[3])}`;
}

export function formatFact(f: Pick<Fact, "value" | "kind" | "date">): string {
  if (f.kind === "date") return f.date ? formatDate(f.date) : "no date";
  const v = f.value;
  if (v == null || !Number.isFinite(v)) return "no data";
  switch (f.kind) {
    case "peso":
      return peso(v);
    case "count":
      return nf.format(Math.round(v));
    case "pct":
      return `${nf.format(Math.round(v))}%`;
    case "ratio":
      return `${v.toFixed(1)}×`;
    case "months":
      return v.toFixed(1);
    default:
      return nf1.format(v);
  }
}

/** Every way a date that appeared in the data may be written in prose. */
export function dateLiterals(iso: string): string[] {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return [];
  const [y, mo, d] = [m[1], Number(m[2]), Number(m[3])];
  const full = MONTHS[mo - 1];
  const short = full.slice(0, 3);
  return [
    `${y}-${m[2]}-${m[3]}`,
    `${full} ${d}, ${y}`, `${short} ${d}, ${y}`, `${d} ${full} ${y}`, `${d} ${short} ${y}`,
    `${full} ${d}`, `${short} ${d}`, `${d} ${full}`, `${d} ${short}`,
    `${full} ${y}`, `${short} ${y}`,
  ];
}

export class FactRegistry {
  private facts = new Map<string, Fact>();
  private next = 1;
  readonly literals = new Set<string>(["M8"]);

  /** tz: the Owner's timezone, so a timestamp's local date may be quoted ("Oct 9" for 17:00Z on Oct 8 in Manila) */
  constructor(readonly tz?: string) {}

  add(value: number | null, kind: FactKind, label: string, entry_ids: string[] = []): string {
    const id = `f${this.next++}`;
    this.facts.set(id, { id, value: value == null ? null : Number(value), kind, label, entry_ids: [...new Set(entry_ids)] });
    return id;
  }

  addDate(iso: string, label: string, entry_ids: string[] = []): string {
    const id = `f${this.next++}`;
    this.facts.set(id, { id, value: null, date: iso.slice(0, 10), kind: "date", label, entry_ids });
    return id;
  }

  get(id: string): Fact | undefined {
    return this.facts.get(id);
  }

  all(): Fact[] {
    return [...this.facts.values()];
  }

  display(id: string): string | undefined {
    const f = this.facts.get(id);
    return f ? formatFact(f) : undefined;
  }

  /** A string from the data (merchant, description, date) that may be quoted with its digits. */
  allow(literal: string) {
    const s = literal.trim();
    if (!s || !/\d/.test(s)) return;
    // a bare number is not a literal: it would let any digits through
    if (/^[\d\s.,₱%+\-−×:/]+$/.test(s)) return;
    this.literals.add(s);
  }

  allowDate(iso: string) {
    for (const l of dateLiterals(iso)) this.literals.add(l);
    if (this.tz && /T\d/.test(iso)) {
      const t = new Date(iso);
      if (Number.isFinite(t.getTime())) for (const l of dateLiterals(localDate(t, this.tz))) this.literals.add(l);
    }
  }

  entryIds(ids: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const id of ids) for (const e of this.facts.get(id)?.entry_ids ?? []) out.add(e);
    return [...out];
  }
}

const PLACEHOLDER = /\{\{\s*(f\d+)\s*\}\}/g;

export interface Rendered {
  text: string;
  used: string[];
  /** problems: unknown fact ids and digits that did not come from a fact */
  violations: string[];
}

/** Render {{fN}} placeholders and validate the template in one pass. */
export function renderProse(template: string, reg: FactRegistry): Rendered {
  const used: string[] = [];
  const violations: string[] = [];
  const text = template.replace(PLACEHOLDER, (_m, id: string) => {
    const d = reg.display(id);
    if (d === undefined) {
      violations.push(`unknown fact ${id}`);
      return "";
    }
    used.push(id);
    return d;
  });
  for (const v of strayDigits(template, reg)) violations.push(`number not from a fact: "${v}"`);
  return { text, used, violations };
}

/**
 * Digits in a template that are not inside a placeholder or an allowed literal.
 * Checked on the template (not the rendered text) so a model that writes "₱5,000"
 * literally is caught even when 5,000 happens to equal a fact.
 */
export function strayDigits(template: string, reg: FactRegistry): string[] {
  let rest = template.replace(PLACEHOLDER, " ");
  const literals = [...reg.literals].sort((a, b) => b.length - a.length);
  for (const l of literals) rest = replaceAllCaseless(rest, l, " ");
  return [...rest.matchAll(/[₱$]?\s?\d[\d,.:/%-]*/g)].map((m) => m[0].trim());
}

function replaceAllCaseless(hay: string, needle: string, by: string): string {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // literal must stand alone: "7-Eleven" may not hide the 7 in "17-Eleven"
  return hay.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"), by);
}

/** Strip any leftover placeholders and collapse whitespace (for display of partial failures). */
export const tidy = (s: string) => s.replace(PLACEHOLDER, "").replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();

/* ---------- walking RPC results ------------------------------------------- */

/** exactly {value, entry_ids}: a row that merely has those keys (by_category) is not a fact */
const isFactObj = (v: unknown): v is { value: number | null; entry_ids: string[] } =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 2 && "value" in v && "entry_ids" in v &&
  (typeof (v as { value: unknown }).value === "number" || (v as { value: unknown }).value === null);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which kind of number a key holds. Unknown keys are pesos (most RPC numbers are money). */
export function kindForKey(key: string): FactKind {
  const k = key.toLowerCase();
  if (/(pct|percent|rate|share)/.test(k)) return "pct";
  if (/ratio/.test(k)) return "ratio";
  if (/(^|_)(count|n|sample|days_left|days_late|months_left|hits|day_of_month|weekday)$/.test(k)) return "count";
  if (/(^|_)(score|qty)$/.test(k)) return "number";
  if (/months$/.test(k)) return "months";
  return "peso";
}

const humanize = (path: string[]) =>
  path
    .filter((p) => !/^\d+$/.test(p))
    .map((p) => p.replace(/_/g, " "))
    .join(" › ");

export interface WalkOptions {
  /** prefix for fact labels, e.g. "this month" */
  label?: string;
  /** keys dropped from the model view (still kept server-side) */
  drop?: string[];
}

/**
 * Turn an RPC result into the view Claude sees: every number (and every {value, entry_ids}
 * fact) becomes {"fact": "fN", "shows": "₱24,865"}; entry_ids arrays become a count; uuids are
 * kept (they are ids, not numbers); strings with digits (dates, merchants) become allowed literals.
 */
export function factify(data: unknown, reg: FactRegistry, opts: WalkOptions = {}, path: string[] = []): unknown {
  const label = [opts.label, humanize(path)].filter(Boolean).join(": ");
  if (isFactObj(data)) {
    const key = path.at(-1) ?? "";
    const id = reg.add(data.value, kindForKey(key), label, data.entry_ids ?? []);
    return { fact: id, shows: reg.display(id), entries: (data.entry_ids ?? []).length };
  }
  if (typeof data === "number") {
    const key = path.at(-1) ?? "";
    // a number inside an array of entries keeps that entry as its source
    const id = reg.add(data, kindForKey(key), label, []);
    return { fact: id, shows: reg.display(id) };
  }
  if (typeof data === "string") {
    if (UUID.test(data)) return data;
    if (ISO_DATE.test(data)) reg.allowDate(data);
    else reg.allow(data);
    return data;
  }
  if (Array.isArray(data)) return data.map((v, i) => factify(v, reg, opts, [...path, String(i)]));
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // an entry row: its numbers are sourced by its own id
    const rowId = typeof o.id === "string" && UUID.test(o.id) ? o.id : null;
    for (const [k, v] of Object.entries(o)) {
      if (opts.drop?.includes(k)) continue;
      if (k === "entry_ids" && Array.isArray(v)) {
        out.entries = v.length;
        continue;
      }
      if (rowId && typeof v === "number") {
        const id = reg.add(v, kindForKey(k), [opts.label, humanize([...path, k])].filter(Boolean).join(": "), [rowId]);
        out[k] = { fact: id, shows: reg.display(id) };
        if (k === "amount") out.direction = v < 0 ? "out" : "in";
        continue;
      }
      out[k] = factify(v, reg, opts, [...path, k]);
    }
    // entry_ids that sit next to plain numbers (by_category rows, anomalies) source those numbers
    if (Array.isArray(o.entry_ids)) {
      for (const v of Object.values(out)) {
        if (v && typeof v === "object" && "fact" in (v as object)) {
          const f = reg.get((v as { fact: string }).fact);
          if (f && f.entry_ids.length === 0) f.entry_ids = [...new Set(o.entry_ids as string[])];
        }
      }
    }
    return out;
  }
  return data;
}

/** Numbers the Owner typed in their question ("a ₱65,000 laptop") become facts too. */
export function userNumbers(text: string, reg: FactRegistry): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(/₱?\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/gi)) {
    const v = parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    if (!Number.isFinite(v)) continue;
    ids.push(reg.add(v, "peso", "amount in your question"));
  }
  return ids;
}
