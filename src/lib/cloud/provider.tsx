import * as React from "react";
import { EMPTY_STATE } from "../seed";
import { Ctx, reducer, type Action } from "../store";
import { sb } from "../supabase";
import type { Entry, LedgerState } from "../types";
import { chatKey, clearChatHistory } from "../chat-history";
import { CloudError, eraseAccountData, loadBalances, loadState, removeObject, retryAt, runCall } from "./api";
import { callsFor, isCapture, overlay, Outbox, parkCapture, parkedEntry, readLocally, type Command } from "./outbox";

/*
 * Cloud mode's LedgerProvider (D-0012). Screens keep using useLedger(): the reducer still
 * updates the screen at once, and every change is also written to the outbox on this phone,
 * then sent to its RPC. An entry is "Saved on this phone" (queued) until the server
 * acknowledges it; then the server's row replaces it and balances come from the
 * account_balances view (server wins).
 */

export interface CloudInfo {
  uid: string;
  email: string;
  /** loading: first load with nothing cached; error: that load failed */
  status: "loading" | "ready" | "error";
  loadError: string | null;
  /** commands not yet acknowledged */
  pending: number;
  syncing: boolean;
  /** a change the server refused (it was rolled back by a reload) */
  syncError: string | null;
  dismissSyncError: () => void;
  /** bumps after every acknowledged command: screens that read other views refetch on it */
  tick: number;
  reload: () => Promise<void>;
  /** entries the capture function or undo_event already wrote */
  applyServer: (r: { entries: Entry[]; removed: string[] }) => void;
  /** a capture the server asked about without filing anything: keep it in Review (parkCapture) */
  park: (p: Parameters<typeof parkCapture>[0] & { image?: string }) => void;
  signOut: () => Promise<void>;
  eraseAll: () => Promise<void>;
}

const CloudCtx = React.createContext<CloudInfo | null>(null);
/** null in local mode */
export const useCloud = () => React.useContext(CloudCtx);

const cacheKey = (uid: string) => `ledger:cloud:${uid}`;

function readCache(uid: string): LedgerState | null {
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    return raw ? ({ ...EMPTY_STATE, ...JSON.parse(raw) } as LedgerState) : null;
  } catch {
    return null;
  }
}

function writeCache(uid: string, s: LedgerState) {
  try {
    const slim = { ...s, entries: s.entries.map((e) => (e.receipt?.image ? { ...e, receipt: { ...e.receipt, image: undefined } } : e)) };
    localStorage.setItem(cacheKey(uid), JSON.stringify(slim));
    return true;
  } catch {
    return false;
  }
}

function clearCache(uid: string) {
  try {
    localStorage.removeItem(cacheKey(uid));
  } catch {
    /* nothing cached */
  }
}

const WHAT: Partial<Record<Action["type"], string>> = {
  "add-entry": "a new entry",
  "add-entries": "new entries",
  "update-entry": "an edit",
  "delete-entry": "a delete",
  "upsert-account": "an account change",
  "remove-account": "removing an account",
  "complete-onboarding": "your setup",
  "update-profile": "a budget or goal change",
  "report-balance": "a reported balance",
  "record-adjustment": "an adjustment",
  "queue-capture": "a voice note to file",
};

