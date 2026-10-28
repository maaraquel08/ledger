export type Provider =
  | "gcash"
  | "bpi"
  | "bdo"
  | "maya"
  | "maribank"
  | "rcbc"
  | "unionbank"
  | "ibkr"
  | "cash"
  | "other";

export type AccountType = "bank" | "investments" | "ewallet" | "cash" | "credit";

export interface Account {
  id: string;
  name: string; // what the user calls it ("Daily wallet")
  provider: Provider;
  providerLabel: string; // "GCash", "RCBC JCB"
  type: AccountType;
  kind: string; // mono subtitle: SAVINGS, WALLET, CREDIT, BROKERAGE, PHYSICAL
  last4?: string;
  balance: number; // for credit: amount owed (positive)
  rate?: string; // "4.5% p.a."
  dueDate?: string; // ISO, credit only
}

export type Category =
  | "Food & drink"
  | "Groceries"
  | "Transport"
  | "Shopping"
  | "Rent & bills"
  | "Subscriptions"
  | "Gifts"
  | "Household"
  | "Health"
  | "Salary"
  | "Income"
  | "Investments"
  | "Transfer"
  | "Other"
  /** closes the gap between a reported and a derived balance, once the Owner confirms (D-0014) */
  | "Adjustment";

export interface Entry {
  id: string;
  desc: string;
  accountId: string | null;
  category: Category | null;
  amount: number; // signed: negative = out
  date: string; // ISO datetime
  raw?: string; // what the user typed
  method?: string;
  auto?: boolean; // auto-debit
  refunded?: boolean; // reversed: excluded from spend and from the account balance
  queued?: boolean; // saved on this phone while offline; a future sync clears it
  /** the other leg of a transfer or investment; deleting one leg deletes both */
  linkId?: string;
  source?: "voice" | "receipt"; // logged by holding the orb, or from a scanned receipt
  /** one purchase spread over several categories (a grocery receipt) */
  split?: Split[];
  receipt?: { image?: string; items: ReceiptItem[]; /** cloud: Storage path in bucket receipts */ path?: string };
  /** cloud only: "review" = waiting for the Owner (gate question or missing field) */
  status?: "posted" | "review";
  /** cloud only: the one targeted question the capture gate asked */
  reviewQuestion?: string;
}

export interface ReceiptItem {
  name: string;
  amount: number; // positive
  category: Category;
  unsure?: boolean; // M8 isn't sure of the category
}

export interface Split {
  category: Category;
  amount: number; // positive
  items: string[];
}

export type Frequency = "Twice a month" | "Monthly" | "Weekly" | "Irregular";

export interface SideIncome {
  id: string;
  label: string;
  amount: number;
  frequency: Frequency;
}

export interface Goal {
  id: string;
  name: string;
  saved: number;
  target: number;
  by: string; // "YYYY-MM", or "" for no date
}

export interface Holding {
  ticker: string;
  name: string;
  shares: number;
  value: number;
  change: number; // percent
}

export interface Profile {
  name: string;
  initials: string;
  income: number; // per payday, take-home
  frequency: Frequency;
  sideIncome: SideIncome[];
  monthlyBudget: number;
  categoryBudgets: Partial<Record<Category, number>>;
  goals: Goal[];
  holdings: Holding[];
}

export interface LedgerState {
  onboarded: boolean;
  demo: boolean;
  profile: Profile;
  accounts: Account[];
  entries: Entry[];
  questionsToday: number;
  questionsDate?: string; // local YYYY-MM-DD the counter belongs to
}
