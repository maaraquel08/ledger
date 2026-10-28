// Capture: from Claude's parse to post_entries payloads, plus the client Entry mapping.
// Pure module (ids come from an injected generator; see captureIds for the deterministic one).
import type { CheckName, GateInput, GateResult } from "./gate.ts";
import type { AccountRow, AliasRow, RuleRow } from "./kb.ts";
import { parseSpoken, splitEntries } from "./vendor/parse.ts";
import { draftToEntry, parseReceipt, splitOf } from "./vendor/receipt.ts";
import type { Account, Category, Entry, ReceiptItem } from "./vendor/types.ts";

export type EntryKind = "income" | "expense" | "transfer" | "invest" | "refund";

/** One entry as Claude reads it (schemas.ts PARSE_SCHEMA). */
export interface ParsedEntry {
  amount_span: string;
  amount: number;
  sign: "in" | "out";
  kind: EntryKind;
  account_hint: string | null;
  to_account_hint: string | null;
  category: string | null;
  merchant: string | null;
  description: string;
  occurred_at: string | null;
  ambiguous_fields: string[];
}
export interface ParsedReceipt {
  text: string;
  merchant: string | null;
  items: { name: string; amount: number; category: string | null; unsure: boolean }[];
}
export interface ParseOutput {
  entries: ParsedEntry[];
  receipt: ParsedReceipt | null;
}

/** post_entries element (supabase/CONTRACT.md). */
export interface PostEntry {
  id: string;
  account_id: string | null;
  category_code: string | null;
  amount: number;
  occurred_at: string;
  description: string;
  merchant: string | null;
  status: "posted" | "review";
  review_question: string | null;
  raw_input_id: string;
  raw: string | null;
  source: "voice" | "receipt" | null;
  created_by: "claude" | "rule";
  rule_id: string | null;
  receipt_image_path?: string | null;
  move_id?: string;
  move_kind?: "transfer" | "invest";
  splits?: { category_code: string; amount: number; items: string[] }[];
  receipt_items?: { name: string; amount: number; category_code: string | null; unsure: boolean }[];
}

export interface CaptureContext {
  kind: "text" | "voice" | "photo";
  rawInputId: string;
  /** typed text or transcript; for photos the receipt text Claude read */
  sourceText: string;
  storagePath: string | null;
  accounts: AccountRow[];
  aliases: AliasRow[];
  rules: RuleRow[];
  /** the capture's "now": captured_at when trustworthy, else the server clock (captureClock) */
  now: Date;
  /** captured_at was out of range: every entry of this capture fails date_valid */
  clockSuspect?: boolean;
  /** id for a slot of one parsed entry, e.g. "0:leg0", "1:move" (captureIds) */
  newId: (key: string) => string;
}

export interface Plan {
  parsed: ParsedEntry;
  legs: PostEntry[];
  /** gate input minus the two data checks the caller fills from capture_checks */
  gate: Omit<GateInput, "duplicateOf" | "categoryMedian">;
  ruleId: string | null;
  /** which check needs capture_checks (transfers skip duplicate/median) */
  needsDataChecks: boolean;
}

const CATS = new Set<string>([
  "Food & drink", "Groceries", "Transport", "Shopping", "Rent & bills", "Subscriptions", "Gifts",
  "Household", "Health", "Salary", "Income", "Investments", "Transfer", "Other",
]);
const asCategory = (c: string | null | undefined): Category | null => (c && CATS.has(c) ? (c as Category) : null);

/* ---------- accounts ----------------------------------------------------- */

/**
 * Exact alias resolution: the hint must equal (case-insensitive, trimmed) one of the Owner's
 * aliases, an account's own name, or an account's last four digits. Nothing fuzzy.
 */
export function resolveAccount(hint: string | null, accounts: AccountRow[], aliases: AliasRow[]): string | null {
  if (!hint) return null;
  const h = hint.trim().toLowerCase();
  if (!h) return null;
  const live = accounts.filter((a) => !a.archived_at);
  const ids = new Set(live.map((a) => a.id));
  const byAlias = aliases.filter((a) => a.alias.trim().toLowerCase() === h && ids.has(a.account_id));
  if (byAlias.length === 1) return byAlias[0].account_id;
  const byName = live.filter((a) => a.name.trim().toLowerCase() === h);
  if (byName.length === 1) return byName[0].id;
  if (/^\d{4}$/.test(h)) {
    const byLast4 = live.filter((a) => a.last4 === h);
    if (byLast4.length === 1) return byLast4[0].id;
  }
  return null;
}

