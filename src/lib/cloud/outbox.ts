import { parseSpoken, splitEntries } from "../parse";
import type { Action } from "../store";
import type { Account, Entry, Goal, LedgerState } from "../types";
import { accountPayload, entryPatch, entryPayload, goalPayload, profilePayload } from "./map";

/*
 * The outbox: every change the Owner makes in cloud mode becomes a command saved on this phone
 * before anything is sent. It drains in order to the matching RPC; ids are client uuids, so a
 * command that is sent twice (response lost, app closed mid-request) is a replay, not a copy.
 */

type Row = Record<string, unknown>;

export type Call =
  | { kind: "rpc"; fn: string; args: Row }
  | { kind: "upsert"; table: string; rows: Row | Row[]; onConflict: string }
  | { kind: "update"; table: string; values: Row; id: string }
  /** a raw capture saved while offline: the capture function files it when we're back */
  | { kind: "capture"; body: Row };

export interface Command {
  id: string;
  at: number;
  /** what the Owner did; replayed over fresh server state until acknowledged */
  action: Action;
  calls: Call[];
  /** calls already acknowledged (a command can be several calls) */
  done: number;
  tries: number;
  /** don't send before `until` (ms epoch): a backoff, or the capture daily limit (next day) */
  wait?: { until: number; why: "backoff" | "daily_limit" };
  /**
   * a capture the server can never file and the phone couldn't read: it waits in Review as
   * this draft until the Owner fills in the amount (then it is posted as an ordinary entry)
   */
  parked?: { reason: string; entry: Entry };
}

/** a voice note waiting for the capture function (it never holds up the commands after it) */
export const isCapture = (c: Command) => c.action.type === "queue-capture";

/** retry delay after `tries` failures: 2 s, 4 s … capped at a minute */
export const backoff = (tries: number) => Math.min(60_000, 1000 * 2 ** Math.min(tries, 6));

/** the capture daily limit resets with the day: try again just after local midnight */
export function nextDay(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 30, 0);
  return d.getTime();
}

/**
 * A queued capture the server won't file (no AI configured, or refused): read it on the phone.
 * Every amount found becomes an entry; with `question` (the server refused it) they all go to
 * Review. Returns null when the phone can't find an amount either: then the capture is parked.
 */
export function readLocally(c: Command, accounts: Account[], question?: string): Entry[] | null {
  if (c.action.type !== "queue-capture") return null;
  const text = c.action.text;
  const items = splitEntries(text)
    .map((s) => parseSpoken(s, accounts))
    .filter((p) => p.amount != null && p.amount !== 0);
  if (!items.length) return null;
  return items.map((p, i) => {
    const review = !!question || p.category == null || p.accountId == null;
    return {
      id: crypto.randomUUID(),
      desc: p.desc || text,
      accountId: p.accountId,
      category: p.category,
      amount: p.amount as number,
      date: new Date(c.at + i).toISOString(),
      raw: text,
      source: "voice",
      status: review ? "review" : "posted",
      ...(question ? { reviewQuestion: question } : {}),
    } satisfies Entry;
  });
}

/** The Review draft for a capture nobody could read: the words (or the photo) kept, the amount to fill in. */
export function parkedEntry(c: Command, reason: string, from: { kind?: "voice" | "photo"; storagePath?: string } = {}): Entry {
  const text = c.action.type === "queue-capture" ? c.action.text : "";
  const photo = from.kind === "photo";
  return {
    id: c.id,
    desc: text || (photo ? "Receipt photo" : "Voice note"),
    accountId: null,
    category: null,
    amount: 0,
    date: new Date(c.at).toISOString(),
    raw: text,
    source: photo ? "receipt" : "voice",
    status: "review",
    reviewQuestion: reason,
    queued: true,
    ...(photo && from.storagePath ? { receipt: { items: [], path: from.storagePath } } : {}),
  };
}

/**
 * A capture the server answered with a question and no entries ("review", nothing filed): parked
 * as a Review draft that keeps the words or the photo's Storage path and the question. Filling in
 * the amount posts it; discarding it drops the draft (and the photo). It is never sent.
 */
export function parkCapture(p: { id: string; at: number; kind: "voice" | "photo"; text?: string; storagePath?: string; question: string }): Command {
  const c: Command = { id: p.id, at: p.at, action: { type: "queue-capture", id: p.id, text: p.text ?? "" }, calls: [], done: 0, tries: 0 };
  return { ...c, parked: { reason: "review_without_entries", entry: parkedEntry(c, p.question, p) } };
}

/** Entry ids a command will write: they stay "Saved on this phone" until it is acknowledged. */
export function touchedEntries(c: Command): string[] {
  const a = c.action;
  if (a.type === "add-entry") return [a.entry.id];
  if (a.type === "add-entries") return a.entries.map((e) => e.id);
  if (a.type === "update-entry" || a.type === "delete-entry") return [a.id];
  return [];
}

