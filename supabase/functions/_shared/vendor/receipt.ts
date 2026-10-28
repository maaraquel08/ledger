// GENERATED from src/lib by supabase/functions/_shared/vendor/sync.mjs. Do not edit.
import { suggestCategory } from "./providers.ts";
import type { Account, Category, Entry, ReceiptItem, Split } from "./types.ts";

/**
 * Turning OCR text from a receipt photo into an entry. M8 reads the
 * merchant, total and how you paid, then splits the items by category.
 */

export interface ReceiptDraft {
  merchant: string;
  total: number | null;
  items: ReceiptItem[];
  accountId: string | null;
  when: string; // ISO
  image?: string; // compressed data URL
  /** where M8 isn't sure — the reason the review screen shows */
  doubts: string[];
}

const GROCERS = /\b(puregold|sm (super)?market|savemore|robinsons|landers|s&r|waltermart|alfamart|7-?eleven|ministop|shopwise|metro|rustan|lawson|family ?mart)\b/i;
const RESTAURANTS = /\b(mcdonald|jollibee|starbucks|kfc|chowking|greenwich|mang inasal|tim hortons|max'?s|shakey|pizza|cafe|coffee|grill|bistro|kitchen|restaurant|tea)\b/i;
const FUEL = /\b(shell|petron|caltex|seaoil|phoenix|cleanfuel|unioil)\b/i;
const PHARMACY = /\b(mercury|watsons|generika|southstar|rose pharmacy|the generics)\b/i;

/** Lines that hold a number but aren't an item. */
const NOT_ITEM =
  /\b(sub ?total|total|amount due|amt due|cash|change|tender|vat|tax|discount|disc|balance|items?|qty|card|gcash|maya|visa|master|jcb|debit|credit|points|ref|tin|or no|invoice|sales|serial|terminal|cashier|thank)\b/i;

/** Items whose category genuinely could go either way. */
const AMBIGUOUS: [RegExp, Category, Category][] = [
  [/\b(tissue|napkin|paper towel)\b/i, "Household", "Groceries"],
  [/\b(vitamin|alcohol|cotton)\b/i, "Health", "Groceries"],
  [/\b(water|ice)\b/i, "Groceries", "Food & drink"],
];

const money = (s: string) => parseFloat(s.replace(/,/g, ""));
const PRICE = /(-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2})\s*[A-Z]?$/;

const titleish = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bx\s?(\d+)\b/g, "×$1")
    .replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\b(\d+)(pc|pcs|kg|g|ml)\b/gi, (_, n, u) => n + u.toLowerCase())
    .replace(/\b(\d+)(l|r)\b/gi, (_, n, u) => n + u.toUpperCase())
    .trim();

function merchantCategory(merchant: string): Category | null {
  if (GROCERS.test(merchant)) return "Groceries";
  if (RESTAURANTS.test(merchant)) return "Food & drink";
  if (FUEL.test(merchant)) return "Transport";
  if (PHARMACY.test(merchant)) return "Health";
  return suggestCategory(merchant);
}

function itemCategory(name: string, store: Category | null): { category: Category; unsure?: boolean } {
  for (const [re, first] of AMBIGUOUS) if (re.test(name)) return { category: first, unsure: true };
  // a restaurant or a pump sells one thing, whatever the line says
  if (store && store !== "Groceries") return { category: store };
  const s = suggestCategory(name);
  if (s === "Household" || s === "Health") return { category: s };
  return { category: store ?? s ?? "Other" };
}

function paidWith(text: string, accounts: Account[]): string | null {
  const t = text.toUpperCase();
  const byType = (type: Account["type"]) => accounts.find((a) => a.type === type)?.id ?? null;
  const byProvider = (p: Account["provider"]) => accounts.find((a) => a.provider === p)?.id ?? null;
  for (const a of accounts) if (a.last4 && new RegExp(`(\\*|X|·|\\s)${a.last4}\\b`).test(t)) return a.id;
  if (/\bG-?CASH\b/.test(t)) return byProvider("gcash");
  if (/\bMAYA\b|PAYMAYA/.test(t)) return byProvider("maya");
  if (/\b(VISA|MASTER ?CARD|JCB|AMEX|CREDIT)\b/.test(t)) return byType("credit");
  if (/\bBPI\b/.test(t)) return byProvider("bpi");
  if (/\bBDO\b/.test(t)) return byProvider("bdo");
  if (/\bDEBIT\b/.test(t)) return byType("bank");
  if (/\bCASH\b/.test(t)) return byType("cash");
  return null;
}