/** DB rows → the client Account shape the vendored regex parser expects. */
export const toClientAccounts = (rows: AccountRow[]): Account[] =>
  rows
    .filter((a) => !a.archived_at)
    .map((a) => ({
      id: a.id,
      name: a.name,
      provider: a.provider as Account["provider"],
      providerLabel: a.provider_label,
      type: a.type as Account["type"],
      kind: "",
      last4: a.last4 ?? undefined,
      balance: 0,
    }));

/* ---------- learned rules ----------------------------------------------- */

export interface RuleHit {
  rule_id: string;
  category_code?: string;
  account_id?: string;
  merchant?: string;
}

/**
 * First matching active rule. Merchant rules beat text rules; ties break on id so the result
 * never depends on row order.
 */
export function matchRule(p: Pick<ParsedEntry, "merchant" | "description">, text: string, rules: RuleRow[]): RuleHit | null {
  const merchant = (p.merchant ?? "").trim().toLowerCase();
  const hay = `${text} ${p.description} ${p.merchant ?? ""}`.toLowerCase();
  const ordered = rules
    .filter((r) => r.active !== false)
    .sort((a, b) => (a.match.merchant ? 0 : 1) - (b.match.merchant ? 0 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of ordered) {
    const m = r.match ?? {};
    if (!m.merchant && !m.text_contains) continue;
    if (m.merchant && m.merchant.trim().toLowerCase() !== merchant) continue;
    if (m.text_contains && !hay.includes(m.text_contains.trim().toLowerCase())) continue;
    const hit: RuleHit = { rule_id: r.id };
    if (r.set?.category_code && CATS.has(r.set.category_code)) hit.category_code = r.set.category_code;
    if (r.set?.account_id) hit.account_id = r.set.account_id;
    if (r.set?.merchant) hit.merchant = r.set.merchant;
    return hit;
  }
  return null;
}

/* ---------- the regex opinion ------------------------------------------- */

/** The segment of a multi-entry sentence that holds this entry's amount. */
export function segmentFor(text: string, span: string): string {
  const s = span.trim().toLowerCase();
  const parts = splitEntries(text);
  return parts.find((p) => s && p.toLowerCase().includes(s)) ?? text;
}

export function regexCategory(ctx: Pick<CaptureContext, "kind" | "sourceText" | "accounts">, p: ParsedEntry): string | null {
  const accounts = toClientAccounts(ctx.accounts);
  if (ctx.kind === "photo") return draftToEntry(parseReceipt(ctx.sourceText, accounts), "x").category;
  return parseSpoken(segmentFor(ctx.sourceText, p.amount_span), accounts).category;
}

/* ---------- planning ----------------------------------------------------- */

const defaultCategory = (k: EntryKind): string | null => (k === "transfer" ? "Transfer" : k === "invest" ? "Investments" : null);

export function planEntry(p: ParsedEntry, ctx: CaptureContext, receipt: ParsedReceipt | null, index = 0): Plan {
  const amount = Math.round(Math.abs(Number(p.amount)) * 100) / 100;
  const rule = matchRule(p, ctx.sourceText, ctx.rules);
  const accountName = (id: string | null) => ctx.accounts.find((a) => a.id === id)?.name ?? null;

  let accountId = resolveAccount(p.account_hint, ctx.accounts, ctx.aliases);
  if (rule?.account_id && ctx.accounts.some((a) => a.id === rule.account_id && !a.archived_at)) accountId = rule.account_id;
  const toAccountId = resolveAccount(p.to_account_hint, ctx.accounts, ctx.aliases);

  const isMove = p.kind === "transfer" || p.kind === "invest";
  const category = isMove ? defaultCategory(p.kind) : rule?.category_code ?? asCategory(p.category);
  const merchant = rule?.merchant ?? (p.merchant?.trim() || null);
  const occurred = p.occurred_at && Number.isFinite(Date.parse(p.occurred_at)) ? new Date(p.occurred_at).toISOString() : ctx.now.toISOString();
  const source: PostEntry["source"] = ctx.kind === "voice" ? "voice" : ctx.kind === "photo" ? "receipt" : null;
  const raw = ctx.kind === "photo" ? null : ctx.sourceText;
  const base = {
    occurred_at: occurred,
    status: "posted" as const,
    review_question: null,
    raw_input_id: ctx.rawInputId,
    raw,
    source,
    created_by: rule ? ("rule" as const) : ("claude" as const),
    rule_id: rule?.rule_id ?? null,
  };

  let legs: PostEntry[];
  if (isMove) {
    const moveId = ctx.newId(`${index}:move`);
    const moveKind = p.kind === "invest" ? "invest" : "transfer";
    legs = [
      { ...base, id: ctx.newId(`${index}:leg0`), account_id: accountId, category_code: category, amount: -amount,
        description: p.description?.trim() || `To ${accountName(toAccountId) ?? "account"}`, merchant: null, move_id: moveId, move_kind: moveKind },
      { ...base, id: ctx.newId(`${index}:leg1`), account_id: toAccountId, category_code: category, amount,
        description: `From ${accountName(accountId) ?? "account"}`, merchant: null, move_id: moveId, move_kind: moveKind },
    ];
  } else {
    const signed = p.kind === "income" ? amount : p.kind === "expense" ? -amount : p.sign === "in" ? amount : -amount;
    const leg: PostEntry = {
      ...base,
      id: ctx.newId(`${index}:leg0`),
      account_id: accountId,
      category_code: category,
      amount: signed,
      description: p.description?.trim() || merchant || category || "Entry",
      merchant,
    };
    if (receipt && ctx.kind === "photo") {
      const items: ReceiptItem[] = receipt.items
        .filter((i) => i.name && Number(i.amount) > 0)
        .map((i) => ({ name: i.name, amount: Math.abs(Number(i.amount)), category: asCategory(i.category) ?? (asCategory(category) ?? "Other"), unsure: i.unsure || undefined }));
      leg.receipt_items = items.map((i) => ({ name: i.name, amount: i.amount, category_code: i.category, unsure: !!i.unsure }));
      const split = splitOf(items);
      if (split.length > 1) leg.splits = split.map((s) => ({ category_code: s.category, amount: s.amount, items: s.items }));
      if (!rule?.category_code && split.length && !p.category) leg.category_code = split[0].category;
      leg.receipt_image_path = ctx.storagePath;
    }
    legs = [leg];
  }

  const finalCategory = legs[0].category_code;
  return {
    parsed: p,
    legs,
    ruleId: rule?.rule_id ?? null,
    needsDataChecks: !isMove,
    gate: {
      sourceText: ctx.sourceText,
      amountSpan: p.amount_span,
      amount,
      kind: p.kind,
      accountResolved: accountId != null,
      toAccountResolved: isMove ? toAccountId != null : undefined,
      category: finalCategory,
      // a move's category is fixed by its kind, not guessed
      categoryFromRule: !!rule?.category_code || isMove,
      regexCategory: isMove ? finalCategory : regexCategory(ctx, p),
      occurredAt: p.occurred_at,
      now: ctx.now,
      clockSuspect: ctx.clockSuspect ?? false,
      // a photo's amount must agree with the regex parser's TOTAL line, not just with Claude's own reading
      receiptTotal: ctx.kind === "photo" ? parseReceipt(ctx.sourceText, toClientAccounts(ctx.accounts)).total : undefined,
      ambiguousFields: p.ambiguous_fields ?? [],
      merchant,
    },
  };
}

/** Apply a gate result: failing entries (all legs of a move) go to Review with the question. */
export function applyGate(plan: Plan, gate: GateResult): PostEntry[] {
  if (gate.passed) return plan.legs;
  return plan.legs.map((l) => ({ ...l, status: "review", review_question: gate.question ?? null }));
}

/** First failing check across a capture, for the response's `gate`. */
export function summarize(gates: GateResult[]): { passed: boolean; failed_check?: CheckName; question?: string } {
  const failed = gates.find((g) => !g.passed);
  return failed ? { passed: false, failed_check: failed.failed_check, question: failed.question } : { passed: true };
}

/* ---------- EntryJson → client Entry ------------------------------------ */

export interface EntryJson {
  id: string;
  account_id: string | null;
  category_code: string | null;
  amount: number | string;
  occurred_at: string;
  description: string;
  raw?: string | null;
  method?: string | null;
  auto?: boolean;
  refunded_at?: string | null;
  move_id?: string | null;
  status?: "posted" | "review" | "void" | null;
  review_question?: string | null;
  source?: "voice" | "receipt" | null;
  splits?: { category_code: string; amount: number | string; items: string[] | null }[];
  receipt_items?: { name: string; amount: number | string; category_code: string | null; unsure: boolean }[];
}

/** The client's Entry plus the capture-only review fields. */
export type ClientEntry = Entry & { status?: "posted" | "review"; reviewQuestion?: string };

/** The client's Entry (src/lib/types.ts). `receipt.image` stays local-only (a Storage path is not an image URL). */
export function toClientEntry(j: EntryJson): ClientEntry {
  const e: ClientEntry = {
    id: j.id,
    desc: j.description,
    accountId: j.account_id,
    category: asCategory(j.category_code),
    amount: Number(j.amount),
    date: j.occurred_at,
  };
  if (j.status === "posted" || j.status === "review") e.status = j.status;
  if (j.review_question) e.reviewQuestion = j.review_question;
  if (j.raw) e.raw = j.raw;
  if (j.method) e.method = j.method;
  if (j.auto) e.auto = true;
  if (j.refunded_at) e.refunded = true;
  if (j.move_id) e.linkId = j.move_id;
  if (j.source) e.source = j.source;
  if (j.splits?.length) e.split = j.splits.map((s) => ({ category: asCategory(s.category_code) ?? "Other", amount: Number(s.amount), items: s.items ?? [] }));
  if (j.receipt_items?.length)
    e.receipt = {
      items: j.receipt_items.map((i) => ({
        name: i.name,
        amount: Number(i.amount),
        category: asCategory(i.category_code) ?? "Other",
        ...(i.unsure ? { unsure: true } : {}),
      })),
    };
  return e;
}

/* ---------- refunds ------------------------------------------------------ */

/**
 * A captured refund never marks anything refunded by itself (D-0009 refunds are an Owner action on
 * the original expense): it always lands in Review with this question.
 */
export const REFUND_REVIEW: GateResult = {
  passed: false,
  failed_check: "category_agreed",
  question: "Which purchase was this refund for?",
  checks: [{ name: "category_agreed", passed: false, detail: "refund" }],
};

/* ---------- the capture clock -------------------------------------------- */

const CLOCK_SLACK_MS = 5 * 60_000;
const MAX_CAPTURE_AGE_MS = 30 * 86_400_000;

/**
 * The capture's "now" from the client's optional `captured_at` (ISO). Missing → server clock.
 * Unparseable → null (400). In the future (beyond 5 min of clock skew) or older than 30 days →
 * server clock and `suspect` (every entry goes to Review on date_valid).
 */
export function captureClock(capturedAt: unknown, serverNow: Date): { now: Date; suspect: boolean } | null {
  if (capturedAt === undefined || capturedAt === null) return { now: serverNow, suspect: false };
  if (typeof capturedAt !== "string") return null;
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return null;
  const s = serverNow.getTime();
  if (t > s + CLOCK_SLACK_MS || t < s - MAX_CAPTURE_AGE_MS) return { now: serverNow, suspect: true };
  return { now: new Date(Math.min(t, s)), suspect: false };
}

/* ---------- deterministic ids -------------------------------------------- */

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** RFC 4122 version-5 uuid (SHA-1 of namespace uuid + name). */
export async function uuidV5(namespace: string, name: string): Promise<string> {
  const ns = namespace.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(ns)) throw new Error("namespace must be a uuid");
  const nsBytes = Uint8Array.from(ns.match(/../g)!.map((h) => parseInt(h, 16)));
  const nameBytes = new TextEncoder().encode(name);
  const buf = new Uint8Array(nsBytes.length + nameBytes.length);
  buf.set(nsBytes);
  buf.set(nameBytes, nsBytes.length);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", buf)).slice(0, 16);
  d[6] = (d[6] & 0x0f) | 0x50;
  d[8] = (d[8] & 0x3f) | 0x80;
  const h = hex(d);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Every id one capture can need, derived from its client_id: entry i uses "i:leg0", "i:leg1" and
 * "i:move". A retry of the same client_id posts the same ids, so post_entries returns the rows it
 * already wrote instead of writing them twice.
 */
export async function captureIds(clientId: string, entryCount: number): Promise<(key: string) => string> {
  const ids = new Map<string, string>();
  for (let i = 0; i < entryCount; i++) {
    for (const slot of ["leg0", "leg1", "move"]) ids.set(`${i}:${slot}`, await uuidV5(clientId, `ledger-capture:${i}:${slot}`));
  }
  return (key) => {
    const id = ids.get(key);
    if (!id) throw new Error(`no capture id for ${key}`);
    return id;
  };
}
