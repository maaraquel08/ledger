// Turning Claude's structured chat output (prose with {{fN}} placeholders, fact ids for charts)
// into the client's `Answer` (src/screens/chat.tsx). Pure module.
import { type FactRegistry, renderProse, tidy } from "./facts.ts";

/** The client type, copied exactly from src/screens/chat.tsx. */
export interface Answer {
  read: number;
  matched: { n: number; label: string };
  compareYear: number;
  text: string;
  marks?: string[];
  bars?: { title: string; kind: "months" | "share"; items: { label: string; value: number; display: string }[] };
  compare?: { title: string; now: number; after: number; unit: string };
  ask?: string;
  offer?: { label: string; name: string; target: number; by: string };
  sources: string[];
  followups: string[];
}

/** What Claude returns (schemas.ts CHAT_ANSWER_SCHEMA). */
export interface ModelAnswer {
  text: string;
  marks: string[];
  matched_label: string;
  matched_fact: string | null;
  bars: { title: string; kind: "months" | "share"; items: { label: string; fact: string }[] } | null;
  compare: { title: string; now_fact: string; after_fact: string; unit: string } | null;
  ask: string | null;
  offer: { label: string; name: string; target_fact: string; by: string } | null;
  source_facts: string[];
  followups: string[];
}

export interface BuildResult {
  answer: Answer;
  violations: string[];
}

const MAX_SOURCES = 500;

/** Build the Answer; `violations` non-empty means the model must be re-asked (or fall back). */
export function buildAnswer(m: ModelAnswer, reg: FactRegistry, now: { year: number }): BuildResult {
  const violations: string[] = [];
  const cited = new Set<string>();
  const prose = (tpl: string, where: string) => {
    const r = renderProse(tpl, reg);
    for (const v of r.violations) violations.push(`${where}: ${v}`);
    r.used.forEach((id) => cited.add(id));
    return tidy(r.text);
  };
  const factValue = (id: string, where: string): number | null => {
    const f = reg.get(id);
    if (!f || f.value == null) {
      violations.push(`${where}: unknown or empty fact ${id}`);
      return null;
    }
    cited.add(id);
    return f.value;
  };

  const text = prose(m.text, "text");
  const marks = m.marks.map((x) => prose(x, "marks")).filter((x) => x && text.includes(x));

  let bars: Answer["bars"];
  if (m.bars && m.bars.items.length) {
    const items = m.bars.items.flatMap((it) => {
      const value = factValue(it.fact, "bars");
      return value == null ? [] : [{ label: prose(it.label, "bars"), value: Math.abs(value), display: reg.display(it.fact)! }];
    });
    if (items.length) bars = { title: prose(m.bars.title, "bars").toUpperCase(), kind: m.bars.kind, items };
  }

  let compare: Answer["compare"];
  if (m.compare) {
    const a = factValue(m.compare.now_fact, "compare");
    const b = factValue(m.compare.after_fact, "compare");
    if (a != null && b != null) compare = { title: prose(m.compare.title, "compare").toUpperCase(), now: a, after: b, unit: prose(m.compare.unit, "compare") };
  }

  let offer: Answer["offer"];
  if (m.offer) {
    const target = factValue(m.offer.target_fact, "offer");
    const by = /^\d{4}-\d{2}$/.test(m.offer.by) ? m.offer.by : "";
    if (target != null && target > 0) offer = { label: prose(m.offer.label, "offer"), name: prose(m.offer.name, "offer"), target: Math.round(Math.abs(target)), by };
  }

  const ask = m.ask ? prose(m.ask, "ask") : undefined;
  const followups = m.followups.slice(0, 3).map((f) => prose(f, "followups")).filter(Boolean);
  const matchedLabel = prose(m.matched_label, "matched");
  for (const id of m.source_facts) if (reg.get(id)) cited.add(id);
  const matchedValue = m.matched_fact ? factValue(m.matched_fact, "matched") : null;

  const sources = reg.entryIds(cited).slice(0, MAX_SOURCES);
  const answer: Answer = {
    read: readCount(reg),
    matched: { n: matchedValue != null ? Math.round(Math.abs(matchedValue)) : sources.length, label: matchedLabel },
    compareYear: now.year - 1,
    text,
    sources,
    followups,
  };
  if (marks.length) answer.marks = marks;
  if (bars) answer.bars = bars;
  if (compare) answer.compare = compare;
  if (ask) answer.ask = ask;
  if (offer) answer.offer = offer;
  return { answer, violations };
}

/** Entries read = every distinct entry behind any number the tools returned. */
export const readCount = (reg: FactRegistry) => new Set(reg.all().flatMap((f) => f.entry_ids)).size;

/**
 * Deterministic answer when Claude can't produce valid prose twice: the first few facts,
 * labelled by the server. Never contains a number that isn't a fact.
 */
export function fallbackAnswer(reg: FactRegistry, now: { year: number }): Answer {
  const facts = reg.all().filter((f) => f.kind !== "date" && f.value != null && f.label && f.label !== "amount in your question");
  const pick = facts.filter((f) => f.entry_ids.length).slice(0, 3);
  const use = pick.length ? pick : facts.slice(0, 3);
  const text = use.length
    ? `Here’s what the numbers say. ${use.map((f) => `${capital(f.label)}: ${reg.display(f.id)}`).join("; ")}.`
    : "I couldn’t put a reliable answer together for that. Try asking it another way.";
  const sources = reg.entryIds(use.map((f) => f.id)).slice(0, MAX_SOURCES);
  return {
    read: readCount(reg),
    matched: { n: sources.length, label: sources.length === 1 ? "entry" : "entries" },
    compareYear: now.year - 1,
    text,
    sources,
    followups: [],
  };
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
