import type { Account, AccountType, Category, Entry, Frequency, Goal, Holding, Profile, Provider, ReceiptItem, SideIncome, Split } from "../types";

/*
 * Rows <-> app types, exactly as supabase/CONTRACT.md "TypeScript <-> rows" lists them.
 * Numeric columns can arrive as numbers or strings; everything goes through num().
 */

type Row = Record<string, unknown>;

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
const str = (v: unknown) => (v == null ? undefined : String(v));

export interface AccountRow extends Row {
  id: string;
  name: string;
  provider: string;
  provider_label: string;
  type: string;
  kind: string;
  last4: string | null;
  rate: string | null;
  due_date: string | null;
  opening_balance: number | string;
  archived_at: string | null;
}

/** an accounts row + its derived balance from the account_balances view */
export function toAccount(r: AccountRow, balance: number | undefined): Account {
  return {
    id: r.id,
    name: r.name,
    provider: (r.provider || "other") as Provider,
    providerLabel: r.provider_label || r.name,
    type: r.type as AccountType,
    kind: r.kind || "",
    last4: r.last4 ?? undefined,
    rate: r.rate ?? undefined,
    dueDate: r.due_date ?? undefined,
    balance: balance ?? num(r.opening_balance),
  };
}

/** upsert_account payload. `opening` only on create: the opening balance is fixed after that. */
export function accountPayload(a: Account, opening?: number): Row {
  const p: Row = {
    id: a.id,
    name: a.name,
    provider: a.provider,
    provider_label: a.providerLabel,
    type: a.type,
    kind: a.kind,
    last4: a.last4 ?? null,
    rate: a.rate ?? null,
    due_date: a.dueDate ? a.dueDate.slice(0, 10) : null,
  };
  if (opening != null) {
    p.opening_balance = opening;
    p.opening_date = new Date().toISOString();
  }
  return p;
}

/**
 * EntryJson (RPC results: `splits`, `receipt_items` arrays) or a PostgREST entries row with
 * embedded `entry_splits` / `receipt_items`. Void entries are returned as null.
 */
export function toEntry(r: Row): Entry | null {
  if (r.status === "void") return null;
  const splitRows = ((r.splits ?? r.entry_splits ?? []) as Row[]).slice().sort((a, b) => num(a.position) - num(b.position));
  const itemRows = ((r.receipt_items ?? []) as Row[]).slice().sort((a, b) => num(a.position) - num(b.position));
  const split: Split[] = splitRows.map((s) => ({
    category: s.category_code as Category,
    amount: num(s.amount),
    items: (s.items as string[] | null) ?? [],
  }));
  const items: ReceiptItem[] = itemRows.map((i) => ({
    name: String(i.name ?? ""),
    amount: num(i.amount),
    category: (i.category_code ?? "Other") as Category,
    unsure: (i.unsure as boolean | null) ?? undefined,
  }));
  const path = str(r.receipt_image_path);
  const e: Entry = {
    id: String(r.id),
    desc: String(r.description ?? ""),
    accountId: (r.account_id as string | null) ?? null,
    category: (r.category_code as Category | null) ?? null,
    amount: num(r.amount),
    date: new Date(String(r.occurred_at)).toISOString(),
    status: r.status === "review" ? "review" : "posted",
  };
  if (r.raw) e.raw = String(r.raw);
  if (r.method) e.method = String(r.method);
  if (r.auto) e.auto = true;
  if (r.refunded_at) e.refunded = true;
  if (r.move_id) e.linkId = String(r.move_id);
  if (r.source === "voice" || r.source === "receipt") e.source = r.source;
  if (r.review_question) e.reviewQuestion = String(r.review_question);
  if (split.length) e.split = split;
  if (items.length || path) e.receipt = { items, path };
  return e;
}

/** Accept either an app Entry or an EntryJson row (the capture function may send either). */
export function anyToEntry(r: Row): Entry | null {
  if ("occurred_at" in r || "description" in r || "category_code" in r) return toEntry(r);
  if (!r.id || typeof r.amount !== "number") return null;
  // the app shape: keep the capture gate's verdict, so a review entry lands in Review with its question
  const { reviewQuestion, review_question, ...rest } = r;
  const q = reviewQuestion ?? review_question;
  return { ...(rest as unknown as Entry), status: r.status === "review" ? "review" : "posted", ...(q ? { reviewQuestion: String(q) } : {}) };
}

