import type { Account, Category, Entry, LedgerState, Profile } from "./types";

/** The account a brand-new user starts with: nothing. */
export const EMPTY_PROFILE: Profile = {
  name: "",
  initials: "",
  income: 0,
  frequency: "Twice a month",
  sideIncome: [],
  monthlyBudget: 0,
  categoryBudgets: {},
  goals: [],
  holdings: [],
};

export const EMPTY_STATE: LedgerState = {
  onboarded: false,
  demo: false,
  profile: EMPTY_PROFILE,
  accounts: [],
  entries: [],
  questionsToday: 0,
};

// Deterministic PRNG so the demo looks the same on every load.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_ACCOUNTS: Account[] = [
  { id: "a-bpi", name: "Payroll account", provider: "bpi", providerLabel: "BPI", type: "bank", kind: "SAVINGS", last4: "2841", balance: 128400 },
  { id: "a-mari", name: "Emergency fund", provider: "maribank", providerLabel: "MariBank", type: "bank", kind: "SAVINGS", last4: "5510", balance: 62000, rate: "4.5% p.a." },
  { id: "a-gcash", name: "Daily wallet", provider: "gcash", providerLabel: "GCash", type: "ewallet", kind: "WALLET", last4: "8871", balance: 18900 },
  { id: "a-cash", name: "Pocket cash", provider: "cash", providerLabel: "Cash", type: "cash", kind: "PHYSICAL", balance: 5000 },
  { id: "a-rcbc", name: "The card", provider: "rcbc", providerLabel: "RCBC JCB", type: "credit", kind: "CREDIT", last4: "4402", balance: 18240 },
  { id: "a-ibkr", name: "Investments", provider: "ibkr", providerLabel: "IBKR", type: "investments", kind: "BROKERAGE", balance: 1070630 },
];

type Spend = [string, Category, string, number, number]; // desc, cat, account, min, max
const DAILY: Spend[] = [
  ["Grab", "Transport", "a-gcash", 160, 420],
  ["Starbucks", "Food & drink", "a-rcbc", 240, 460],
  ["Jollibee", "Food & drink", "a-gcash", 180, 320],
  ["lunch", "Food & drink", "a-gcash", 150, 260],
  ["7-Eleven", "Groceries", "a-gcash", 80, 220],
  ["Landers Superstore", "Groceries", "a-rcbc", 900, 2800],
  ["palengke", "Groceries", "a-cash", 600, 1400],
  ["Shopee", "Shopping", "a-gcash", 350, 1900],
  ["Tim Hortons", "Food & drink", "a-rcbc", 220, 360],
  ["Shell fuel", "Transport", "a-rcbc", 1200, 2100],
  ["dinner w/ friends", "Food & drink", "a-rcbc", 700, 1800],
  ["Uniqlo", "Shopping", "a-rcbc", 990, 2490],
  ["Watsons", "Health", "a-rcbc", 250, 780],
  ["load", "Rent & bills", "a-gcash", 100, 300],
];

let n = 0;
const id = () => `e${(++n).toString(36)}`;

