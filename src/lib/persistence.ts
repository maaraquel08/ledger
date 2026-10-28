import { normalizeGoalBy } from "./format";
import { EMPTY_STATE } from "./seed";
import type { LedgerState } from "./types";

/**
 * Where the ledger lives. Today: localStorage on this phone. Later: an API and a database behind
 * the same two interfaces, so screens and the reducer never change.
 *
 * `LedgerRepository` persists the state without receipt photos; `PhotoStore` keeps the photos
 * under their own key so a full photo store can never block an entry from saving.
 */
export interface LedgerRepository {
  load(): LedgerState | null;
  /** false when the write failed; the caller shows it, nothing is retried silently */
  save(state: LedgerState): boolean;
  clear(): void;
}

export interface PhotoStore {
  get(entryId: string): string | undefined;
  /** idempotent; false when the write failed */
  put(entryId: string, dataUrl: string): boolean;
  /** drop photos whose entry no longer exists, keep the newest `max` */
  prune(keepIds: string[], max?: number): void;
  clear(): void;
}

const STATE_KEY = "ledger:v1";
const PHOTO_KEY = "ledger:photos:v1";
export const PHOTO_CAP = 40;

/** Older saves kept goal dates as "Jan 2027" and photos inside entries; bring them forward. */
function migrate(raw: Partial<LedgerState>, photos: PhotoStore): LedgerState {
  const s: LedgerState = { ...EMPTY_STATE, ...raw };
  s.profile = { ...EMPTY_STATE.profile, ...s.profile, goals: (s.profile?.goals ?? []).map((g) => ({ ...g, by: normalizeGoalBy(g.by) })) };
  s.entries = (s.entries ?? []).map((e) => {
    if (!e.receipt) return e;
    if (e.receipt.image) photos.put(e.id, e.receipt.image);
    const image = photos.get(e.id);
    return { ...e, receipt: { ...e.receipt, image } };
  });
  return s;
}

export function localStorageRepository(photos: PhotoStore): LedgerRepository {
  return {
    load() {
      try {
        const raw = localStorage.getItem(STATE_KEY);
        return raw ? migrate(JSON.parse(raw), photos) : null;
      } catch {
        return null; // private mode or corrupt — start fresh
      }
    },
    save(state) {
      // photos go to their own key first; the state is written without them
      let photosOk = true;
      for (const e of state.entries) if (e.receipt?.image && !photos.put(e.id, e.receipt.image)) photosOk = false;
      photos.prune(state.entries.map((e) => e.id));
      const slim: LedgerState = {
        ...state,
        entries: state.entries.map((e) => (e.receipt?.image ? { ...e, receipt: { ...e.receipt, image: undefined } } : e)),
      };
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify(slim));
        return photosOk;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        localStorage.removeItem(STATE_KEY);
      } catch {
        /* nothing to clear */
      }
      photos.clear();
    },
  };
}

export function localStoragePhotoStore(): PhotoStore {
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(PHOTO_KEY) ?? "{}");
    } catch {
      return {};
    }
  };
  const write = (m: Record<string, string>) => {
    try {
      localStorage.setItem(PHOTO_KEY, JSON.stringify(m));
      return true;
    } catch {
      return false;
    }
  };
  return {
    get: (id) => read()[id],
    put(id, dataUrl) {
      const m = read();
      if (m[id] === dataUrl) return true;
      m[id] = dataUrl;
      return write(m);
    },
    prune(keepIds, max = PHOTO_CAP) {
      const m = read();
      const keep = new Set(keepIds);
      const ids = Object.keys(m).filter((id) => keep.has(id));
      // keepIds arrive newest first (entries are sorted by date desc)
      const ordered = keepIds.filter((id) => id in m).slice(0, max);
      if (ordered.length === ids.length && ids.length === Object.keys(m).length) return;
      write(Object.fromEntries(ordered.map((id) => [id, m[id]])));
    },
    clear() {
      try {
        localStorage.removeItem(PHOTO_KEY);
      } catch {
        /* nothing to clear */
      }
    },
  };
}
