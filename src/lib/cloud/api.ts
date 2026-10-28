import { EMPTY_STATE } from "../seed";
import { sb, SUPABASE_ANON_KEY, SUPABASE_URL } from "../supabase";
import type { Entry, LedgerState } from "../types";
import { anyToEntry, latestHoldings, toAccount, toEntry, toProfile, type AccountRow } from "./map";
import { backoff, nextDay, type Call } from "./outbox";

type Row = Record<string, unknown>;

/** A failed cloud call. `permanent` = the server refused it; retrying cannot help. */
export class CloudError extends Error {
  code: string;
  status: number;
  permanent: boolean;
  /** capture only: the server has no AI to read it (or no capture function): read it on the phone */
  fallback = false;
  /** capture only: the daily limit; try again from this time (ms epoch) */
  retryAt?: number;
  constructor(message: string, code = "", status = 0) {
    super(message);
    this.code = code;
    this.status = status;
    // SQLSTATE classes the server uses for "this write is wrong" (CONTRACT.md Errors):
    // 22 bad argument, 23 constraint, P0 not found. Everything else (network, auth refresh,
    // 5xx, 40001, missing schema) is retried.
    this.permanent = /^(22|23|P0)/.test(code);
  }
}

function check<T>(res: { data: T; error: { message: string; code?: string } | null; status?: number }): T {
  if (res.error) throw new CloudError(res.error.message, res.error.code ?? "", res.status ?? 0);
  return res.data;
}

