// POST /capture — free-form capture (text, voice clip, receipt photo) → entries.
// Caller's JWT only (RLS applies). Captured content is data, never instructions.
// See supabase/functions/README.md for the request/response shape.
import {
  applyGate, type CaptureContext, captureClock, captureIds, type EntryJson, type ParseOutput, planEntry, REFUND_REVIEW, summarize, toClientEntry,
} from "../_shared/capture_core.ts";
import { AiError, aiClient, aiFailure, type ContentBlockParam, MODEL, structured, system } from "../_shared/claude.ts";
import { type Db, rpc, userClient, userId } from "../_shared/clients.ts";
import { type GateResult, runGate } from "../_shared/gate.ts";
import { body, error, guard, json, UUID_RE, validTz } from "../_shared/http.ts";
import { type AccountRow, type AliasRow, buildKbBlock, type RecurringRow, type RuleRow } from "../_shared/kb.ts";
import { PARSE_SYSTEM } from "../_shared/prompts.ts";
import { PARSE_SCHEMA } from "../_shared/schemas.ts";
import { transcriber } from "../_shared/stt.ts";
import { localIso } from "../_shared/time.ts";

interface CaptureBody {
  client_id: string;
  kind: "text" | "voice" | "photo";
  text?: string;
  storage_path?: string;
  tz: string;
  /** ISO time the Owner captured it (offline queue); see captureClock */
  captured_at?: string;
}

