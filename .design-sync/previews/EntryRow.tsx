import * as React from "react";
import { EntryRow } from "ledger";
import type { Account, Entry } from "ledger";

const gcash: Account = { id: "a-gcash", name: "Daily wallet", provider: "gcash", providerLabel: "GCash", type: "ewallet", kind: "WALLET", last4: "8871", balance: 18900 };
const cash: Account = { id: "a-cash", name: "Pocket cash", provider: "cash", providerLabel: "Cash", type: "cash", kind: "PHYSICAL", balance: 5000 };
const bpi: Account = { id: "a-bpi", name: "Payroll account", provider: "bpi", providerLabel: "BPI", type: "bank", kind: "SAVINGS", last4: "2841", balance: 128400 };

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const grab: Entry = { id: "e1", desc: "Grab", accountId: gcash.id, category: "Transport", amount: -248, date: at(8, 42), raw: "grab gcash 248" };
const payroll: Entry = { id: "e2", desc: "Payroll · Acme Inc.", accountId: bpi.id, category: "Salary", amount: 48000, date: at(6, 0) };
const lunch: Entry = { id: "e3", desc: "lunch w/ team", accountId: cash.id, category: null, amount: -780, date: at(12, 30), raw: "lunch w/ team 780 cash" };
const meralco: Entry = { id: "e4", desc: "Meralco", accountId: bpi.id, category: "Rent & bills", amount: -2840, date: at(9, 0), auto: true };
const coffee: Entry = { id: "e5", desc: "Starbucks", accountId: gcash.id, category: "Food & drink", amount: -290, date: at(8, 14), queued: true };
const refunded: Entry = { id: "e6", desc: "Uniqlo", accountId: gcash.id, category: "Shopping", amount: -1290, date: at(17, 5), refunded: true };

const list: React.CSSProperties = { width: 382, padding: "8px 24px", display: "grid", gap: 18 };

/** A spend entry as logged from one line of text. */
export const Spend = () => (
  <div style={list}>
    <EntryRow entry={grab} account={gcash} onClick={() => {}} />
  </div>
);

/** Money in reads green. */
export const Income = () => (
  <div style={list}>
    <EntryRow entry={payroll} account={bpi} onClick={() => {}} />
  </div>
);

/** Missing fields are chips, never blockers: “Needs category”, “On phone”. */
export const NeedsAttention = () => (
  <div style={list}>
    <EntryRow entry={lunch} account={cash} onClick={() => {}} />
    <EntryRow entry={coffee} account={gcash} onClick={() => {}} />
  </div>
);

/** A day on Activity: auto-debit tag, a refunded entry struck through. */
export const DayList = () => (
  <div style={list}>
    <EntryRow entry={meralco} account={bpi} onClick={() => {}} />
    <EntryRow entry={grab} account={gcash} onClick={() => {}} />
    <EntryRow entry={refunded} account={gcash} onClick={() => {}} />
  </div>
);
