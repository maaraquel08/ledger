import { beforeAll, describe, expect, test } from "vitest";
import { buildDemo } from "../../src/lib/seed";
import { byCategory, inRange, monthBounds, netWorth, totals } from "../../src/lib/selectors";
import { todayBudget } from "../../src/lib/today";
import type { Account, Entry, LedgerState } from "../../src/lib/types";
import { createDb, num, U1, U2, type Db } from "./harness";

// The TS functions run in this process's local timezone; the SQL ones in the
// profile's timezone. Make them the same zone so the comparison is exact.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

let db: Db;
const j = (v: unknown) => JSON.stringify(v);
const at = (d: number, h: number, m = 0, month = 9) => new Date(2026, month, d, h, m).toISOString();

const ACCOUNTS: Account[] = [
  { id: "a-bank", name: "Payroll", provider: "bpi", providerLabel: "BPI", type: "bank", kind: "SAVINGS", last4: "2841", balance: 120_000 },
  { id: "a-wallet", name: "Wallet", provider: "gcash", providerLabel: "GCash", type: "ewallet", kind: "WALLET", balance: 9_000 },
  { id: "a-card", name: "Card", provider: "rcbc", providerLabel: "RCBC JCB", type: "credit", kind: "CREDIT", balance: 15_000 },
  { id: "a-cash", name: "Cash", provider: "cash", providerLabel: "Cash", type: "cash", kind: "PHYSICAL", balance: 3_000 },
  { id: "a-inv", name: "IBKR", provider: "ibkr", providerLabel: "IBKR", type: "investments", kind: "BROKERAGE", balance: 50_000 },
];

const e = (id: string, desc: string, accountId: string | null, category: Entry["category"], amount: number, date: string, extra: Partial<Entry> = {}): Entry =>
  ({ id, desc, accountId, category, amount, date, ...extra });

const ENTRIES: Entry[] = [
  e("e1", "Payroll · Acme", "a-bank", "Salary", 48_000, at(5, 6)),
  e("e2", "Rent", "a-bank", "Rent & bills", -18_500, at(3, 10)),
  e("e3", "Grab", "a-wallet", "Transport", -250, at(14, 8)),
  e("e4", "Starbucks", "a-card", "Food & drink", -300, at(15, 9)),
  e("e5", "Landers", "a-card", "Groceries", -2_000, at(15, 10)),
  e("e6", "SM Supermarket", "a-wallet", "Groceries", -1_500, at(15, 11), {
    split: [
      { category: "Groceries", amount: 1_000, items: ["rice", "eggs"] },
      { category: "Food & drink", amount: 300, items: ["ready meal"] },
      { category: "Household", amount: 200, items: ["soap"] },
    ],
    receipt: { items: [{ name: "rice", amount: 600, category: "Groceries" }, { name: "soap", amount: 200, category: "Household", unsure: true }] },
  }),
  e("e7", "Shopee", "a-wallet", "Shopping", -900, at(10, 12), { refunded: true }),
  e("e8", "To GCash", "a-bank", "Transfer", -5_000, at(6, 9), { linkId: "L1" }),
  e("e9", "From BPI", "a-wallet", "Transfer", 5_000, at(6, 9), { linkId: "L1" }),
  e("e10", "VOO", "a-bank", "Investments", -8_000, at(6, 21), { linkId: "L2" }),
  e("e11", "VOO", "a-inv", "Investments", 8_000, at(6, 21), { linkId: "L2" }),
  e("e12", "lunch w/ team", "a-cash", null, -780, at(14, 13), { raw: "lunch w/ team cash 780" }),
  e("e13", "7-Eleven", null, "Groceries", -135, at(14, 21)),
  e("e14", "dinner", "a-card", "Food & drink", -1_200, at(20, 19)),
  e("e15", "Freelance · Studio K", "a-wallet", "Income", 12_000, at(12, 16)),
  e("e16", "Grab", "a-wallet", "Transport", -400, at(20, 8, 0, 8)), // September
  e("e17", "Jollibee", "a-wallet", "Food & drink", -200, at(15, 20)), // later today
];