/** Page through a select (PostgREST returns at most 1000 rows per request). */
async function all(table: string, select = "*", build?: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = sb().from(table).select(select);
    if (build) q = build(q);
    const rows = check(await q.range(from, from + size - 1)) as unknown as Row[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

/* ---------- load ---------------------------------------------------------- */

/** Everything the screens read, as one LedgerState (CONTRACT.md "TypeScript <-> rows"). */
export async function loadState(): Promise<LedgerState> {
  const [accounts, balances, entries, profile, goals, holdings] = await Promise.all([
    all("accounts", "*", (q) => q.is("archived_at", null).order("created_at")),
    all("account_balances", "account_id,balance"),
    all("entries", "*, entry_splits(*), receipt_items(*)", (q) => q.neq("status", "void").order("occurred_at", { ascending: false }).order("id")),
    sb().from("profiles").select("*").maybeSingle().then(check),
    all("goals", "*", (q) => q.is("archived_at", null).order("created_at")),
    all("holding_snapshots", "*", (q) => q.order("as_of", { ascending: false })),
  ]);
  const bal = new Map(balances.map((b) => [String(b.account_id), Number(b.balance)]));
  const accs = (accounts as AccountRow[]).map((a) => toAccount(a, bal.get(a.id)));
  const live = new Set(accs.map((a) => a.id));
  return {
    ...EMPTY_STATE,
    onboarded: !!(profile as Row | null)?.onboarded,
    demo: false,
    profile: toProfile(profile as Row | null, goals, latestHoldings(holdings), EMPTY_STATE.profile),
    accounts: accs,
    entries: entries
      .map(toEntry)
      .filter((e): e is Entry => !!e)
      // an archived account's entries read as orphaned, as local mode's "remove account" does
      .map((e) => (e.accountId && !live.has(e.accountId) ? { ...e, accountId: null } : e)),
  };
}

export async function loadBalances(): Promise<Record<string, number>> {
  const rows = await all("account_balances", "account_id,balance");
  return Object.fromEntries(rows.map((r) => [String(r.account_id), Number(r.balance)]));
}

/* ---------- writes ------------------------------------------------------- */

/**
 * Run one outbox call. `at` is when the Owner made the change (the command's time): a queued
 * reported balance or capture is dated then, not when it finally reaches the server.
 * Returns the entries the server acknowledged (mutation results).
 */
export async function runCall(c: Call, at?: number): Promise<{ entries: Entry[]; removed: string[] }> {
  const none = { entries: [], removed: [] };
  const when = new Date(at ?? Date.now()).toISOString();
  if (c.kind === "rpc") {
    const args = c.fn === "report_balance" && at != null && !("p_as_of" in c.args) ? { ...c.args, p_as_of: when } : c.args;
    const data = check(await sb().rpc(c.fn, args)) as Row | null;
    return mutation(data);
  }
  if (c.kind === "upsert") {
    check(await sb().from(c.table).upsert(c.rows, { onConflict: c.onConflict }));
    return none;
  }
  if (c.kind === "update") {
    check(await sb().from(c.table).update(c.values).eq("id", c.id));
    return none;
  }
  const body = { captured_at: when, ...c.body };
  let res = await callFunction("capture", body);
  if (res.status === 401) {
    // the session lapsed while the phone was away: refresh it once, then send again
    await sb().auth.refreshSession();
    res = await callFunction("capture", body);
  }
  if (!res.ok) throw captureError(res.status, res.data as Row | null);
  return { entries: captureEntries(res.data as Row | null), removed: [] };
}

/**
 * How a failed capture is handled (supabase/functions/README.md "POST /capture" errors).
 * Only a malformed request (400), a client id used for something else (409 client_id_in_use)
 * or a clip/photo that no longer exists are permanent. No AI on the server (503 *_unconfigured,
 * or no function deployed: 404) → read it on the phone. The daily limit (429) waits for the
 * next day. Everything else (503 ai_busy / ai_unreachable, other 5xx, 409 in_progress, 401
 * after a refresh, network) is retried with backoff.
 */
export function captureError(status: number, data: Row | null, now = Date.now()): CloudError {
  const code = String(data?.error ?? "");
  const err = new CloudError(String(data?.message ?? (code || `capture failed (${status})`)), code, status);
  err.permanent = status === 400 || (status === 409 && code === "client_id_in_use") || (status === 404 && code.endsWith("_not_found"));
  err.fallback = !err.permanent && (code.endsWith("_unconfigured") || status === 404);
  if (status === 429) err.retryAt = nextDay(now);
  return err;
}

/** when a failed outbox call may be sent again */
export const retryAt = (err: CloudError, tries: number, now = Date.now()) => err.retryAt ?? now + backoff(tries);

/**
 * Entries from a capture response. Each carries `status` ("review" waits for the Owner in
 * Review) and its `reviewQuestion`; a review entry without its own question gets the gate's.
 */
export function captureEntries(d: Row | null): Entry[] {
  const question = (d?.gate as { question?: string } | undefined)?.question;
  return entriesOf(d).map((e) => (e.status === "review" && !e.reviewQuestion && question ? { ...e, reviewQuestion: question } : e));
}

/** `{entries: EntryJson[]}` from a mutation result; void ones are removals. */
export function mutation(data: Row | null): { entries: Entry[]; removed: string[] } {
  const rows = ((data?.entries as Row[] | undefined) ?? []).filter(Boolean);
  const entries: Entry[] = [];
  const removed: string[] = [];
  for (const r of rows) {
    const e = toEntry(r);
    if (e) entries.push(e);
    else removed.push(String(r.id));
  }
  for (const id of (data?.deleted_ids as string[] | undefined) ?? []) removed.push(id);
  return { entries, removed };
}

const entriesOf = (data: Row | null) => ((data?.entries as Row[] | undefined) ?? []).map(anyToEntry).filter((e): e is Entry => !!e);

/** undo_event: reverts the whole batch (both legs, a void and its cascade). */
export async function undoEvent(eventId: string) {
  return mutation(check(await sb().rpc("undo_event", { p_event_id: eventId })) as Row);
}

/* ---------- edge functions ---------------------------------------------- */

/** POST /functions/v1/<name> with the Owner's JWT. Throws only when the network fails. */
export async function callFunction(name: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const { data } = await sb().auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty or not JSON */
  }
  return { ok: res.ok, status: res.status, data: json };
}

export interface CaptureResult {
  raw_input_id: string;
  outcome: "saved" | "review";
  entries: Entry[];
  gate: { passed: boolean; failed_check?: string; question?: string };
  undo_event_id?: string;
}

/**
 * capture: text, a voice clip or a receipt photo → entries. Returns null when the caller should
 * fall back to the phone's own parsers: offline, or the server has no AI configured (503).
 */
export async function capture(body: { client_id: string; kind: "text" | "voice" | "photo"; text?: string; storage_path?: string }): Promise<CaptureResult | null> {
  if (!navigator.onLine) return null;
  let res;
  try {
    res = await callFunction("capture", { ...body, tz: timezone(), captured_at: new Date().toISOString() });
  } catch {
    return null; // network
  }
  if (res.status === 503 || res.status === 404) return null; // ai_unconfigured, or not deployed yet
  const d = res.data as Row | null;
  if (!res.ok || !d) throw new CloudError(String(d?.error ?? d?.message ?? `capture failed (${res.status})`), "", res.status);
  return {
    raw_input_id: String(d.raw_input_id ?? ""),
    outcome: d.outcome === "review" ? "review" : "saved",
    entries: captureEntries(d),
    gate: (d.gate as CaptureResult["gate"]) ?? { passed: d.outcome !== "review" },
    undo_event_id: (d.undo_event_id as string | undefined) ?? undefined,
  };
}

export const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila";

/* ---------- storage ------------------------------------------------------ */

/** Upload to a private bucket at `<uid>/<uuid>.<ext>`; returns the object path. */
export async function upload(bucket: "receipts" | "voice", uid: string, blob: Blob, ext: string): Promise<string> {
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  check(await sb().storage.from(bucket).upload(path, blob, { contentType: blob.type || undefined, upsert: false }));
  return path;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const type = head.match(/data:([^;]+)/)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Remove every object in the Owner's folder of both buckets. */
export async function removeAllObjects(uid: string) {
  for (const bucket of ["receipts", "voice"]) {
    for (;;) {
      const files = check(await sb().storage.from(bucket).list(uid, { limit: 1000 })) as { name: string }[];
      if (!files?.length) break;
      check(await sb().storage.from(bucket).remove(files.map((f) => `${uid}/${f.name}`)));
      if (files.length < 1000) break;
    }
  }
}

/* ---------- erase and export --------------------------------------------- */

/** Deletes every row the Owner has (erase_my_data) and their Storage objects. The login stays. */
export async function eraseAccountData(uid: string) {
  check(await sb().rpc("erase_my_data"));
  await removeAllObjects(uid);
}

const EXPORT_TABLES = [
  "profiles",
  "accounts",
  "account_balances",
  "entries",
  "entry_splits",
  "receipt_items",
  "moves",
  "raw_inputs",
  "balance_snapshots",
  "holding_snapshots",
  "fx_rates",
  "goals",
  "recurring_items",
  "account_aliases",
  "rules",
  "corrections",
  "insights",
  "push_subscriptions",
  "notification_log",
  "entry_events",
];

/** Every row the Owner can read, table by table (RLS scopes it to them). */
export async function exportAll(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), format: "ledger-export-1" };
  for (const t of EXPORT_TABLES) {
    try {
      out[t] = await all(t);
    } catch (e) {
      out[t] = { error: (e as Error).message };
    }
  }
  return out;
}