export function CloudLedgerProvider({ uid, email, children }: { uid: string; email: string; children: React.ReactNode }) {
  const outbox = React.useMemo(() => new Outbox(uid), [uid]);
  const [cached] = React.useState(() => readCache(uid));
  const [state, base] = React.useReducer(reducer, undefined, () => cached ?? EMPTY_STATE);
  const stateRef = React.useRef(state);
  const [status, setStatus] = React.useState<CloudInfo["status"]>(cached ? "ready" : "loading");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(outbox.size);
  const [syncing, setSyncing] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const [persistError, setPersistError] = React.useState(false);


  /** reducer + ref in step, so several dispatches in one tick each see the one before */
  const apply = React.useCallback((a: Action) => {
    stateRef.current = reducer(stateRef.current, a);
    base(a);
  }, []);

  const acks = React.useRef(0);
  const ackServer = React.useCallback(
    (r: { entries: Entry[]; removed: string[] }) => {
      // an entry a later unsent command still changes keeps its local version until that one lands
      const busy = outbox.pendingEntryIds();
      const entries = r.entries.filter((e) => !busy.has(e.id));
      const removed = r.removed.filter((id) => !busy.has(id));
      if (entries.length || removed.length) apply({ type: "ack", entries, removed });
    },
    [apply, outbox],
  );

  const refreshBalances = React.useCallback(async () => {
    if (outbox.unsent) return; // unsent changes would be undone by the server's older numbers
    try {
      const balances = await loadBalances();
      if (!outbox.unsent) apply({ type: "balances", balances });
    } catch {
      /* next sync tries again */
    }
  }, [apply, outbox]);

  const load = React.useCallback(async () => {
    try {
      let before = acks.current;
      let server = await loadState();
      // a write landed while we read: read again so its effect isn't lost
      for (let i = 0; i < 2 && acks.current !== before; i++) {
        before = acks.current;
        server = await loadState();
      }
      const keep = { questionsToday: stateRef.current.questionsToday, questionsDate: stateRef.current.questionsDate };
      apply({ type: "hydrate", state: overlay({ ...server, ...keep }, [...outbox.all], reducer) });
      setStatus("ready");
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || "Couldn’t reach your account");
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, [apply, outbox]);

  // another tab changed the outbox (sent or added commands): read the server again, debounced
  const reloadSoon = React.useRef<number | undefined>(undefined);
  React.useEffect(
    () =>
      outbox.subscribe((external) => {
        setPending(outbox.size);
        if (!external || draining.current) return;
        window.clearTimeout(reloadSoon.current);
        reloadSoon.current = window.setTimeout(() => void load(), 400);
      }),
    [outbox, load],
  );

  const draining = React.useRef(false);
  const retry = React.useRef<number | undefined>(undefined);
  const drain = React.useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    setSyncing(true);
    window.clearTimeout(retry.current);
    let stuck = false;
    let refused = false;
    try {
      // one tab sends at a time; the others wait for the lock, then find little or nothing left
      await outbox.exclusive(async () => {
        for (let c: Command | undefined = outbox.next(); c; c = outbox.next()) {
          if (!navigator.onLine) {
            stuck = true;
            return;
          }
          const results: { entries: Entry[]; removed: string[] }[] = [];
          try {
            for (let i = c.done; i < c.calls.length; i++) {
              results.push(await runCall(c.calls[i], c.at));
              outbox.update(c.id, { done: i + 1 });
            }
            outbox.remove(c.id);
            acks.current++;
            for (const r of results) ackServer(r);
            setTick((t) => t + 1);
          } catch (e) {
            const err = e instanceof CloudError ? e : new CloudError((e as Error).message);
            if (isCapture(c) && (err.fallback || err.permanent)) {
              // money said aloud is never dropped: read it here, or keep it in Review as words
              const question = err.permanent ? "M8 couldn’t file this on your account. Check it before it counts." : undefined;
              const entries = readLocally(c, stateRef.current.accounts, question);
              if (entries) {
                const action: Action = { type: "add-entries", entries: entries.map((x) => ({ ...x, queued: true })) };
                apply(action);
                outbox.update(c.id, { action, calls: callsFor(action, stateRef.current) ?? [], done: 0, tries: 0, wait: undefined });
              } else {
                const entry = parkedEntry(c, err.permanent ? "M8 couldn’t file this. How much was it?" : "M8 can’t read voice notes yet. How much was it?");
                outbox.update(c.id, { parked: { reason: err.message, entry }, wait: undefined });
                apply({ type: "add-entry", entry });
              }
              continue;
            }
            if (err.permanent) {
              outbox.remove(c.id);
              refused = true;
              setSyncError(`Your account didn’t accept ${WHAT[c.action.type] ?? "a change"} (${err.message}). It was taken back.`);
              continue;
            }
            const tries = c.tries + 1;
            const daily = err.retryAt != null;
            outbox.update(c.id, { tries, wait: { until: retryAt(err, tries), why: daily ? "daily_limit" : "backoff" } });
            if (daily) setSyncError("M8 has read all it can for today. Your voice notes are kept on this phone and filed tomorrow.");
            // a waiting capture holds nothing up; anything else keeps the order and waits
            if (isCapture(c)) continue;
            stuck = true;
            return;
          }
        }
      });
    } finally {
      draining.current = false;
      setSyncing(false);
    }
    const wake = outbox.nextWake();
    if (wake != null) retry.current = window.setTimeout(() => void drain(), Math.min(2 ** 31 - 1, Math.max(1000, wake - Date.now())));
    if (refused) await load();
    else if (!stuck) await refreshBalances();
  }, [ackServer, apply, load, outbox, refreshBalances]);

  const dispatch = React.useCallback(
    (a: Action) => {
      // the demo persona is local-only; erasing goes through eraseAll()
      if (a.type === "load-demo" || a.type === "reset" || a.type === "flush-queue") return;
      const prev = stateRef.current;
      // a parked capture (in Review as words): filling in the amount posts it as a new entry
      const held = (a.type === "update-entry" || a.type === "delete-entry") && outbox.get(a.id)?.parked;
      if (held) {
        if (a.type === "delete-entry") {
          outbox.remove(a.id);
          apply(a);
          // a discarded photo draft takes its photo with it
          if (held.entry.receipt?.path) void removeObject("receipts", held.entry.receipt.path);
          return;
        }
        if (a.type === "update-entry") {
          const next: Entry = { ...held.entry, ...a.patch };
          if (!next.amount) {
            outbox.update(a.id, { parked: { ...held, entry: next } });
            apply(a);
            return;
          }
          outbox.remove(a.id);
          apply({ type: "delete-entry", id: a.id });
          const done = next.category != null && next.accountId != null;
          a = { type: "add-entry", entry: { ...next, status: done ? "posted" : "review", ...(done ? { reviewQuestion: undefined } : {}) } };
        }
      }
      let act = a;
      if (a.type === "add-entry") act = { ...a, entry: { ...a.entry, queued: true } };
      else if (a.type === "add-entries") act = { ...a, entries: a.entries.map((e) => ({ ...e, queued: true })) };
      else if (a.type === "update-entry") {
        const before = prev.entries.find((e) => e.id === a.id);
        const patch: Partial<Entry> = { ...a.patch };
        // filing the last missing field resolves a Review entry (status posted)
        if (before?.status === "review" && !("status" in patch)) {
          const next = { ...before, ...patch };
          const wasMissing = before.category == null || before.accountId == null;
          if (wasMissing && next.category != null && next.accountId != null) patch.status = "posted";
        }
        act = { ...a, patch: { ...patch, queued: true } };
      }
      const calls = callsFor(act, prev);
      apply(act);
      if (calls) {
        outbox.push({ id: crypto.randomUUID(), at: Date.now(), action: act, calls, done: 0, tries: 0 });
        void drain();
      }
    },
    [apply, drain, outbox],
  );

  // first load, then send anything left from last time; again whenever we're back
  React.useEffect(() => {
    void load().then(drain);
    const wake = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      outbox.wake();
      void drain();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      window.clearTimeout(retry.current);
      window.clearTimeout(reloadSoon.current);
    };
  }, [load, drain, outbox]);

  // the last good state stays on this phone so the app opens offline
  React.useEffect(() => {
    if (status === "ready") setPersistError(!writeCache(uid, state));
  }, [uid, state, status]);

  const applyServer = React.useCallback(
    (r: { entries: Entry[]; removed: string[] }) => {
      acks.current++;
      ackServer(r);
      setTick((t) => t + 1);
      void refreshBalances();
    },
    [ackServer, refreshBalances],
  );

  const park = React.useCallback(
    ({ image, ...p }: Parameters<typeof parkCapture>[0] & { image?: string }) => {
      const c = parkCapture(p);
      // the photo itself stays out of the outbox (localStorage); this session shows it
      outbox.push(c);
      const entry = c.parked!.entry;
      apply({ type: "add-entry", entry: image && entry.receipt ? { ...entry, receipt: { ...entry.receipt, image } } : entry });
    },
    [apply, outbox],
  );

  // a different user signed in on this phone: no one else's conversation stays
  React.useEffect(() => clearChatHistory(chatKey(uid)), [uid]);

  const signOut = React.useCallback(async () => {
    await sb().auth.signOut();
    outbox.clear();
    clearCache(uid);
    clearChatHistory();
  }, [outbox, uid]);

  const eraseAll = React.useCallback(async () => {
    await eraseAccountData(uid);
    outbox.clear();
    clearCache(uid);
    clearChatHistory();
    apply({ type: "hydrate", state: EMPTY_STATE });
  }, [apply, outbox, uid]);

  const ledger = React.useMemo(() => ({ state, dispatch, persistError }), [state, dispatch, persistError]);
  const info = React.useMemo<CloudInfo>(
    () => ({
      uid,
      email,
      status,
      loadError,
      pending,
      syncing,
      syncError,
      dismissSyncError: () => setSyncError(null),
      tick,
      reload: load,
      applyServer,
      park,
      signOut,
      eraseAll,
    }),
    [uid, email, status, loadError, pending, syncing, syncError, tick, load, applyServer, park, signOut, eraseAll],
  );

  return (
    <CloudCtx.Provider value={info}>
      <Ctx.Provider value={ledger}>{children}</Ctx.Provider>
    </CloudCtx.Provider>
  );
}
