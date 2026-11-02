import { describe, expect, test } from "vitest";
import { moveLegs, overdraws } from "../../src/lib/entry-rules";
import { EMPTY_STATE } from "../../src/lib/seed";
import { reducer } from "../../src/lib/store";
import type { Account, LedgerState } from "../../src/lib/types";

const acct = (id: string, type: Account["type"], balance: number): Account =>
  ({ id, name: id, provider: "other", providerLabel: id, type, kind: "X", balance }) as Account;
const base: LedgerState = {
  ...EMPTY_STATE,
  onboarded: true,
  accounts: [acct("bpi", "bank", 50_000), acct("ibkr", "investments", 8_000), acct("gcash", "ewallet", 4_000), acct("cash", "cash", 500)],
};
let n = 0;
const newId = (p: string) => `${p}${++n}`;
const date = new Date(2026, 9, 6, 12).toISOString();
const balances = (s: LedgerState) => Object.fromEntries(s.accounts.map((a) => [a.id, a.balance]));

describe("moveLegs: transfer and invest share one builder", () => {
  test("bank to wallet is a Transfer, two linked legs that sum to zero", () => {
    const legs = moveLegs({ from: base.accounts[0], to: base.accounts[2], amount: 1_000, date, newId });
    expect(legs.map((l) => l.category)).toEqual(["Transfer", "Transfer"]);
    expect(legs[0].linkId).toBeTruthy();
    expect(legs[0].linkId).toBe(legs[1].linkId);
    expect(legs[0].amount + legs[1].amount).toBe(0);
    expect(legs.map((l) => l.accountId)).toEqual(["bpi", "gcash"]);
  });

  test("into an investments account files as Investments, and the balances follow (D-0010)", () => {
    const legs = moveLegs({ from: base.accounts[0], to: base.accounts[1], amount: 5_000, date, newId });
    expect(legs.map((l) => l.category)).toEqual(["Investments", "Investments"]);
    const s = reducer(base, { type: "add-entries", entries: legs });
    expect(balances(s)).toMatchObject({ bpi: 45_000, ibkr: 13_000 });
  });

  test("an investments account can be the source (a withdrawal is a Transfer)", () => {
    const legs = moveLegs({ from: base.accounts[1], to: base.accounts[0], amount: 2_000, date, newId });
    expect(legs[0].category).toBe("Transfer");
    expect(balances(reducer(base, { type: "add-entries", entries: legs }))).toMatchObject({ ibkr: 6_000, bpi: 52_000 });
  });

  test("overdraws guards cash, bank, wallet and investments, but not a card", () => {
    expect(overdraws(base.accounts[3], 501)).toBe(true);
    expect(overdraws(base.accounts[3], 500)).toBe(false);
    expect(overdraws(base.accounts[1], 8_001)).toBe(true);
    expect(overdraws(acct("card", "credit", 0), 9_999)).toBe(false);
  });

  test("deleting one leg removes both and restores the balances", () => {
    const legs = moveLegs({ from: base.accounts[0], to: base.accounts[2], amount: 1_000, date, newId });
    const moved = reducer(base, { type: "add-entries", entries: legs });
    const back = reducer(moved, { type: "delete-entry", id: legs[1].id });
    expect(back.entries).toHaveLength(0);
    expect(balances(back)).toEqual(balances(base));
  });
});

describe("removing an account that has move legs", () => {
  const legs = moveLegs({ from: base.accounts[0], to: base.accounts[2], amount: 1_000, date, newId });
  const lunch = { id: "lunch", desc: "Lunch", accountId: "gcash", category: "Food & drink" as const, amount: -200, date };
  const withMove = reducer(reducer(base, { type: "add-entries", entries: legs }), { type: "add-entry", entry: lunch });

  test("its legs go; the twin stays as a plain entry with no link", () => {
    const s = reducer(withMove, { type: "remove-account", id: "bpi" });
    expect(s.accounts.map((a) => a.id)).not.toContain("bpi");
    const twin = s.entries.find((e) => e.id === legs[1].id);
    expect(twin).toBeDefined();
    expect(twin?.linkId).toBeUndefined();
    expect(twin?.accountId).toBe("gcash");
    expect(s.entries.some((e) => e.id === legs[0].id)).toBe(false);
  });

  test("the surviving account's balance is unchanged (the money did arrive there)", () => {
    const s = reducer(withMove, { type: "remove-account", id: "bpi" });
    expect(balances(s).gcash).toBe(balances(withMove).gcash);
  });

  test("the twin can then be deleted alone without touching anything else", () => {
    const s = reducer(reducer(withMove, { type: "remove-account", id: "bpi" }), { type: "delete-entry", id: legs[1].id });
    expect(s.entries.map((e) => e.id)).toEqual(["lunch"]);
    expect(balances(s).gcash).toBe(4_000 - 200);
  });

  test("plain entries of the removed account still fall into Review", () => {
    const plain = { id: "p", desc: "Rent", accountId: "bpi", category: "Rent & bills" as const, amount: -900, date };
    const s = reducer(reducer(base, { type: "add-entry", entry: plain }), { type: "remove-account", id: "bpi" });
    expect(s.entries[0].accountId).toBeNull();
  });
});
