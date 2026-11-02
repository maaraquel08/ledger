/*
 * M8's conversations. The one on screen is cached in sessionStorage so leaving the tab and
 * coming back keeps it. Past conversations (history) live in the cloud tables chat_threads /
 * chat_messages, which the chat function writes (cloud mode), or in localStorage (local mode).
 * Keys carry the signed-in user, so one person's questions never show for another; erasing
 * data, signing out, starting the demo and switching user all clear them.
 */

const PREFIX = "ledger:chat";
const THREADS = "ledger:threads";
/** local mode keeps this many conversations; the oldest drop off */
const MAX_LOCAL = 50;

/** The storage key for a user's conversation on screen; local mode has one, unkeyed. */
export const chatKey = (uid?: string | null) => (uid ? `${PREFIX}:${uid}` : PREFIX);
/** Which conversation is on screen (its id), next to its cached messages. */
export const currentKey = (uid?: string | null) => `${chatKey(uid)}:current`;

/** Remove every stored conversation, except the on-screen one under `keep`. */
export function clearChatHistory(keep?: string, store: Storage | undefined = globalThis.sessionStorage, local: Storage | undefined = globalThis.localStorage) {
  try {
    if (store)
      for (let i = store.length - 1; i >= 0; i--) {
        const k = store.key(i);
        if (k && (k === PREFIX || k.startsWith(`${PREFIX}:`)) && k !== keep && k !== `${keep}:current`) store.removeItem(k);
      }
    if (local && !keep)
      for (let i = local.length - 1; i >= 0; i--) {
        const k = local.key(i);
        if (k && (k === THREADS || k.startsWith(`${THREADS}:`))) local.removeItem(k);
      }
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

/* ---------- threads -------------------------------------------------------- */

/** A past conversation as the history list shows it. */
export interface Thread {
  id: string;
  title: string;
  /** ISO time of its last message */
  updatedAt: string;
}

/** "What did I spend on food in August?" → at most 60 characters, cut on a word. */
export function threadTitle(question: string) {
  const q = question.trim().replace(/\s+/g, " ");
  if (q.length <= 60) return q;
  const cut = q.slice(0, 59);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 30 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/* local mode: every conversation with its messages, newest first, under one key */

interface LocalThread<M> extends Thread {
  msgs: M[];
}

const localKey = (uid?: string | null) => (uid ? `${THREADS}:${uid}` : THREADS);

function readLocal<M>(uid?: string | null, store: Storage | undefined = globalThis.localStorage): LocalThread<M>[] {
  try {
    const raw = store?.getItem(localKey(uid));
    return raw ? (JSON.parse(raw) as LocalThread<M>[]) : [];
  } catch {
    return [];
  }
}

function writeLocal<M>(list: LocalThread<M>[], uid?: string | null, store: Storage | undefined = globalThis.localStorage) {
  try {
    store?.setItem(localKey(uid), JSON.stringify(list.slice(0, MAX_LOCAL)));
  } catch {
    /* full or unavailable: history is a convenience */
  }
}

export const localThreads = {
  list(uid?: string | null, store?: Storage): Thread[] {
    return readLocal(uid, store).map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  },
  load<M>(id: string, uid?: string | null, store?: Storage): M[] {
    return readLocal<M>(uid, store).find((t) => t.id === id)?.msgs ?? [];
  },
  /** Create or replace a conversation and move it to the top. */
  save<M>(t: { id: string; title: string; msgs: M[] }, uid?: string | null, store?: Storage, now = new Date()) {
    const rest = readLocal<M>(uid, store).filter((x) => x.id !== t.id);
    writeLocal([{ ...t, updatedAt: now.toISOString() }, ...rest], uid, store);
  },
  remove(id: string, uid?: string | null, store?: Storage) {
    writeLocal(readLocal(uid, store).filter((x) => x.id !== id), uid, store);
  },
};