const FIXTURE: LedgerState = {
  onboarded: true,
  demo: false,
  questionsToday: 0,
  accounts: ACCOUNTS,
  entries: ENTRIES,
  profile: {
    name: "Test Owner", initials: "TO", income: 48_000, frequency: "Twice a month", sideIncome: [],
    monthlyBudget: 63_000, categoryBudgets: { "Food & drink": 16_000 },
    goals: [{ id: "g1", name: "Emergency fund", saved: 50_000, target: 300_000, by: "2027-10" }],
    holdings: [{ ticker: "VOO", name: "Vanguard S&P 500", shares: 2, value: 50_000, change: 1.2 }],
  },
};
const NOW = new Date(2026, 9, 15, 14, 0);

async function importAs(uid: string, state: LedgerState) {
  await db.as(uid);
  const res = await db.one("select public.import_state($1::jsonb)", [j(state)]);
  await db.query("update public.profiles set timezone = $1", [TZ]);
  return res;
}

beforeAll(async () => {
  db = await createDb();
}, 60_000);

describe("import_state", () => {
  test("fixture: balances, moves, splits, review, idempotent re-import", async () => {
    const res = await importAs(U1, FIXTURE);
    expect(res.accounts.inserted).toBe(5);
    expect(res.entries.inserted).toBe(17);
    expect(res.moves.inserted).toBe(2);
    expect(res.goals.inserted).toBe(1);
    expect(res.holdings.inserted).toBe(1);
    expect(res.skipped).toEqual([]);

    for (const a of ACCOUNTS) {
      const bal = await db.one("select balance from public.account_balances where account_id = $1", [res.id_map.accounts[a.id]]);
      expect(num(bal), a.id).toBe(a.balance);
    }
    const e6 = await db.one("select public.entry_json($1)", [res.id_map.entries.e6]);
    expect(e6.splits).toHaveLength(3);
    expect(e6.receipt_items[1]).toMatchObject({ name: "soap", unsure: true });
    const e8 = await db.one("select public.entry_json($1)", [res.id_map.entries.e8]);
    expect(e8.move_kind).toBe("transfer");
    expect((await db.one("select public.entry_json($1)", [res.id_map.entries.e10])).move_kind).toBe("invest");
    expect((await db.one("select public.entry_json($1)", [res.id_map.entries.e12])).status).toBe("review");
    expect((await db.one("select public.entry_json($1)", [res.id_map.entries.e7])).refunded_at).not.toBeNull();

    const again = await importAs(U1, FIXTURE);
    expect(again.accounts.inserted).toBe(0);
    expect(again.entries.inserted).toBe(0);
    expect(again.id_map).toEqual(res.id_map);
    expect(num(await db.one("select count(*) from public.entries"))).toBe(17);

    const nw = await db.one("select total from public.net_worth");
    expect(num(nw)).toBe(netWorth(ACCOUNTS).total);
  });

  test("demo: every derived balance equals the demo's stored balance", async () => {
    const demo = buildDemo(NOW);
    const res = await importAs(U2, demo);
    expect(res.entries.inserted).toBe(demo.entries.length);
    for (const a of demo.accounts) {
      const bal = await db.one("select balance from public.account_balances where account_id = $1", [res.id_map.accounts[a.id]]);
      expect(num(bal), a.id).toBe(a.balance);
    }
    expect(num(await db.one("select total from public.net_worth"))).toBe(netWorth(demo.accounts).total);
    const goals = await db.one("select public.goal_progress()");
    expect(goals.map((g: any) => g.name)).toEqual(demo.profile.goals.map((g) => g.name));
  });
});