const splitsOf = (e: Partial<Entry>) => (e.split ?? []).map((s) => ({ category_code: s.category, amount: s.amount, items: s.items }));
const itemsOf = (e: Partial<Entry>) =>
  (e.receipt?.items ?? []).map((i) => ({ name: i.name, amount: i.amount, category_code: i.category ?? null, unsure: !!i.unsure }));

/** one element of post_entries(p_entries) */
export function entryPayload(e: Entry): Row {
  return {
    id: e.id,
    account_id: e.accountId,
    category_code: e.category,
    amount: e.amount,
    occurred_at: e.date,
    description: e.desc,
    raw: e.raw ?? null,
    source: e.source ?? null,
    method: e.method ?? null,
    auto: !!e.auto,
    created_by: "owner",
    receipt_image_path: e.receipt?.path ?? null,
    ...(e.linkId ? { move_id: e.linkId } : {}),
    ...(e.status === "review" ? { status: "review", review_question: e.reviewQuestion ?? null } : {}),
    splits: splitsOf(e),
    receipt_items: itemsOf(e),
  };
}

/** update_entry(p_patch): only the keys the app patch touched. `refunded` goes to mark_refunded. */
export function entryPatch(patch: Partial<Entry>): Row {
  const p: Row = {};
  if ("desc" in patch) p.description = patch.desc;
  if ("amount" in patch) p.amount = patch.amount;
  if ("category" in patch) p.category_code = patch.category ?? null;
  if ("accountId" in patch) p.account_id = patch.accountId ?? null;
  if ("date" in patch) p.occurred_at = patch.date;
  if ("method" in patch) p.method = patch.method ?? null;
  if ("auto" in patch) p.auto = !!patch.auto;
  if ("raw" in patch) p.raw = patch.raw ?? null;
  if ("source" in patch) p.source = patch.source ?? null;
  if ("split" in patch) p.splits = splitsOf(patch);
  if ("receipt" in patch) {
    p.receipt_items = itemsOf(patch);
    if (patch.receipt?.path) p.receipt_image_path = patch.receipt.path;
  }
  if ("status" in patch && patch.status) p.status = patch.status;
  if ("reviewQuestion" in patch) p.review_question = patch.reviewQuestion ?? null;
  return p;
}

export function toProfile(r: Row | null, goals: Row[], holdings: Row[], base: Profile): Profile {
  return {
    ...base,
    name: str(r?.name) ?? "",
    initials: str(r?.initials) ?? "",
    income: num(r?.income),
    frequency: ((r?.frequency as Frequency) ?? base.frequency) || base.frequency,
    sideIncome: ((r?.side_income as SideIncome[] | null) ?? []).map((x) => ({ ...x, amount: num(x.amount) })),
    monthlyBudget: num(r?.monthly_budget),
    categoryBudgets: Object.fromEntries(Object.entries((r?.category_budgets as Record<string, unknown> | null) ?? {}).map(([k, v]) => [k, num(v)])),
    goals: goals.map(toGoal),
    holdings: holdings.map(toHolding),
  };
}

export function profilePayload(p: Partial<Profile>): Row {
  const r: Row = {};
  if ("name" in p) r.name = p.name;
  if ("initials" in p) r.initials = p.initials;
  if ("income" in p) r.income = p.income;
  if ("frequency" in p) r.frequency = p.frequency;
  if ("sideIncome" in p) r.side_income = p.sideIncome;
  if ("monthlyBudget" in p) r.monthly_budget = p.monthlyBudget;
  if ("categoryBudgets" in p) r.category_budgets = p.categoryBudgets;
  return r;
}

export const toGoal = (g: Row): Goal => ({ id: String(g.id), name: String(g.name), saved: num(g.saved), target: num(g.target), by: str(g.by_month) ?? "" });
export const goalPayload = (g: Goal): Row => ({ id: g.id, name: g.name, saved: g.saved, target: g.target, by_month: g.by });

const toHolding = (h: Row): Holding => ({
  ticker: String(h.symbol),
  name: str(h.name) ?? String(h.symbol),
  shares: num(h.qty),
  value: num(h.value),
  change: num(h.change_pct),
});

/** latest holding_snapshots per account = current holdings */
export function latestHoldings(rows: Row[]): Row[] {
  const latest = new Map<string, string>();
  for (const r of rows) {
    const a = String(r.account_id);
    const t = String(r.as_of);
    if (!latest.has(a) || new Date(t) > new Date(latest.get(a)!)) latest.set(a, t);
  }
  return rows.filter((r) => latest.get(String(r.account_id)) === String(r.as_of));
}
