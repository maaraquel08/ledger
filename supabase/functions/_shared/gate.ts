// The capture confidence gate (D-0013, spec 2026-10-29). Pure module.
// An entry saves instantly only when every check passes; otherwise it lands in Review with ONE
// targeted question about the first failing check. Checks, in order:
//   amount_literal   amount literally in the input or receipt text; photos: also = regex receipt TOTAL
//   account_alias    account resolved by exact alias (both accounts for a transfer/invest)
//   category_agreed  category from a learned rule, or Claude agrees with the regex parser
//   date_valid       date parses and is not in the future (and the capture clock is trusted)
//   not_duplicate    no likely duplicate (same amount + merchant within 48 h)
//   amount_typical   amount <= 3x the category median
//   unambiguous      Claude listed no ambiguous fields

export const CHECKS = [
  "amount_literal",
  "account_alias",
  "category_agreed",
  "date_valid",
  "not_duplicate",
  "amount_typical",
  "unambiguous",
] as const;
export type CheckName = (typeof CHECKS)[number];

export interface GateInput {
  /** what was captured: typed text, transcript, or the receipt text Claude read */
  sourceText: string;
  /** the substring Claude says holds the amount */
  amountSpan: string;
  /** absolute amount */
  amount: number;
  kind: "income" | "expense" | "transfer" | "invest" | "refund";
  accountResolved: boolean;
  /** transfers and invest moves need the destination too */
  toAccountResolved?: boolean;
  category: string | null;
  categoryFromRule: boolean;
  /** category the app's regex parser picks for the same text (null = it has no opinion) */
  regexCategory: string | null;
  /** ISO string or null when Claude gave none (then "now" is used and the check passes) */
  occurredAt: string | null;
  now: Date;
  /** the capture clock could not be trusted (captured_at out of range): date_valid fails */
  clockSuspect?: boolean;
  /**
   * Photos only: the receipt total the app's regex parser reads (null = none found). When present
   * (even null) amount_literal also requires the amount to equal it, so a photo's amount never
   * passes on Claude's own transcription alone.
   */
  receiptTotal?: number | null;
  duplicateOf: string | null;
  /** median |amount| for the category; null when there is too little history */
  categoryMedian: number | null;
  ambiguousFields: string[];
  merchant?: string | null;
}

export interface CheckResult {
  name: CheckName;
  passed: boolean;
  detail?: string;
}

export interface GateResult {
  passed: boolean;
  failed_check?: CheckName;
  question?: string;
  checks: CheckResult[];
}

/** Future tolerance: phone and server clocks disagree a little. */
const FUTURE_SLACK_MS = 5 * 60_000;

/** Every number written in the text, as values (₱2,340 / 2.5k / 248.50). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/gi)) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n * (m[2] ? 1000 : 1));
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

export function amountIsLiteral(sourceText: string, span: string, amount: number): boolean {
  const s = span.trim();
  if (!s || !norm(sourceText).includes(norm(s))) return false;
  return numbersIn(s).some((n) => same(n, Math.abs(amount)));
}

export function checkAll(i: GateInput): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (name: CheckName, passed: boolean, detail?: string) => results.push({ name, passed, ...(detail ? { detail } : {}) });

  const totalAgrees = i.receiptTotal === undefined || (i.receiptTotal != null && same(i.receiptTotal, Math.abs(i.amount)));
  add("amount_literal", amountIsLiteral(i.sourceText, i.amountSpan, i.amount) && totalAgrees, totalAgrees ? undefined : "receipt_total");

  const needsTo = i.kind === "transfer" || i.kind === "invest";
  add("account_alias", i.accountResolved && (!needsTo || i.toAccountResolved === true), !i.accountResolved ? "from" : needsTo && !i.toAccountResolved ? "to" : undefined);

  const agreed = i.category != null && (i.categoryFromRule || (i.regexCategory != null && i.regexCategory === i.category));
  add("category_agreed", agreed);

  let dateOk = !i.clockSuspect;
  if (dateOk && i.occurredAt != null) {
    const t = Date.parse(i.occurredAt);
    dateOk = Number.isFinite(t) && t <= i.now.getTime() + FUTURE_SLACK_MS;
  }
  add("date_valid", dateOk);

  add("not_duplicate", i.duplicateOf == null, i.duplicateOf ?? undefined);

  add("amount_typical", i.categoryMedian == null || i.categoryMedian <= 0 || Math.abs(i.amount) <= 3 * i.categoryMedian);

  add("unambiguous", i.ambiguousFields.length === 0, i.ambiguousFields.join(",") || undefined);
  return results;
}

const FIELD_WORDS: Record<string, string> = {
  amount: "the amount",
  account: "which account you used",
  account_hint: "which account you used",
  to_account: "which account it went to",
  to_account_hint: "which account it went to",
  category: "the category",
  merchant: "where this was",
  description: "what this was for",
  occurred_at: "when this happened",
  date: "when this happened",
  kind: "whether money came in or went out",
  sign: "whether money came in or went out",
};

/** The one targeted question for the first failing check. No amounts: they may be wrong. */
export function questionFor(check: CheckResult, i: GateInput): string {
  switch (check.name) {
    case "amount_literal":
      return "What was the exact amount?";
    case "account_alias":
      return check.detail === "to" ? "Which account did the money go to?" : i.kind === "income" ? "Which account did this come into?" : "Which account did you pay from?";
    case "category_agreed":
      return i.category ? `Should this go under ${i.category}?` : "Which category is this?";
    case "date_valid":
      return "When did this happen?";
    case "not_duplicate":
      return `Is this a second ${i.merchant || "purchase"}, or the same one you already logged?`;
    case "amount_typical":
      return `This is much bigger than your usual ${i.category ?? "entry"}. Is the amount right?`;
    case "unambiguous": {
      const f = (check.detail ?? "").split(",")[0];
      return `Can you confirm ${FIELD_WORDS[f] ?? "the details"}?`;
    }
  }
}

export function runGate(i: GateInput): GateResult {
  const checks = checkAll(i);
  const failed = checks.find((c) => !c.passed);
  if (!failed) return { passed: true, checks };
  return { passed: false, failed_check: failed.name, question: questionFor(failed, i), checks };
}