const now = () => new Date().toISOString();

/** The cloud write(s) for one action, read against the state *before* it. null = nothing to send. */
export function callsFor(a: Action, prev: LedgerState): Call[] | null {
  switch (a.type) {
    case "add-entry":
      return [{ kind: "rpc", fn: "post_entries", args: { p_entries: [entryPayload(a.entry)] } }];
    case "add-entries":
      return [{ kind: "rpc", fn: "post_entries", args: { p_entries: a.entries.map(entryPayload) } }];
    case "update-entry": {
      const calls: Call[] = [];
      const { refunded, ...rest } = a.patch;
      const before = prev.entries.find((e) => e.id === a.id);
      const patch = entryPatch(rest);
      if (Object.keys(patch).length) calls.push({ kind: "rpc", fn: "update_entry", args: { p_id: a.id, p_patch: patch } });
      if ("refunded" in a.patch && !!refunded !== !!before?.refunded)
        calls.push({ kind: "rpc", fn: "mark_refunded", args: { p_id: a.id, p_refunded: !!refunded } });
      return calls.length ? calls : null;
    }
    case "delete-entry":
      // entries are never deleted by the app: void, and the other leg of a move follows
      return [{ kind: "rpc", fn: "void_entry", args: { p_id: a.id } }];
    case "upsert-account": {
      const exists = prev.accounts.some((x) => x.id === a.account.id);
      return [{ kind: "rpc", fn: "upsert_account", args: { p_account: accountPayload(a.account, exists ? undefined : a.account.balance) } }];
    }
    case "remove-account":
      return [{ kind: "rpc", fn: "upsert_account", args: { p_account: { id: a.id, archived_at: now() } } }];
    case "complete-onboarding": {
      if (prev.onboarded) return null;
      const calls: Call[] = a.accounts.map((acc) => ({ kind: "rpc", fn: "upsert_account", args: { p_account: accountPayload(acc, acc.balance) } }));
      const { goals, holdings: _h, ...rest } = a.profile;
      calls.push({ kind: "upsert", table: "profiles", rows: { ...profilePayload(rest), onboarded: true }, onConflict: "user_id" });
      if (goals?.length) calls.push({ kind: "upsert", table: "goals", rows: goals.map(goalPayload), onConflict: "id" });
      return calls;
    }
    case "update-profile": {
      const calls: Call[] = [];
      const { goals, holdings: _h, ...rest } = a.patch;
      const row = profilePayload(rest);
      if (Object.keys(row).length) calls.push({ kind: "upsert", table: "profiles", rows: row, onConflict: "user_id" });
      if (goals) calls.push(...goalCalls(prev.profile.goals, goals));
      return calls.length ? calls : null;
    }
    case "report-balance":
      return [{ kind: "rpc", fn: "report_balance", args: { p_account_id: a.accountId, p_reported: a.reported, p_id: a.id } }];
    case "record-adjustment":
      return [{ kind: "rpc", fn: "record_adjustment", args: { p_account_id: a.accountId, p_id: a.id } }];
    case "queue-capture":
      return [{ kind: "capture", body: { client_id: a.id, kind: "text", text: a.text, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }];
    default:
      return null;
  }
}

function goalCalls(before: Goal[], after: Goal[]): Call[] {
  const calls: Call[] = [];
  const changed = after.filter((g) => {
    const b = before.find((x) => x.id === g.id);
    return !b || b.name !== g.name || b.saved !== g.saved || b.target !== g.target || b.by !== g.by;
  });
  if (changed.length) calls.push({ kind: "upsert", table: "goals", rows: changed.map(goalPayload), onConflict: "id" });
  for (const g of before) if (!after.some((x) => x.id === g.id)) calls.push({ kind: "update", table: "goals", values: { archived_at: now() }, id: g.id });
  return calls;
}

/**
 * What the Owner sees while a command is unsent: the action replayed over the server's state.
 * Adding an entry the server already has is skipped (the ack was lost, the write wasn't).
 */
export function overlay(state: LedgerState, commands: Command[], reduce: (s: LedgerState, a: Action) => LedgerState): LedgerState {
  let s = state;
  for (const c of commands) {
    let a = c.action;
    const has = (e: Entry) => s.entries.some((x) => x.id === e.id);
    if (a.type === "add-entry") {
      if (has(a.entry)) continue;
      a = { ...a, entry: { ...a.entry, queued: true } };
    } else if (a.type === "add-entries") {
      const fresh = a.entries.filter((e) => !has(e));
      if (!fresh.length) continue;
      a = { ...a, entries: fresh.map((e) => ({ ...e, queued: true })) };
    } else if (a.type === "update-entry") {
      a = { ...a, patch: { ...a.patch, queued: true } };
    } else if (a.type === "complete-onboarding" && s.onboarded) continue;
    else if (a.type === "queue-capture") {
      // a parked capture shows in Review; one still on its way shows nothing yet
      if (!c.parked || has(c.parked.entry)) continue;
      a = { type: "add-entry", entry: c.parked.entry };
    }
    s = reduce(s, a);
  }
  return s;
}


const read = (raw: string | null): Command[] => {
  const v = raw ? (JSON.parse(raw) as unknown) : [];
  return Array.isArray(v) ? (v as Command[]) : [];
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * A persistent FIFO per Owner, in localStorage (small JSON; photos are never queued).
 * Several tabs share it: every change re-reads storage and applies itself by command id, so a
 * command another tab added or acknowledged is never lost or resurrected, and draining runs
 * under one Web Lock so only one tab sends at a time.
 */
export class Outbox {
  private key: string;
  private items: Command[] = [];
  /** storage failed (full or blocked): the queue lives in memory for this session */
  private memoryOnly = false;
  private listeners = new Set<(external: boolean) => void>();
  private store: Storage | null;

  constructor(uid: string, store: Storage | null = storage()) {
    this.key = `ledger:outbox:${uid}`;
    this.store = store;
    this.refresh();
  }

  /** take what's in storage now (another tab may have changed it) */
  private refresh() {
    if (this.memoryOnly || !this.store) return this.items;
    try {
      this.items = read(this.store.getItem(this.key));
    } catch {
      /* unreadable: keep what we have */
    }
    return this.items;
  }

  private change(f: (items: Command[]) => Command[]) {
    this.items = f(this.refresh());
    if (this.store && !this.memoryOnly) {
      try {
        if (this.items.length) this.store.setItem(this.key, JSON.stringify(this.items));
        else this.store.removeItem(this.key);
      } catch {
        this.memoryOnly = true; // kept in memory; it still drains this session
      }
    }
    this.listeners.forEach((f) => f(false));
  }

  /** `f` runs after every change: `external` when another tab made it (a `storage` event) */
  subscribe(f: (external: boolean) => void) {
    this.listeners.add(f);
    const other = (e: StorageEvent) => {
      if (e.key !== this.key && e.key !== null) return;
      this.refresh();
      f(true);
    };
    if (typeof window !== "undefined") window.addEventListener("storage", other);
    return () => {
      this.listeners.delete(f);
      if (typeof window !== "undefined") window.removeEventListener("storage", other);
    };
  }

  get all(): readonly Command[] {
    return this.refresh();
  }
  get size() {
    return this.refresh().length;
  }
  get(id: string): Command | undefined {
    return this.refresh().find((c) => c.id === id);
  }

  /**
   * The command to send now, in order. Parked captures are skipped, and so is a capture that
   * is waiting (nothing after it depends on it); any other waiting command holds the queue.
   */
  next(now = Date.now()): Command | undefined {
    for (const c of this.refresh()) {
      if (c.parked) continue;
      if (c.wait && c.wait.until > now) {
        if (isCapture(c)) continue;
        return undefined;
      }
      return c;
    }
    return undefined;
  }

  /** when the earliest waiting command is due (null: nothing waits) */
  nextWake(): number | null {
    const due = this.refresh()
      .filter((c) => !c.parked && c.wait)
      .map((c) => c.wait!.until);
    return due.length ? Math.min(...due) : null;
  }

  /** back online or reopened: backoffs end now (the daily limit still waits for its day) */
  wake() {
    if (!this.refresh().some((c) => c.wait?.why === "backoff")) return;
    this.change((items) => items.map((c) => (c.wait?.why === "backoff" ? { ...c, wait: undefined } : c)));
  }

  /** commands that change balances and haven't landed (parked and waiting captures don't) */
  get unsent() {
    return this.refresh().filter((c) => !c.parked && !isCapture(c)).length;
  }

  push(c: Command) {
    this.change((items) => (items.some((x) => x.id === c.id) ? items : [...items, c]));
  }
  /** progress or a new plan for one command; a no-op if another tab already finished it */
  update(id: string, patch: Partial<Omit<Command, "id">>) {
    this.change((items) => items.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  remove(id: string) {
    this.change((items) => items.filter((c) => c.id !== id));
  }
  clear() {
    this.change(() => []);
  }
  /** ids of entries some unsent command still writes */
  pendingEntryIds(): Set<string> {
    return new Set(this.refresh().flatMap(touchedEntries));
  }

  /**
   * Run `f` while holding the outbox lock (Web Locks): one tab drains, the others wait their
   * turn. Without Web Locks it runs straight away; client ids make a double send a replay.
   */
  exclusive<T>(f: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks?.request) return f();
    return locks.request("ledger-outbox", () => f()) as Promise<T>;
  }
}