describe("metrics_period", () => {
  test("October on the fixture", async () => {
    await db.as(U1);
    const [from, to] = monthBounds(NOW);
    const m = await db.one("select public.metrics_period($1, $2)", [from.toISOString(), to.toISOString()]);
    const id = (await db.one("select public.import_state($1::jsonb)", [j(FIXTURE)])).id_map.entries as Record<string, string>;
    const ids = (...xs: string[]) => xs.map((x) => id[x]).sort();

    expect(m.income.value).toBe(60_000);
    expect([...m.income.entry_ids].sort()).toEqual(ids("e1", "e15"));
    expect(m.spend.value).toBe(24_865);
    expect([...m.spend.entry_ids].sort()).toEqual(ids("e2", "e3", "e4", "e5", "e6", "e12", "e13", "e14", "e17"));
    expect(m.net.value).toBe(35_135);
    expect(m.savings_rate.value).toBe(59);
    expect(m.invested.value).toBe(8_000);
    expect(m.entry_count.value).toBe(16);
    expect(m.by_category.map((c: any) => [c.category_code, c.value])).toEqual([
      ["Rent & bills", 18_500],
      ["Groceries", 3_135],
      ["Food & drink", 2_000],
      ["Other", 780],
      ["Transport", 250],
      ["Household", 200],
    ]);
    expect(m.top_merchants[0]).toMatchObject({ merchant: "Rent", value: 18_500, count: 1 });

    // and it agrees with the app's own selectors on the same data
    const t = totals(inRange(ENTRIES, from, to));
    expect(m.income.value).toBe(t.in);
    expect(m.spend.value).toBe(t.out);
    expect(m.by_category.map((c: any) => [c.category_code, c.value])).toEqual(byCategory(inRange(ENTRIES, from, to)));
  });

  test("compare_periods, spend_by_category, entries_matching, period_bounds", async () => {
    await db.as(U1);
    const cmp = await db.one("select public.compare_periods($1, $2, $3, $4)", [
      new Date(2026, 9, 1).toISOString(), new Date(2026, 10, 1).toISOString(),
      new Date(2026, 8, 1).toISOString(), new Date(2026, 9, 1).toISOString(),
    ]);
    expect(cmp.previous.spend.value).toBe(400);
    expect(cmp.delta.spend.value).toBe(24_465);
    const transport = cmp.by_category.find((c: any) => c.category_code === "Transport");
    expect(transport).toMatchObject({ delta: -150 });

    const grab = await db.one("select public.entries_matching('grab')");
    expect(grab.count.value).toBe(2);
    expect(grab.spend.value).toBe(650);
    const fuzzy = await db.one("select public.entries_matching('jolibee')"); // typo
    expect(fuzzy.entries.map((x: any) => x.description)).toContain("Jollibee");

    const sbc = await db.one("select public.spend_by_category($1, $2)", [new Date(2026, 8, 1).toISOString(), new Date(2026, 9, 1).toISOString()]);
    expect(sbc).toEqual([expect.objectContaining({ category_code: "Transport", value: 400, share_pct: 100 })]);

    const wk = await db.one("select public.period_bounds('week', $1)", [NOW.toISOString()]);
    expect(new Date(wk.start).getTime()).toBe(new Date(2026, 9, 12).getTime()); // Monday
    expect(new Date(wk.end).getTime()).toBe(new Date(2026, 9, 19).getTime());
  });
});

describe("today_budget parity with src/lib/today.ts", () => {
  const cases: [string, Date][] = [
    ["mid-month afternoon", NOW],
    ["first of month", new Date(2026, 9, 1, 8, 0)],
    ["last day of month", new Date(2026, 9, 31, 22, 0)],
    ["just after midnight", new Date(2026, 9, 15, 0, 5)],
  ];
  for (const [label, now] of cases) {
    test(`fixture, ${label}`, async () => {
      await db.as(U1);
      const sql = await db.one("select public.today_budget($1)", [now.toISOString()]);
      const ts = todayBudget(FIXTURE, now);
      if (!ts.hasBudget) throw new Error("fixture has a budget");
      expect(sql.has_budget).toBe(true);
      expect({
        budget: sql.budget,
        left: sql.left.value,
        allowance: sql.allowance.value,
        tomorrow: sql.tomorrow.value,
        spentBefore: sql.spent_before.value,
        spentToday: sql.spent_today.value,
        daysLeft: sql.days_left,
      }).toEqual({
        budget: ts.budget, left: ts.left, allowance: ts.allowance, tomorrow: ts.tomorrow,
        spentBefore: ts.spentBefore, spentToday: ts.spentToday, daysLeft: ts.daysLeft,
      });
    });
  }

  test("fixture mid-month cites the entries behind today's spend", async () => {
    await db.as(U1);
    const sql = await db.one("select public.today_budget($1)", [NOW.toISOString()]);
    const id = (await db.one("select public.import_state($1::jsonb)", [j(FIXTURE)])).id_map.entries as Record<string, string>;
    // Starbucks, the split receipt's Food & drink part, Jollibee; not Landers (Groceries)
    expect([...sql.spent_today.entry_ids].sort()).toEqual([id.e4, id.e6, id.e17].sort());
    expect(sql.spent_today.value).toBe(800);
  });

  test("demo data, today", async () => {
    await db.as(U2);
    const demo = buildDemo(NOW);
    const sql = await db.one("select public.today_budget($1)", [NOW.toISOString()]);
    const ts = todayBudget(demo, NOW);
    if (!ts.hasBudget) throw new Error("demo has a budget");
    expect([sql.left.value, sql.allowance.value, sql.tomorrow.value, sql.spent_before.value, sql.spent_today.value, sql.days_left])
      .toEqual([ts.left, ts.allowance, ts.tomorrow, ts.spentBefore, ts.spentToday, ts.daysLeft]);
  });

  test("suggested budget when none is set; no income means no budget", async () => {
    await db.as(U1);
    await db.query("update public.profiles set monthly_budget = 0");
    const sql = await db.one("select public.today_budget($1)", [NOW.toISOString()]);
    const ts = todayBudget({ ...FIXTURE, profile: { ...FIXTURE.profile, monthlyBudget: 0 } }, NOW);
    expect(sql.budget_source).toBe("suggested");
    expect(ts.hasBudget && [ts.budget, ts.left]).toEqual([sql.budget, sql.left.value]);
    await db.query("update public.profiles set income = 0");
    expect(await db.one("select public.today_budget($1)", [NOW.toISOString()])).toEqual({ has_budget: false });
    await db.query("update public.profiles set income = 48000, monthly_budget = 63000");
  });
});