/** Stored in raw_inputs.gate; a replay of the same client_id returns it unchanged. */
interface StoredGate {
  outcome: "saved" | "review";
  passed: boolean;
  failed_check?: string;
  question?: string;
  undo_event_id?: string;
  entry_ids: string[];
  checks: { entry_ids: string[]; gate: GateResult }[];
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude's per-image limit
const MAX_TEXT = 4000;
const IN_PROGRESS_MS = 2 * 60_000;
/** Server-side daily cap on captures (cost guard, like chat's CHAT_DAILY_LIMIT). */
const DAILY_LIMIT = Number(Deno.env.get("CAPTURE_DAILY_LIMIT") ?? "200");

Deno.serve(async (req) => {
  const early = guard(req);
  if (early) return early;

  // authenticate first: an unauthenticated caller learns nothing about the configuration
  const db = userClient(req);
  const uid = db ? await userId(db) : null;
  if (!db || !uid) return error(401, "unauthorized");

  const claude = aiClient();
  if (!claude) return error(503, "ai_unconfigured");

  const b = await body<CaptureBody>(req);
  if (!b || typeof b.client_id !== "string" || !UUID_RE.test(b.client_id)) return error(400, "bad_request", { detail: "client_id must be a uuid" });
  if (!["text", "voice", "photo"].includes(b.kind)) return error(400, "bad_request", { detail: "kind must be text, voice or photo" });
  if (b.kind === "text" && !(typeof b.text === "string" && b.text.trim())) return error(400, "bad_request", { detail: "text is required" });
  if (b.kind !== "text" && !(typeof b.storage_path === "string" && b.storage_path.startsWith(`${uid}/`))) {
    return error(400, "bad_request", { detail: "storage_path must be inside your folder" });
  }
  const tz = validTz(b.tz) ?? "Asia/Manila";
  const serverNow = new Date();
  const clock = captureClock(b.captured_at, serverNow);
  if (!clock) return error(400, "bad_request", { detail: "captured_at must be an ISO date-time" });
  const now = clock.now;

  // ---- idempotency: client_id is raw_inputs.id ------------------------------------------
  const { data: prior, error: priorErr } = await db.from("raw_inputs")
    .select("id, gate, created_at, parsed, model, transcript").eq("id", b.client_id).maybeSingle();
  if (priorErr) return error(500, "internal", { detail: priorErr.message });
  if (prior?.gate) return json(await replay(db, b.client_id, prior.gate as StoredGate));
  if (prior && serverNow.getTime() - Date.parse(prior.created_at) < IN_PROGRESS_MS) return error(409, "in_progress");
  // a retry after the parse was saved reuses it: no second Claude call, same entries, same ids
  const saved = (prior?.parsed ?? null) as ParseOutput | null;

  if (!saved) {
    const quota = await rpc<{ allowed: boolean; limit: number }>(db, "capture_quota_take", { p_limit: DAILY_LIMIT }).catch((e: Error & { code?: string }) => e);
    if (quota instanceof Error) return error(500, "internal", { ...(quota.code ? { sqlstate: quota.code } : {}) });
    if (!quota.allowed) return error(429, "daily_limit", { limit: quota.limit });
  }
  if (!prior) {
    const { error: insErr } = await db.from("raw_inputs").insert({
      id: b.client_id,
      kind: b.kind,
      text: b.kind === "text" ? b.text!.slice(0, MAX_TEXT) : null,
      storage_path: b.storage_path ?? null,
    });
    if (insErr?.code === "23505") return error(409, "client_id_in_use");
    if (insErr) return error(500, "internal", { detail: insErr.message });
  }

  try {
    // ---- the source ------------------------------------------------------------------------
    let sourceText = b.kind === "text" ? b.text!.slice(0, MAX_TEXT) : b.kind === "voice" && saved ? (prior?.transcript ?? "") : "";
    const content: ContentBlockParam[] = [];
    if (b.kind === "voice" && !saved) {
      const stt = transcriber();
      if (!stt) return error(503, "stt_unconfigured", { raw_input_id: b.client_id });
      const { data: clip, error: dlErr } = await db.storage.from("voice").download(b.storage_path!);
      if (dlErr || !clip) return error(404, "clip_not_found", { raw_input_id: b.client_id });
      sourceText = (await stt.transcribe(clip, b.storage_path!.split("/").pop() || "clip.webm")).slice(0, MAX_TEXT);
      await check(db.from("raw_inputs").update({ transcript: sourceText }).eq("id", b.client_id));
      if (!sourceText) return json(emptyResult(b.client_id, "I couldn’t hear an amount. What did you spend?"));
    }
    if (b.kind === "photo" && !saved) {
      const { data: img, error: dlErr } = await db.storage.from("receipts").download(b.storage_path!);
      if (dlErr || !img) return error(404, "image_not_found", { raw_input_id: b.client_id });
      if (img.size > MAX_IMAGE_BYTES) return error(413, "image_too_large", { raw_input_id: b.client_id });
      content.push({ type: "image", source: { type: "base64", media_type: imageType(img.type, b.storage_path!), data: base64(new Uint8Array(await img.arrayBuffer())) } });
    }

    // ---- knowledge base (cached system prefix) ---------------------------------------------
    const [accounts, aliases, rules, recurring] = await Promise.all([
      rows<AccountRow>(db.from("accounts").select("id, name, provider, provider_label, type, last4, archived_at")),
      rows<AliasRow>(db.from("account_aliases").select("account_id, alias")),
      rows<RuleRow>(db.from("rules").select("id, match, set, active").eq("active", true)),
      rows<RecurringRow>(db.from("recurring_items").select("id, description, merchant, category_code, account_id, amount, cadence, day_of_month, weekday, active").eq("active", true)),
    ]);
    const kb = buildKbBlock({ accounts, aliases, rules, recurring });

    // ---- parse with Claude -------------------------------------------------------------------
    const fenced = b.kind === "photo" ? "The receipt is the image above." : sourceText.replaceAll("</captured_input", "</captured-input");
    content.push({
      type: "text",
      text: `<context>\nnow: ${localIso(now, tz)}\ntimezone: ${tz}\n</context>\n<captured_input kind="${b.kind}">\n${fenced}\n</captured_input>`,
    });
    const model = saved ? String(prior?.model ?? "") : b.kind === "photo" ? MODEL.parsePhoto : MODEL.parseText;
    const parsed = saved ?? (await structured<ParseOutput>(claude, {
      model,
      system: system(PARSE_SYSTEM, kb),
      messages: [{ role: "user", content }],
      schema: PARSE_SCHEMA,
      effort: b.kind === "photo" ? "medium" : "low",
      maxTokens: 8000,
    })).value;
    if (b.kind === "photo") sourceText = parsed.receipt?.text ?? "";
    if (!saved) await check(db.from("raw_inputs").update({ model, parsed }).eq("id", b.client_id));

    // ---- plan, gate, post --------------------------------------------------------------------
    const ctx: CaptureContext = {
      kind: b.kind, rawInputId: b.client_id, sourceText, storagePath: b.storage_path ?? null,
      accounts, aliases, rules, now, clockSuspect: clock.suspect,
      newId: await captureIds(b.client_id, parsed.entries.length),
    };
    const gates: GateResult[] = [];
    const checks: StoredGate["checks"] = [];
    const legs = [];
    const ruleHits = new Set<string>();
    let undoId: string | undefined;

    for (const [i, p] of parsed.entries.entries()) {
      // a refund is never applied automatically: the Owner marks the purchase refunded from Review
      if (p.kind === "refund") {
        gates.push(REFUND_REVIEW);
        continue;
      }
      const plan = planEntry(p, ctx, parsed.receipt, i);
      let duplicateOf: string | null = null;
      let categoryMedian: number | null = null;
      if (plan.needsDataChecks) {
        const c = await rpc<{ duplicate: { id: string } | null; median: { value: number | null } | null }>(db, "capture_checks", {
          p_amount: plan.legs[0].amount,
          p_merchant: plan.legs[0].merchant ?? plan.legs[0].description,
          p_category: plan.legs[0].category_code,
          p_at: plan.legs[0].occurred_at,
        });
        duplicateOf = c.duplicate?.id ?? null;
        categoryMedian = c.median?.value ?? null;
      }
      const gate = runGate({ ...plan.gate, duplicateOf, categoryMedian });
      gates.push(gate);
      checks.push({ entry_ids: plan.legs.map((l) => l.id), gate });
      legs.push(...applyGate(plan, gate));
      if (plan.ruleId) ruleHits.add(plan.ruleId);
    }

    // one capture = one post_entries call = one undo batch: undo_event_id reverts all of it
    let posted: EntryJson[] = [];
    if (legs.length) {
      const result = await rpc<{ entries: EntryJson[]; undo_event_id: string | null }>(db, "post_entries", { p_entries: legs });
      posted = result.entries;
      undoId = result.undo_event_id ?? undefined;
    }

    const summary = parsed.entries.length
      ? summarize(gates)
      : { passed: false, failed_check: "amount_literal" as const, question: "I couldn’t find an amount in that. How much was it?" };
    const outcome: StoredGate["outcome"] = summary.passed && posted.length ? "saved" : "review";
    const stored: StoredGate = {
      outcome,
      ...summary,
      ...(undoId ? { undo_event_id: undoId } : {}),
      entry_ids: posted.map((e) => e.id),
      checks,
    };
    await check(db.from("raw_inputs").update({ gate: stored }).eq("id", b.client_id));
    for (const id of ruleHits) await bumpRule(db, id, serverNow);

    return json(respond(b.client_id, stored, posted));
  } catch (e) {
    console.error("capture failed", e);
    const f = aiFailure(e);
    if (e instanceof AiError || f.code.startsWith("ai_")) return error(f.status, f.code, { raw_input_id: b.client_id });
    const code = (e as { code?: string }).code;
    return error(500, "internal", { raw_input_id: b.client_id, ...(code ? { sqlstate: code } : {}) });
  }
});

function respond(rawInputId: string, g: StoredGate, entries: EntryJson[]) {
  return {
    raw_input_id: rawInputId,
    outcome: g.outcome,
    entries: entries.map(toClientEntry),
    gate: { passed: g.passed, ...(g.failed_check ? { failed_check: g.failed_check } : {}), ...(g.question ? { question: g.question } : {}) },
    ...(g.undo_event_id ? { undo_event_id: g.undo_event_id } : {}),
  };
}

function emptyResult(rawInputId: string, question: string) {
  return { raw_input_id: rawInputId, outcome: "review" as const, entries: [], gate: { passed: false, failed_check: "amount_literal", question } };
}

async function replay(db: Db, rawInputId: string, g: StoredGate) {
  const entries: EntryJson[] = [];
  for (const id of g.entry_ids ?? []) {
    const e = await rpc<EntryJson | null>(db, "entry_json", { p_id: id });
    if (e) entries.push(e);
  }
  return respond(rawInputId, g, entries);
}

/** Await a write and throw on its error (caught below as 500 internal). */
async function check(q: PromiseLike<{ error: { message: string; code?: string } | null }>): Promise<void> {
  const { error } = await q;
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

async function bumpRule(db: Db, id: string, now: Date) {
  const { data } = await db.from("rules").select("hits").eq("id", id).maybeSingle();
  if (data) await db.from("rules").update({ hits: (data.hits ?? 0) + 1, last_hit_at: now.toISOString() }).eq("id", id);
}

function imageType(mime: string, path: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const m = (mime || "").toLowerCase();
  if (m === "image/png" || /\.png$/i.test(path)) return "image/png";
  if (m === "image/webp" || /\.webp$/i.test(path)) return "image/webp";
  if (m === "image/gif" || /\.gif$/i.test(path)) return "image/gif";
  return "image/jpeg";
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
