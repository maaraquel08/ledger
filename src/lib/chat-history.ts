/*
 * M8's conversation lives in sessionStorage. Cloud mode keys it by the signed-in
 * user, so one person's questions never show for another; erasing data, signing
 * out, starting the demo and switching user all clear it.
 */

const PREFIX = "ledger:chat";

/** The storage key for a user's conversation; local mode has one, unkeyed. */
export const chatKey = (uid?: string | null) => (uid ? `${PREFIX}:${uid}` : PREFIX);

/** Remove every stored conversation, except the one under `keep`. */
export function clearChatHistory(keep?: string, store: Storage | undefined = globalThis.sessionStorage) {
  try {
    if (!store) return;
    for (let i = store.length - 1; i >= 0; i--) {
      const k = store.key(i);
      if (k && (k === PREFIX || k.startsWith(`${PREFIX}:`)) && k !== keep) store.removeItem(k);
    }
  } catch {
    /* storage unavailable: nothing to clear */
  }
}