describe("detect_anomalies", () => {
  test("spike, missed recurring item, duplicate", async () => {
    await db.as(U1);
    const acc = (await db.one("select public.import_state($1::jsonb)", [j(FIXTURE)])).id_map.accounts as Record<string, string>;
    // trailing three months of Health at 1,000 / month, then a big October
    const posts = [7, 8, 9].map((m, i) => ({
      id: crypto.randomUUID(), account_id: acc["a-card"], category_code: "Health", amount: -1000,
      description: `pharmacy ${i}`, occurred_at: new Date(2026, m - 1, 10, 12).toISOString(),
    }));
    posts.push({ id: crypto.randomUUID(), account_id: acc["a-card"], category_code: "Health", amount: -4000,
      description: "dentist", occurred_at: new Date(2026, 9, 13, 12).toISOString() });
    // the same coffee logged twice
    const dupA = crypto.randomUUID();
    const dupB = crypto.randomUUID();
    posts.push(
      { id: dupA, account_id: acc["a-card"], category_code: "Food & drink", amount: -185, description: "Tim Hortons", occurred_at: new Date(2026, 9, 13, 8).toISOString() },
      { id: dupB, account_id: acc["a-card"], category_code: "Food & drink", amount: -185, description: "tim hortons", occurred_at: new Date(2026, 9, 13, 9).toISOString() },
    );
    await db.one("select public.post_entries($1::jsonb)", [j(posts)]);
    // Netflix due on the 8th, never logged; Rent due on the 3rd, logged (e2)
    await db.query(
      `insert into public.recurring_items (description, category_code, amount, cadence, day_of_month, starts_on) values
       ('Netflix', 'Subscriptions', -549, 'monthly', 8, '2026-01-01'),
       ('Rent', 'Rent & bills', -18500, 'monthly', 3, '2026-01-01')`,
    );

    const out = await db.one("select public.detect_anomalies($1)", [NOW.toISOString()]);
    const kinds = out.anomalies.map((a: any) => `${a.kind}:${a.facts.category_code ?? a.facts.description ?? ""}`);
    expect(kinds).toContain("category_spike:Health");
    expect(kinds).toContain("recurring_missed:Netflix");
    expect(kinds).not.toContain("recurring_missed:Rent");
    const spike = out.anomalies.find((a: any) => a.kind === "category_spike" && a.facts.category_code === "Health");
    expect(spike.facts.current.value).toBe(4000);
    expect(spike.facts.trailing_avg.value).toBe(1000);
    const dup = out.anomalies.find((a: any) => a.kind === "likely_duplicate");
    expect([...dup.entry_ids].sort()).toEqual([dupA, dupB].sort());
    expect(out.anomalies.find((a: any) => a.kind === "recurring_missed").facts.days_late).toBe(7);
  });
});
