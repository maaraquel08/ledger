import { describe, expect, test } from "vitest";
import { localDay } from "../../src/lib/format";
import { reducer } from "../../src/lib/store";
import { buildDemo, EMPTY_STATE } from "../../src/lib/seed";
import { cardStatus, dueOn, dueWithin, firstDue, payments, pays, subscriptionStatus, upcoming } from "../../src/lib/subscriptions";
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
  const card: Account = { id: "c", name: "The card", provider: "rcbc", providerLabel: "RCBC", type: "credit", kind: "CREDIT", balance: 18240, dueDate: new Date(2026, 9, 15).toISOString() };
  const today = new Date(2026, 10, 14);
  test("due the next time the day comes round, unpaid until money goes in after the last due date", () => {
    expect(cardStatus(card, [], today)).toMatchObject({ paid: false });
    expect(day(cardStatus(card, [], today)!.due)).toBe("2026-11-15");
    const before = { ...spend("p", "Card payment", -5000, at(2026, 10, 15)), accountId: "c", linkId: "l" };
    expect(cardStatus(card, [before], today)!.paid).toBe(false);
    const after = { ...spend("p", "Card payment", -5000, at(2026, 10, 16)), accountId: "c", linkId: "l" };
    expect(cardStatus(card, [after], today)!.paid).toBe(true);
    expect(cardStatus(card, [{ ...after, linkId: undefined, category: "Adjustment" }], today)!.paid).toBe(false);
  });
  test("a due date still ahead is used as set, a month out included", () => {
    const later = { ...card, dueDate: new Date(2026, 11, 15).toISOString() };
    expect(day(cardStatus(later, [], today)!.due)).toBe("2026-12-15");
    const paidOct = { ...spend("p", "Card payment", -5000, at(2026, 10, 28)), accountId: "c", linkId: "l" };
    expect(cardStatus(later, [paidOct], today)!.paid).toBe(false);
  });
  test("a reminder is the due date: none, no item; nothing owed still reminds, owed is only a hint", () => {
    expect(cardStatus({ ...card, dueDate: undefined }, [], today)).toBeNull();
    expect(cardStatus({ ...card, balance: 0 }, [], today)).toMatchObject({ owed: 0, paid: false });
    expect(cardStatus(card, [], today)!.owed).toBe(18240);
    expect(cardStatus({ ...card, type: "bank" }, [], today)).toBeNull();
  });
});

describe("upcoming", () => {
  const today = new Date(2026, 10, 14);
  const card: Account = { id: "c", name: "Card", provider: "rcbc", providerLabel: "RCBC", type: "credit", kind: "CREDIT", balance: 5000, dueDate: new Date(2026, 10, 25).toISOString() };
  const late: Subscription = { ...netflix, id: "s0", name: "Rent", amount: 18000, day: 3, startsOn: "2026-11-03" };
  const far: Subscription = { ...netflix, id: "s9", name: "Insurance", amount: 9000, day: 20, startsOn: "2026-12-20" };
  const state = { subscriptions: [netflix, late, far], accounts: [card], entries: [] as Entry[] };
  test("overdue first, then by date; the 30-day total is subscriptions only, overdue in, later ones out", () => {
    const items = upcoming(state, today);
    expect(items.map((u) => u.id)).toEqual(["s0", "s1", "c", "s9"]);
    expect(dueWithin(items, 30, today)).toBe(18000 + 549);
  });
  test("a paid card goes last; a card without a reminder isn't listed", () => {
    const paid = { ...spend("p", "Card payment", -2000, at(2026, 11, 1)), accountId: "c", linkId: "l" };
    expect(upcoming({ ...state, entries: [paid] }, today).at(-1)!.id).toBe("c");
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
