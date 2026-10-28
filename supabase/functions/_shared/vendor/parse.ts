// GENERATED from src/lib by supabase/functions/_shared/vendor/sync.mjs. Do not edit.
import { PROVIDERS, suggestCategory } from "./providers.ts";
import type { Account, Category } from "./types.ts";

export interface Parsed {
  desc: string;
  amount: number | null; // signed
  accountId: string | null;
  category: Category | null;
}

const INCOME = /\b(salary|payroll|sahod|freelance|retainer|refund|dividend|received|got paid|interest)\b/i;

/**
 * "grab gcash 248" is a whole entry: the last number is the amount, any word
 * that names one of your accounts is the account, the rest is the description.
 */
export function parseEntry(text: string, accounts: Account[]): Parsed {
  let rest = ` ${text.trim()} `;
  let amount: number | null = null;
  let explicitPlus = false;

  const nums = [...rest.matchAll(/([+-]?)₱?\s?(\d[\d,]*(?:\.\d+)?)(k?)\b/gi)];
  const last = nums.at(-1);
  if (last) {
    const v = parseFloat(last[2].replace(/,/g, "")) * (last[3] ? 1000 : 1);
    if (v > 0) {
      amount = v;
      explicitPlus = last[1] === "+";
      rest = rest.replace(last[0], " ");
    }
  }

  let accountId: string | null = null;
  const lower = rest.toLowerCase();
  // last four digits, then the user's own name for it, then provider aliases
  for (const a of accounts) {
    if (a.last4 && lower.includes(a.last4)) {
      accountId = a.id;
      rest = rest.replace(new RegExp(a.last4), " ");
      break;
    }
  }
  if (!accountId)
    for (const a of accounts) {
      const re = new RegExp(`\\b${a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(rest)) {
        accountId = a.id;
        rest = rest.replace(re, " ");
        break;
      }
    }
  if (!accountId)
    outer: for (const a of accounts) {
      const meta = PROVIDERS.find((p) => p.id === a.provider);
      const words = [...(meta?.aliases ?? []), ...a.providerLabel.toLowerCase().split(/\s+/)];
      const sorted = words.sort((x, y) => y.length - x.length);
      if (sorted.some((w) => new RegExp(`\\b${w}\\b`, "i").test(rest))) {
        accountId = a.id;
        // "rcbc jcb" both name the card — strip every word that does
        for (const w of sorted) rest = rest.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
        break outer;
      }
    }

  const desc = rest.replace(/\s+/g, " ").trim();
  const category = suggestCategory(text);
  const income = explicitPlus || INCOME.test(text);
  const pretty = desc ? desc[0].toUpperCase() + desc.slice(1) : "";

  return {
    desc: pretty,
    amount: amount == null ? null : income ? amount : -amount,
    accountId,
    category: income && !category ? "Income" : category,
  };
}

/* ---------- spoken / typed sentences --------------------------------- */

const QUESTION = /^(can|could|how|what|why|am|is|are|should|do|does|did|where|when|will|would|which|show me|tell me|explain)\b/i;

/** "Can I afford dinner out tonight?" or "Show me the daily math" is a question; "₱250 groceries, cash" is an entry. */
export function isQuestion(text: string) {
  const t = text.trim();
  return t.endsWith("?") || QUESTION.test(t);
}

const hasAmount = (s: string) => /\d/.test(s);

/**
 * One sentence can hold several entries: "Groceries at SM 2,340 cash,
 * Meralco 3,100 from BPI, and I paid Ana back 500 on GCash". Split on
 * ", " and " and " (never inside "2,340"), then glue amount-less pieces
 * ("on my BPI card") back onto their neighbour.
 */
export function splitEntries(text: string): string[] {
  const parts = text.split(/,\s+|\s+and\s+|;\s*/i).map((p) => p.trim()).filter(Boolean);
  const groups: string[] = [];
  for (const p of parts) {
    const last = groups.at(-1);
    if (last !== undefined && (!hasAmount(p) || !hasAmount(last))) groups[groups.length - 1] = `${last} ${p}`;
    else groups.push(p);
  }
  return groups.filter(hasAmount);
}

const FILLER = /\b(on|from|to|via|using|with|by|my|the|card|account|paid with|at)\b/gi;

/**
 * parseEntry tuned for speech: merchant after "at", filler words dropped, and
 * transfers to people ("sent Ana 500"). A capitalised name only reads as a
 * person when no keyword category matched and it isn't an account/provider
 * word, so "paid Meralco 3100" stays Rent & bills and "paid Grab 248" Transport.
 */
export function parseSpoken(text: string, accounts: Account[]): Parsed {
  const p = parseEntry(text, accounts);
  const raw = text.trim();
  const transfer = raw.match(/\b(?:paid|sent|gave|transferred)\s+([A-Z][a-z]+)(?:\s+back)?\b/) ?? raw.match(/\bto\s+([A-Z][a-z]+)\b/);
  const acct = accounts.find((a) => a.id === p.accountId);
  const isAccountWord = !!transfer && !!acct && `${acct.name} ${acct.providerLabel}`.toLowerCase().includes(transfer[1].toLowerCase());
  if (transfer && p.category == null && !isAccountWord && !/\b(salary|payroll)\b/i.test(raw)) {
    return { ...p, desc: transfer[1], category: "Transfer", amount: p.amount == null ? null : -Math.abs(p.amount) };
  }
  const at = p.desc.match(/\bat\s+(.+)$/i);
  let desc = (at ? at[1] : p.desc).replace(FILLER, " ").replace(/\s+/g, " ").trim();
  if (!desc) desc = p.category ?? "Entry";
  return { ...p, desc: desc[0].toUpperCase() + desc.slice(1) };
}
