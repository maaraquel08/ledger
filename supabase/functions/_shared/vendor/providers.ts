// GENERATED from src/lib by supabase/functions/_shared/vendor/sync.mjs. Do not edit.
import type { AccountType, Category, Provider } from "./types.ts";

export interface ProviderMeta {
  id: Provider;
  label: string;
  logo?: string; // image in /public/assets
  icon?: "chart" | "cash";
  type: AccountType;
  kind: string;
  aliases: string[]; // words a typed entry can use to name it
}

export const PROVIDERS: ProviderMeta[] = [
  { id: "gcash", label: "GCash", logo: "/assets/logo-gcash.jpg", type: "ewallet", kind: "WALLET", aliases: ["gcash", "gc"] },
  { id: "bpi", label: "BPI", logo: "/assets/logo-bpi.png", type: "bank", kind: "SAVINGS", aliases: ["bpi"] },
  { id: "bdo", label: "BDO", logo: "/assets/logo-bdo.jpg", type: "bank", kind: "SAVINGS", aliases: ["bdo"] },
  { id: "maya", label: "Maya", logo: "/assets/logo-maya.webp", type: "ewallet", kind: "WALLET", aliases: ["maya", "paymaya"] },
  { id: "maribank", label: "MariBank", logo: "/assets/logo-maribank.png", type: "bank", kind: "SAVINGS", aliases: ["maribank", "mari"] },
  { id: "rcbc", label: "RCBC", logo: "/assets/logo-rcbc.png", type: "credit", kind: "CREDIT", aliases: ["rcbc", "jcb", "card"] },
  { id: "unionbank", label: "UnionBank", logo: "/assets/logo-unionbank.jpg", type: "bank", kind: "SAVINGS", aliases: ["unionbank", "ub"] },
  { id: "ibkr", label: "IBKR", icon: "chart", type: "investments", kind: "BROKERAGE", aliases: ["ibkr"] },
  { id: "cash", label: "Cash", icon: "cash", type: "cash", kind: "PHYSICAL", aliases: ["cash", "pocket"] },
];

export const providerMeta = (id: Provider): ProviderMeta =>
  PROVIDERS.find((p) => p.id === id) ?? {
    id: "other",
    label: "Account",
    type: "bank",
    kind: "ACCOUNT",
    aliases: [],
  };

export const TYPE_LABEL: Record<AccountType, string> = {
  bank: "Bank",
  investments: "Investments",
  ewallet: "eWallet",
  cash: "Cash",
  credit: "Credit",
};

export const TYPE_KIND: Record<AccountType, string> = {
  bank: "SAVINGS",
  investments: "BROKERAGE",
  ewallet: "WALLET",
  cash: "PHYSICAL",
  credit: "CREDIT",
};

/** Spending categories in display order. */
export const SPEND_CATEGORIES: Category[] = [
  "Food & drink",
  "Groceries",
  "Transport",
  "Shopping",
  "Rent & bills",
  "Subscriptions",
  "Gifts",
  "Household",
  "Health",
  "Other",
];

/** Merchant / keyword → category, used by the entry parser and AI suggestions. */
export const KEYWORDS: [RegExp, Category][] = [
  [/\b(grab|angkas|joyride|taxi|mrt|lrt|jeep|bus|shell|petron|caltex|fuel|gas|transport|parking|toll)\b/i, "Transport"],
  [/\b(starbucks|coffee|tim hortons|jollibee|mcdo|mcdonald|lunch|dinner|breakfast|beer|food|cafe|resto|kfc|chowking|pizza|milk ?tea|bday dinner)\b/i, "Food & drink"],
  [/\b(landers|s&r|sm market|puregold|7-?eleven|ministop|palengke|market|groceries|grocery|pandamart|robinsons)\b/i, "Groceries"],
  [/\b(meralco|maynilad|manila water|pldt|globe|smart|converge|rent|load|bills?)\b/i, "Rent & bills"],
  [/\b(netflix|spotify|youtube|icloud|disney|subscription|chatgpt)\b/i, "Subscriptions"],
  [/\b(shopee|lazada|uniqlo|zara|h&m|shopping|watsons)\b/i, "Shopping"],
  [/\b(gift|regalo|bday|birthday)\b/i, "Gifts"],
  [/\b(soap|detergent|tissue|toilet paper|bleach|zonrox|downy|ariel|sponge|trash bag|fabcon|dishwashing)\b/i, "Household"],
  [/\b(mercury|pharmacy|doctor|clinic|medicine|barber|salon)\b/i, "Health"],
  [/\b(salary|payroll|sahod)\b/i, "Salary"],
  [/\b(freelance|retainer|refund|dividend|interest)\b/i, "Income"],
  [/\b(voo|stocks?|etf|invest)\b/i, "Investments"],
];

export function suggestCategory(text: string): Category | null {
  for (const [re, cat] of KEYWORDS) if (re.test(text)) return cat;
  return null;
}