function when(text: string, now = new Date()): string {
  const d = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  const t = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?\b/i);
  const out = new Date(now);
  if (d) {
    let [a, b] = [parseInt(d[1]), parseInt(d[2])];
    const y = parseInt(d[3]) < 100 ? 2000 + parseInt(d[3]) : parseInt(d[3]);
    // PH receipts print MM/DD; if that's impossible, it's DD/MM
    if (a > 12) [a, b] = [b, a];
    const cand = new Date(y, a - 1, b);
    if (!isNaN(cand.getTime()) && Math.abs(cand.getTime() - now.getTime()) < 400 * 86400000) out.setFullYear(y, a - 1, b);
  }
  if (t) {
    let h = parseInt(t[1]);
    if (t[3]?.toUpperCase() === "PM" && h < 12) h += 12;
    if (t[3]?.toUpperCase() === "AM" && h === 12) h = 0;
    if (h < 24) out.setHours(h, parseInt(t[2]), 0, 0);
  }
  // a receipt from the future is a misread
  return (out > now ? now : out).toISOString();
}

export function parseReceipt(text: string, accounts: Account[], now = new Date()): ReceiptDraft {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const merchantLine = lines.find((l) => (l.match(/[a-z]/gi)?.length ?? 0) >= 3 && !/\d{3,}/.test(l)) ?? "";
  const merchant = titleish(merchantLine.replace(/[^a-z0-9&'.\s-]/gi, "")).slice(0, 40) || "Receipt";
  const store = merchantCategory(merchant);

  // total: prefer an explicit TOTAL / AMOUNT DUE that isn't a subtotal
  let total: number | null = null;
  for (const l of lines) {
    if (/sub ?total/i.test(l)) continue;
    if (/\b(total|amount due|amt due|grand total|total due)\b/i.test(l)) {
      const m = l.match(PRICE) ?? l.match(/(\d[\d,]*\.?\d*)\s*$/);
      if (m) {
        total = money(m[1]);
        break;
      }
    }
  }

  const items: ReceiptItem[] = [];
  for (const l of lines) {
    if (l === merchantLine || NOT_ITEM.test(l)) continue;
    const m = l.match(PRICE);
    if (!m) continue;
    const amount = money(m[1]);
    const name = titleish(l.slice(0, m.index).replace(/[^a-z0-9×x&'.\s-]/gi, " "));
    if (!name || amount <= 0 || (name.match(/[a-z]/gi)?.length ?? 0) < 2) continue;
    items.push({ name, amount, ...itemCategory(name, store) });
  }

  const doubts: string[] = [];
  const sum = items.reduce((n, i) => n + i.amount, 0);
  if (total == null && sum > 0) total = Math.round(sum * 100) / 100;
  if (total != null && items.length && Math.abs(sum - total) > 1) {
    const rest = Math.round((total - sum) * 100) / 100;
    if (rest > 0) items.push({ name: "Other items", amount: rest, category: store ?? "Other", unsure: true });
    doubts.push(`The items add up to ${sum.toFixed(0)}, not ${total.toFixed(0)}.`);
  }
  for (const i of items)
    if (i.unsure && i.name !== "Other items") {
      const alt = AMBIGUOUS.find(([re]) => re.test(i.name));
      doubts.push(`${i.name.split(" ")[0]} could be ${alt ? `${alt[1]} or ${alt[2]}` : "a different category"}.`);
    }
  const accountId = paidWith(text, accounts);
  if (!accountId && accounts.length) doubts.push("I couldn’t tell how you paid.");
  if (!store && !items.length) doubts.push("I couldn’t tell what this was for.");

  return { merchant, total, items, accountId, when: when(text, now), doubts };
}

/** Items grouped by category, biggest first. */
export function splitOf(items: ReceiptItem[]): Split[] {
  const m = new Map<Category, Split>();
  for (const i of items) {
    const s = m.get(i.category) ?? { category: i.category, amount: 0, items: [] };
    s.amount = Math.round((s.amount + i.amount) * 100) / 100;
    s.items.push(i.name);
    m.set(i.category, s);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

export function draftToEntry(d: ReceiptDraft, id: string): Entry {
  const split = splitOf(d.items);
  const total = d.total ?? split.reduce((n, s) => n + s.amount, 0);
  return {
    id,
    desc: d.merchant,
    accountId: d.accountId,
    category: split[0]?.category ?? merchantCategory(d.merchant) ?? null,
    amount: -Math.round(total),
    date: d.when,
    source: "receipt",
    split: split.length > 1 ? split : undefined,
    receipt: { image: d.image, items: d.items.map(({ name, amount, category }) => ({ name, amount, category })) },
  };
}

/** Same purchase already logged (by voice or typing) around the same time? */
export function findDuplicate(d: ReceiptDraft, entries: Entry[]): Entry | undefined {
  if (d.total == null) return undefined;
  const t = new Date(d.when).getTime();
  return entries.find(
    (e) =>
      !e.receipt &&
      e.amount < 0 &&
      Math.abs(-e.amount - d.total!) <= 1 &&
      Math.abs(new Date(e.date).getTime() - t) < 3 * 3600_000,
  );
}
