import { describe, expect, test } from "vitest";
import { localDay } from "../../src/lib/format";
import { reducer } from "../../src/lib/store";
import { buildDemo, EMPTY_STATE } from "../../src/lib/seed";
import { cardPayments, cardStatus, dueInMonth, dueThisMonth, dueOn, dueWithin, firstDue, payments, pays, subscriptionStatus, upcoming } from "../../src/lib/subscriptions";
import type { Account, Entry, Subscription } from "../../src/lib/types";

const netflix: Subscription = { id: "s1", name: "Netflix", amount: 549, day: 18, startsOn: "2026-11-18", accountId: "a", category: "Subscriptions" };
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const spend = (id: string, desc: string, amount: number, date: string, more: Partial<Entry> = {}): Entry => ({
  id,
  desc,
  accountId: "a",
  category: "Subscriptions",
  amount: -amount,
  date,
  ...more,
});
const day = (d: Date) => localDay(d);

describe("due dates", () => {
  test("count months from startsOn, clamping the day to each month's end", () => {
    const s = { day: 31, startsOn: "2026-10-31" };
    expect([0, 1, 2, 3, 4].map((i) => day(dueOn(s, i)))).toEqual(["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]);
    expect(day(dueOn({ day: 29, startsOn: "2028-01-29" }, 1))).toBe("2028-02-29");
  });
  test("firstDue is today or the next time the day comes round", () => {
    expect(firstDue(18, new Date(2026, 10, 14))).toBe("2026-11-18");
    expect(firstDue(14, new Date(2026, 10, 14, 23))).toBe("2026-11-14");
    expect(firstDue(2, new Date(2026, 10, 14))).toBe("2026-12-02");
    expect(firstDue(31, new Date(2026, 10, 14))).toBe("2026-11-30");
    expect(firstDue(31, new Date(2027, 1, 1))).toBe("2027-02-28");
  });
});

describe("what pays a subscription", () => {
  test("its name in the entry, either way round, ignoring case", () => {
    expect(pays(netflix, spend("e", "NETFLIX.COM", 549, at(2026, 11, 18)))).toBe(true);
    expect(pays(netflix, spend("e", "groceries", 549, at(2026, 11, 18), { raw: "netflix rcbc 549" }))).toBe(true);
    expect(pays({ ...netflix, name: "Apple One" }, spend("e", "apple", 549, at(2026, 11, 18)))).toBe(true);
    expect(pays(netflix, spend("e", "Spotify", 549, at(2026, 11, 18)))).toBe(false);
  });
  test("only within 50–150% of the amount", () => {
    expect(pays(netflix, spend("e", "Netflix", 275, at(2026, 11, 18)))).toBe(true);
    expect(pays(netflix, spend("e", "Netflix", 823, at(2026, 11, 18)))).toBe(true);
    expect(pays(netflix, spend("e", "Netflix", 270, at(2026, 11, 18)))).toBe(false);
    expect(pays(netflix, spend("e", "Netflix", 830, at(2026, 11, 18)))).toBe(false);
  });
  test("only spending: not income, refunds, moves, Review drafts or Adjustments", () => {
    const d = at(2026, 11, 18);
    expect(pays(netflix, { ...spend("e", "Netflix", 549, d), amount: 549 })).toBe(false);
    expect(pays(netflix, spend("e", "Netflix", 549, d, { refunded: true }))).toBe(false);
    expect(pays(netflix, spend("e", "Netflix", 549, d, { linkId: "l" }))).toBe(false);
    expect(pays(netflix, spend("e", "Netflix", 549, d, { status: "review" }))).toBe(false);
    expect(pays(netflix, spend("e", "Netflix", 549, d, { category: "Adjustment" }))).toBe(false);
  });
  test("up to 10 days before the first due date, not earlier", () => {
    expect(pays(netflix, spend("e", "Netflix", 549, at(2026, 11, 8, 0)))).toBe(true);
    expect(pays(netflix, spend("e", "Netflix", 549, at(2026, 11, 7, 23)))).toBe(false);
  });
  test("one entry pays one subscription: the longest matching name", () => {
    const apple: Subscription = { ...netflix, id: "s2", name: "Apple" };
    const one: Subscription = { ...netflix, id: "s3", name: "Apple One" };
    const m = payments([apple, one], [spend("e", "Apple One family", 549, at(2026, 11, 18))]);
    expect(m.get("s3")!.map((e) => e.id)).toEqual(["e"]);
    expect(m.get("s2")).toEqual([]);
  });
});

describe("next due", () => {
  const today = new Date(2026, 11, 20); // 20 Dec
  test("each payment moves it one month on; deleting one moves it back", () => {
    const paid = [spend("e1", "Netflix", 549, at(2026, 11, 18)), spend("e2", "Netflix", 549, at(2026, 12, 17))];
    expect(day(subscriptionStatus(netflix, paid, today).due)).toBe("2027-01-18");
    const one = subscriptionStatus(netflix, paid.slice(0, 1), today);
    expect(day(one.due)).toBe("2026-12-18");
    expect(one).toMatchObject({ overdue: true, daysLate: 2 });
  });
  test("due today is not overdue", () => {
    expect(subscriptionStatus(netflix, [], new Date(2026, 10, 18, 22))).toMatchObject({ overdue: false, daysLate: 0 });
  });
});

describe("credit cards", () => {
  // first due date 13 Nov: the month the reminder was set in
  const card: Account = { id: "c", name: "U Visa", provider: "unionbank", providerLabel: "UnionBank", type: "credit", kind: "CREDIT", balance: 385, dueDate: "2026-11-13" };
  const into = (id: string, d: string, amount: number): Entry => ({ id, desc: "Card payment", accountId: "c", category: "Transfer", amount, date: d, linkId: `l-${id}` });
  test("due on the earliest unpaid due date, past or not; owed is only a hint", () => {
    expect(cardStatus(card, [])).toMatchObject({ index: 0, owed: 385 });
    expect(day(cardStatus(card, [])!.due)).toBe("2026-11-13");
  });
  test("a late payment settles the month it's behind on, not the one it lands in", () => {
    const { paid, next } = cardPayments(card, [into("p1", at(2026, 11, 14), 385)]);
    expect(paid[0].map((e) => e.id)).toEqual(["p1"]);
    expect(next).toBe(1);
    expect(day(cardStatus(card, [into("p1", at(2026, 11, 14), 385)])!.due)).toBe("2026-12-13");
  });
  test("payments in parts add up on one month; an early one counts for its own", () => {
    const parts = [into("p1", at(2026, 11, 2), 200), into("p2", at(2026, 11, 10), 185)];
    const { paid, next } = cardPayments(card, parts);
    expect(paid[0].map((e) => e.id)).toEqual(["p1", "p2"]);
    expect(next).toBe(1);
  });
  test("once caught up, an extra payment in the same month stays on it, not the next", () => {
    const pays = [into("p1", at(2026, 11, 14), 300), into("p2", at(2026, 11, 20), 85), into("p3", at(2026, 12, 1), 100)];
    const { paid, next } = cardPayments(card, pays);
    expect(paid[0].map((e) => e.id)).toEqual(["p1"]);
    // p2 (20 Nov) and p3 (1 Dec) both land on or before 13 Dec
    expect(paid[1].map((e) => e.id)).toEqual(["p2", "p3"]);
    expect(next).toBe(2);
  });
  test("only moves into the card count, from the day after the month before the first due date", () => {
    expect(cardPayments(card, [{ ...into("a", at(2026, 11, 14), 385), linkId: undefined, category: "Adjustment" }]).next).toBe(0);
    expect(cardPayments(card, [into("old", at(2026, 10, 13), 385)]).next).toBe(0);
    expect(cardPayments(card, [into("ok", at(2026, 10, 14), 385)]).next).toBe(1);
  });
  test("no reminder or not a card: nothing; a reminder this month is its first due date", () => {
    expect(cardStatus({ ...card, dueDate: undefined }, [])).toBeNull();
    expect(cardStatus({ ...card, type: "bank" }, [])).toBeNull();
    expect(dueThisMonth(13, new Date(2026, 10, 14))).toBe("2026-11-13");
    expect(dueThisMonth(31, new Date(2027, 1, 3))).toBe("2027-02-28");
  });
});

describe("upcoming", () => {
  const today = new Date(2026, 10, 14);
  const card: Account = { id: "c", name: "Card", provider: "rcbc", providerLabel: "RCBC", type: "credit", kind: "CREDIT", balance: 5000, dueDate: "2026-11-25" };
  const late: Subscription = { ...netflix, id: "s0", name: "Rent", amount: 18000, day: 3, startsOn: "2026-11-03" };
  const far: Subscription = { ...netflix, id: "s9", name: "Insurance", amount: 9000, day: 20, startsOn: "2026-12-20" };
  const state = { subscriptions: [netflix, late, far], accounts: [card], entries: [] as Entry[] };
  test("overdue first, then by date; the 30-day total is subscriptions only, overdue in, later ones out", () => {
    const items = upcoming(state, today);
    expect(items.map((u) => u.id)).toEqual(["s0", "s1", "c", "s9"]);
    expect(dueWithin(items, 30, today)).toBe(18000 + 549);
  });
  test("a paid card moves on to its next due date; a card without a reminder isn't listed", () => {
    const paid = { ...spend("p", "Card payment", -2000, at(2026, 11, 1)), accountId: "c", linkId: "l" };
    expect(day(upcoming({ ...state, entries: [paid] }, today).find((u) => u.id === "c")!.due)).toBe("2026-12-25");
    const noReminder = { ...card, dueDate: undefined };
    expect(upcoming({ ...state, accounts: [noReminder] }, today).map((u) => u.id)).toEqual(["s0", "s1", "s9"]);
  });
});

describe("store", () => {
  test("add, edit, remove a subscription", () => {
    let s = reducer(EMPTY_STATE, { type: "upsert-subscription", sub: netflix });
    expect(s.subscriptions).toEqual([netflix]);
    s = reducer(s, { type: "upsert-subscription", sub: { ...netflix, amount: 649 } });
    expect(s.subscriptions).toEqual([{ ...netflix, amount: 649 }]);
    s = reducer(s, { type: "remove-subscription", id: "s1" });
    expect(s.subscriptions).toEqual([]);
  });
  test("Mark paid is an ordinary entry: it pays the month and moves the account balance", () => {
    const acct: Account = { id: "a", name: "BPI", provider: "bpi", providerLabel: "BPI", type: "bank", kind: "SAVINGS", balance: 1000 };
    let s = reducer({ ...EMPTY_STATE, accounts: [acct] }, { type: "upsert-subscription", sub: netflix });
    s = reducer(s, { type: "add-entry", entry: spend("e1", "Netflix", 549, at(2026, 11, 18)) });
    expect(s.accounts[0].balance).toBe(451);
    expect(day(upcoming(s, new Date(2026, 10, 19))[0].due)).toBe("2026-12-18");
    s = reducer(s, { type: "delete-entry", id: "e1" });
    expect(day(upcoming(s, new Date(2026, 10, 19))[0].due)).toBe("2026-11-18");
  });
  test("the demo starts every subscription unpaid at its next due date", () => {
    const today = new Date(2026, 10, 14, 9);
    const demo = buildDemo(today);
    const subs = upcoming(demo, today).filter((u) => u.kind === "subscription");
    expect(subs.length).toBe(4);
    for (const u of subs) expect(u.overdue).toBe(false);
    expect(subs.map((u) => day(u.due))).toEqual(["2026-11-15", "2026-11-18", "2026-11-22", "2026-12-02"]);
  });
});

describe("due dates on the calendar", () => {
  const today = new Date(2026, 11, 20); // 20 Dec
  const card: Account = { id: "c", name: "Card", provider: "rcbc", providerLabel: "RCBC", type: "credit", kind: "CREDIT", balance: 3000, dueDate: "2026-12-15" };
  const bank: Account = { ...card, id: "b", name: "BPI", type: "bank", dueDate: undefined };
  const nov = spend("e1", "Netflix", 549, at(2026, 11, 17), { accountId: "b" });
  const state = { subscriptions: [netflix], accounts: [card, bank], entries: [nov] };
  const keys = (m: Map<number, unknown[]>) => [...m.keys()].sort((a, b) => a - b);

  test("a paid month names its entry and the account it came from", () => {
    const it = dueInMonth(state, new Date(2026, 10, 1), today).get(18)![0];
    expect(it).toMatchObject({ kind: "subscription", status: "paid", amount: 549, paidFrom: "b", actionable: false });
    expect(it.entry!.id).toBe("e1");
  });
  test("an unpaid past month is overdue and the one Mark paid acts on; the next month is due, not actionable", () => {
    expect(dueInMonth(state, new Date(2026, 11, 1), today).get(18)!.find((i) => i.kind === "subscription")).toMatchObject({ status: "overdue", amount: 549, actionable: true });
    expect(dueInMonth(state, new Date(2027, 0, 1), today).get(18)![0]).toMatchObject({ status: "due", actionable: false });
  });
  test("nothing before the first due date; day 31 clamps in February", () => {
    expect(keys(dueInMonth(state, new Date(2026, 9, 1), today))).toEqual([]);
    const s31 = { ...state, subscriptions: [{ ...netflix, day: 31, startsOn: "2027-01-31" }], accounts: [] };
    expect(keys(dueInMonth(s31, new Date(2027, 1, 1), today))).toEqual([28]);
  });
  test("a card: every month from its first; the earliest unpaid has the owed hint and Pay; paid names the source", () => {
    // first due 15 Dec; on 20 Dec it's unpaid and still the one to pay
    const dec = dueInMonth(state, new Date(2026, 11, 1), today).get(15)!;
    expect(dec[0]).toMatchObject({ kind: "card", status: "due", amount: null, owed: 3000, actionable: true });
    expect(dueInMonth(state, new Date(2027, 0, 1), today).get(15)![0]).toMatchObject({ amount: null, actionable: false });
    expect(dueInMonth(state, new Date(2027, 0, 1), today).get(15)![0].owed).toBeUndefined();
    const legs = [
      { ...spend("t1", "Card payment", 2000, at(2026, 11, 30)), accountId: "b", category: "Transfer", linkId: "l1" },
      { ...spend("t2", "Card payment", -2000, at(2026, 11, 30)), accountId: "c", category: "Transfer", linkId: "l1" },
      { ...spend("t3", "Card payment", 500, at(2026, 12, 18)), accountId: "b", category: "Transfer", linkId: "l2" },
      { ...spend("t4", "Card payment", -500, at(2026, 12, 18)), accountId: "c", category: "Transfer", linkId: "l2" },
    ];
    const s2 = { ...state, entries: [...state.entries, ...legs] };
    const paid = dueInMonth(s2, new Date(2026, 11, 1), today).get(15)![0];
    // 30 Nov settles 15 Dec; 18 Dec lands after it, nothing is behind, so it settles 15 Jan
    expect(paid).toMatchObject({ status: "paid", amount: 2000, paidFrom: "b", actionable: false });
    expect(paid.payments!.map((e) => e.id)).toEqual(["t2"]);
    expect(dueInMonth(s2, new Date(2027, 0, 1), today).get(15)![0]).toMatchObject({ status: "paid", amount: 500, actionable: false });
    expect(dueInMonth(s2, new Date(2027, 1, 1), today).get(15)![0]).toMatchObject({ status: "due", actionable: true, owed: 3000 });
  });
  test("a date-only due date is the local day, whatever the time zone", () => {
    expect(day(cardStatus({ ...card, dueDate: "2026-12-13" }, [])!.due)).toBe("2026-12-13");
  });
  test("no reminder, no card on the calendar; nothing before its first due date", () => {
    expect(keys(dueInMonth({ ...state, accounts: [{ ...card, dueDate: undefined }] }, new Date(2026, 11, 1), today))).toEqual([18]);
    expect(keys(dueInMonth(state, new Date(2026, 10, 1), today))).toEqual([18]);
  });
});
