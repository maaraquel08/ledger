// The knowledge-base block that goes into the cached system prefix of the capture prompt.
// Pure module. Must be byte-stable: the same rows in any order produce the same string
// (prompt caching is a prefix match; any byte change invalidates the cache).

export interface AccountRow {
  id: string;
  name: string;
  provider: string;
  provider_label: string;
  type: string;
  last4: string | null;
  archived_at?: string | null;
}
export interface AliasRow {
  id?: string;
  account_id: string;
  alias: string;
}
export interface RuleRow {
  id: string;
  match: { merchant?: string; text_contains?: string };
  set: { category_code?: string; account_id?: string; merchant?: string };
  active?: boolean;
}
export interface RecurringRow {
  id: string;
  description: string;
  merchant: string | null;
  category_code: string | null;
  account_id: string | null;
  amount: number | string;
  cadence: string;
  day_of_month: number | null;
  weekday: number | null;
  active?: boolean;
}

export interface KnowledgeBase {
  accounts: AccountRow[];
  aliases: AliasRow[];
  rules: RuleRow[];
  recurring: RecurringRow[];
}

export const CATEGORIES = [
  "Food & drink", "Groceries", "Transport", "Shopping", "Rent & bills", "Subscriptions", "Gifts",
  "Household", "Health", "Salary", "Income", "Investments", "Transfer", "Other",
] as const;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const by = <T>(...keys: ((x: T) => string)[]) => (a: T, b: T) => {
  for (const k of keys) {
    const c = cmp(k(a), k(b));
    if (c) return c;
  }
  return 0;
};
/** one line per row; strip newlines and pipes so data can't forge structure */
const cell = (v: unknown) => String(v ?? "").replace(/[\r\n|]+/g, " ").trim();
/** stable JSON: keys sorted */
const stable = (o: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "").sort(([a], [b]) => cmp(a, b))));

export function buildKbBlock(kb: KnowledgeBase): string {
  const live = kb.accounts.filter((a) => !a.archived_at);
  const name = new Map(live.map((a) => [a.id, a.name]));
  const lines: string[] = ["<knowledge_base>", "ACCOUNTS (name | provider | type | last4)"];
  for (const a of [...live].sort(by((x) => x.name.toLowerCase(), (x) => x.id))) {
    lines.push(`- ${cell(a.name)} | ${cell(a.provider_label || a.provider)} | ${cell(a.type)} | ${cell(a.last4) || "-"}`);
  }
  lines.push("", "ACCOUNT ALIASES (what the Owner says -> account name)");
  for (const al of [...kb.aliases].filter((x) => name.has(x.account_id)).sort(by((x) => x.alias.toLowerCase(), (x) => x.account_id))) {
    lines.push(`- ${cell(al.alias.toLowerCase())} -> ${cell(name.get(al.account_id))}`);
  }
  lines.push("", "LEARNED RULES (when -> then; the Owner taught these by correcting entries)");
  for (const r of [...kb.rules].filter((x) => x.active !== false).sort(by((x) => stable(x.match), (x) => x.id))) {
    const set = { ...r.set, account: r.set.account_id ? name.get(r.set.account_id) : undefined, account_id: undefined };
    lines.push(`- ${cell(stable(r.match))} -> ${cell(stable(set))}`);
  }
  lines.push("", "RECURRING ITEMS (description | category | amount | cadence | account)");
  for (const r of [...kb.recurring].filter((x) => x.active !== false).sort(by((x) => x.description.toLowerCase(), (x) => x.id))) {
    const when = r.cadence === "weekly" ? `weekly` : `monthly`;
    lines.push(`- ${cell(r.description)} | ${cell(r.category_code)} | ${cell(Number(r.amount))} | ${when} | ${cell(r.account_id ? name.get(r.account_id) : "")}`);
  }
  lines.push("", `CATEGORIES: ${CATEGORIES.join("; ")}`, "</knowledge_base>");
  return lines.join("\n");
}