export function buildDemo(today = new Date()): LedgerState {
  n = 0;
  const rand = mulberry32(32);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => Math.round((a + rand() * (b - a)) / 5) * 5;
  const entries: Entry[] = [];
  const push = (e: Omit<Entry, "id">) => entries.push({ id: id(), ...e });
  // nothing is logged after "now": a time later today moves to a minute before it
  let late = 0;
  const iso = (d: Date, h = 12, m = 0) => {
    const x = new Date(d);
    x.setHours(h, m, 0, 0);
    return (x.getTime() > today.getTime() ? new Date(today.getTime() - ++late * 60_000) : x).toISOString();
  };

  const start = new Date(today.getFullYear(), 0, 1);
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const isToday = d.getTime() === end.getTime();
    const day = d.getDate();
    const dow = d.getDay();
    if (day === 5 || day === 20)
      push({ desc: "Payroll · Acme Inc.", accountId: "a-bpi", category: "Salary", amount: 48000, date: iso(d, 6) });
    if (day === 3) push({ desc: "Rent", accountId: "a-bpi", category: "Rent & bills", amount: -18500, date: iso(d, 10) });
    if (day === 9) push({ desc: "Meralco", accountId: "a-bpi", category: "Rent & bills", amount: -between(2400, 3100), date: iso(d, 7), auto: true });
    if (day === 12) push({ desc: "Maynilad", accountId: "a-bpi", category: "Rent & bills", amount: -612, date: iso(d, 7), auto: true });
    if (day === 15) push({ desc: "PLDT Fibr", accountId: "a-bpi", category: "Rent & bills", amount: -2099, date: iso(d, 7), auto: true });
    if (day === 18) push({ desc: "Netflix", accountId: "a-rcbc", category: "Subscriptions", amount: -549, date: iso(d, 6), auto: true });
    if (day === 22) push({ desc: "Spotify", accountId: "a-rcbc", category: "Subscriptions", amount: -194, date: iso(d, 6), auto: true });
    if (day === 6) {
      // an invest is a move: out of the payroll account, into the brokerage (D-0010)
      const date = iso(d, 21);
      const linkId = `l-voo-${d.getMonth() + 1}`;
      push({ desc: "VOO", accountId: "a-bpi", category: "Investments", amount: -8000, date, linkId });
      push({ desc: "VOO", accountId: "a-ibkr", category: "Investments", amount: 8000, date, linkId });
    }
    if (day === 25 && rand() > 0.35)
      push({ desc: "Freelance · Studio K", accountId: "a-gcash", category: "Income", amount: 12000, date: iso(d, 16) });
    const count = isToday ? 0 : dow === 5 ? 3 : dow === 0 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const [desc, category, accountId, min, max] = pick(DAILY);
      const hi = dow === 5 ? 1.6 : 1;
      push({ desc, category, accountId, amount: -between(min, max * hi), date: iso(d, 8 + Math.floor(rand() * 13), Math.floor(rand() * 60)), method: accountId === "a-rcbc" ? "Contactless" : undefined });
    }
  }

  // Today and yesterday, as the design shows them.
  const yest = new Date(end);
  yest.setDate(yest.getDate() - 1);
  push({ desc: "Grab", accountId: "a-gcash", category: "Transport", amount: -248, date: iso(end, 8, 42), raw: "grab gcash 248" });
  push({ desc: "Starbucks", accountId: "a-rcbc", category: "Food & drink", amount: -290, date: iso(end, 8, 14), raw: "starbucks rcbc jcb 290", method: "Contactless" });
  push({ desc: "Landers Superstore", accountId: "a-bpi", category: "Groceries", amount: -500, date: iso(end, 7, 30) });
  // The review queue: entries the parser couldn't fully file.
  push({ desc: "lunch w/ team", accountId: "a-cash", category: null, amount: -780, date: iso(yest, 13), raw: "lunch w/ team cash 780" });
  push({ desc: "tita bday gift", accountId: "a-gcash", category: null, amount: -1500, date: iso(yest, 18), raw: "tita bday gift gcash 1500" });
  push({ desc: "7-Eleven", accountId: null, category: "Groceries", amount: -135, date: iso(yest, 21), raw: "7-eleven 135" });

  entries.sort((a, b) => b.date.localeCompare(a.date));

  const dueDate = new Date(today.getFullYear(), today.getMonth() + 1, 15).toISOString();
  return {
    onboarded: true,
    demo: true,
    questionsToday: 0,
    accounts: DEMO_ACCOUNTS.map((a) => (a.type === "credit" ? { ...a, dueDate } : a)),
    entries,
    profile: {
      name: "Mika Reyes",
      initials: "MR",
      income: 48000,
      frequency: "Twice a month",
      sideIncome: [{ id: "s1", label: "Freelance · Studio K", amount: 12000, frequency: "Irregular" }],
      monthlyBudget: 63000,
      categoryBudgets: { "Food & drink": 16000, Transport: 12000, Shopping: 14000, "Rent & bills": 21000 },
      goals: [
        { id: "g1", name: "Emergency fund", saved: 216000, target: 300000, by: "2027-01" },
        { id: "g2", name: "Japan trip", saved: 61500, target: 150000, by: "2027-04" },
        { id: "g3", name: "New laptop", saved: 11700, target: 65000, by: "2026-11" },
      ],
      holdings: [
        { ticker: "VOO", name: "Vanguard S&P 500", shares: 12, value: 492400, change: 14.1 },
        { ticker: "FMETF", name: "First Metro PH ETF", shares: 2400, value: 278300, change: -2.4 },
        { ticker: "BND", name: "Total Bond Market", shares: 40, value: 192700, change: 3.0 },
        { ticker: "JFC", name: "Jollibee Foods", shares: 380, value: 107230, change: 6.8 },
      ],
    },
  };
}
