import * as React from "react";
import { canRefund } from "./entry-rules";
import { localDay } from "./format";
import { localStoragePhotoStore, localStorageRepository, type LedgerRepository } from "./persistence";
import { buildDemo, EMPTY_STATE } from "./seed";
import { cloud } from "./supabase";
import type { Account, Entry, LedgerState, Profile } from "./types";

export type Action =
  | { type: "load-demo" }
  | { type: "reset" }
  | { type: "complete-onboarding"; accounts: Account[]; profile: Partial<Profile> }
  | { type: "add-entry"; entry: Entry }
  /** several entries that belong together (both legs of a transfer); all or nothing */
  | { type: "add-entries"; entries: Entry[] }
  | { type: "update-entry"; id: string; patch: Partial<Entry> }
  | { type: "delete-entry"; id: string }
  | { type: "flush-queue" }
  | { type: "upsert-account"; account: Account }
  | { type: "remove-account"; id: string }
  | { type: "update-profile"; patch: Partial<Profile> }
  | { type: "ask" }
  /* cloud mode only (D-0012, D-0014): local mode never dispatches these */
  /** replace the whole state with what the server returned (plus unsent changes) */
  | { type: "hydrate"; state: LedgerState }
  /** the server acknowledged these entries: take its version; ids gone from the server drop out */
  | { type: "ack"; entries: Entry[]; removed?: string[] }
  /** derived balances from the account_balances view: server wins */
  | { type: "balances"; balances: Record<string, number> }
  /** a reported balance is a snapshot; it never changes the balance */
  | { type: "report-balance"; id: string; accountId: string; reported: number }
  /** close the latest snapshot's gap with one Adjustment entry (arrives with the ack) */
  | { type: "record-adjustment"; id: string; accountId: string }
  /** something said or typed offline that the phone couldn't read: the capture function files it later */
  | { type: "queue-capture"; id: string; text: string };

/**
 * Local mode's D-0014: the signed entry amount that brings an account's derived
 * balance to what the Owner reported. Credit balances are amounts owed, so the
 * sign flips (owing ₱800 less is +₱800 into the card). 0 when they already match.
 */
export function adjustmentAmount(account: Pick<Account, "balance" | "type">, reported: number) {
  const gap = Math.round(reported) - Math.round(account.balance);
  return account.type === "credit" ? 0 - gap : gap;
}

/** What an entry does to its account: nothing once refunded. */
const effect = (e: Pick<Entry, "amount" | "refunded">) => (e.refunded ? 0 : e.amount);

function applyBalance(accounts: Account[], accountId: string | null, delta: number) {
  if (!accountId || !delta) return accounts;
  return accounts.map((a) =>
    a.id !== accountId ? a : { ...a, balance: a.type === "credit" ? a.balance - delta : a.balance + delta },
  );
}

const sortEntries = (entries: Entry[]) => [...entries].sort((x, y) => y.date.localeCompare(x.date));

function addEntries(s: LedgerState, entries: Entry[]): LedgerState {
  let accounts = s.accounts;
  for (const e of entries) accounts = applyBalance(accounts, e.accountId, effect(e));
  return { ...s, entries: sortEntries([...entries, ...s.entries]), accounts };
}