/* ---------- insights and reconciliation ---------------------------------- */

export interface Insight {
  id: string;
  kind: "daily" | "weekly" | "monthly" | "alert" | "answer";
  narrative: string | null;
  stale: boolean;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  period_start: string | null;
  period_end: string | null;
}

export async function loadInsights(): Promise<Insight[]> {
  const res = await sb()
    .from("insights")
    .select("id,kind,narrative,stale,read_at,dismissed_at,created_at,period_start,period_end")
    .is("dismissed_at", null)
    .neq("kind", "answer")
    .order("created_at", { ascending: false })
    .limit(30);
  return check(res) as Insight[];
}

export async function markInsights(ids: string[], field: "read_at" | "dismissed_at") {
  if (!ids.length) return;
  check(await sb().from("insights").update({ [field]: new Date().toISOString() }).in("id", ids));
}

export interface Gap {
  account_id: string;
  name: string;
  type: string;
  snapshot_id: string;
  as_of: string;
  reported: number;
  derived: number;
  gap: number;
}

export async function loadGaps(): Promise<Gap[]> {
  const rows = check(await sb().from("reconciliation").select("*")) as Row[];
  return rows
    .map((r) => ({ ...r, reported: Number(r.reported), derived: Number(r.derived), gap: Number(r.gap) }) as Gap)
    .filter((g) => Math.round(g.gap) !== 0);
}

/* ---------- import ------------------------------------------------------- */

/** One-time move of this phone's ledger into the account (import_state is idempotent). */
export async function importState(state: LedgerState) {
  const slim = { ...state, entries: state.entries.map((e) => (e.receipt?.image ? { ...e, receipt: { ...e.receipt, image: undefined } } : e)) };
  return check(await sb().rpc("import_state", { p_state: slim })) as Row;
}