export function reducer(s: LedgerState, a: Action): LedgerState {
  switch (a.type) {
    case "load-demo":
      return buildDemo();
    case "reset":
      return EMPTY_STATE;
    case "complete-onboarding":
      // finishing setup twice (browser back into /onboarding) must not replace a live ledger
      if (s.onboarded) return s;
      return { ...s, onboarded: true, demo: false, accounts: a.accounts, profile: { ...s.profile, ...a.profile } };
    case "add-entry":
      return addEntries(s, [a.entry]);
    case "add-entries":
      return addEntries(s, a.entries);
    case "update-entry": {
      const prev = s.entries.find((e) => e.id === a.id);
      if (!prev) return s;
      const next = { ...prev, ...a.patch };
      // only a plain expense can be refunded (QA A): a move leg or Adjustment would make money from nothing
      if (next.refunded && !prev.refunded && !canRefund(next)) return s;
      // a move's two legs sit in different accounts (QA B)
      if (next.linkId != null && next.accountId != null && a.patch.accountId !== undefined) {
        const twin = s.entries.find((e) => e.id !== prev.id && e.linkId === next.linkId);
        if (twin?.accountId === next.accountId) return s;
      }
      let accounts = applyBalance(s.accounts, prev.accountId, -effect(prev));
      accounts = applyBalance(accounts, next.accountId, effect(next));
      return { ...s, accounts, entries: s.entries.map((e) => (e.id === a.id ? next : e)) };
    }
    case "delete-entry": {
      const prev = s.entries.find((e) => e.id === a.id);
      if (!prev) return s;
      // a transfer is two legs; removing one alone would unbalance both accounts
      const gone = s.entries.filter((e) => e.id === a.id || (prev.linkId != null && e.linkId === prev.linkId));
      let accounts = s.accounts;
      for (const e of gone) accounts = applyBalance(accounts, e.accountId, -effect(e));
      const ids = new Set(gone.map((e) => e.id));
      return { ...s, accounts, entries: s.entries.filter((e) => !ids.has(e.id)) };
    }
    case "flush-queue":
      return { ...s, entries: s.entries.map((e) => (e.queued ? { ...e, queued: false } : e)) };
    case "upsert-account": {
      const exists = s.accounts.some((x) => x.id === a.account.id);
      return {
        ...s,
        accounts: exists ? s.accounts.map((x) => (x.id === a.account.id ? a.account : x)) : [...s.accounts, a.account],
      };
    }
    case "remove-account":
      return {
        ...s,
        accounts: s.accounts.filter((x) => x.id !== a.id),
        // orphaned entries fall into the review queue rather than pointing nowhere
        entries: s.entries.map((e) => (e.accountId === a.id ? { ...e, accountId: null } : e)),
      };
    case "update-profile":
      return { ...s, profile: { ...s.profile, ...a.patch } };
    case "ask": {
      const day = localDay();
      const n = s.questionsDate === day ? s.questionsToday + 1 : 1;
      return { ...s, questionsToday: n, questionsDate: day };
    }
    case "hydrate":
      return a.state;
    case "ack": {
      const byId = new Map(a.entries.map((e) => [e.id, e]));
      const gone = new Set(a.removed ?? []);
      const kept = s.entries
        .filter((e) => !gone.has(e.id))
        .map((e) => {
          const next = byId.get(e.id);
          if (!next) return e;
          byId.delete(e.id);
          // the photo taken on this phone stays for this session; the server keeps its path
          const image = e.receipt?.image;
          return { ...next, ...(image && next.receipt ? { receipt: { ...next.receipt, image } } : {}) };
        });
      return { ...s, entries: sortEntries([...byId.values(), ...kept]) };
    }
    case "balances":
      return { ...s, accounts: s.accounts.map((x) => (a.balances[x.id] == null ? x : { ...x, balance: a.balances[x.id] })) };
    case "report-balance":
    case "record-adjustment":
    case "queue-capture":
      return s;
  }
}

/** Local mode's repository. Cloud mode (src/lib/cloud/provider.tsx) syncs through an outbox instead. */
export const repository: LedgerRepository = localStorageRepository(localStoragePhotoStore());

export interface LedgerCtx {
  state: LedgerState;
  dispatch: React.Dispatch<Action>;
  /** the last save failed (storage full or unavailable); state is only in memory */
  persistError: boolean;
}
export const Ctx = React.createContext<LedgerCtx | null>(null);

export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, () => repository.load() ?? EMPTY_STATE);
  const [persistError, setPersistError] = React.useState(false);
  React.useEffect(() => {
    setPersistError(!repository.save(state));
  }, [state]);
  const value = React.useMemo(() => ({ state, dispatch, persistError }), [state, persistError]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedger() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useLedger outside LedgerProvider");
  return v;
}

/** Cloud ids are uuids made here, so a retried write is idempotent (CONTRACT.md "Ids"). */
export const newId = (p: string) =>
  cloud ? crypto.randomUUID() : `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** navigator.onLine, live. */
export function useOnline() {
  const [online, setOnline] = React.useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  React.useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
