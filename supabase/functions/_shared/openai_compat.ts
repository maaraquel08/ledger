// OpenAI-compatible chat-completions adapter (Groq by default) behind the same call/parseJson
// interface as the Anthropic path in claude.ts. Pure module: fetch and sleep are injected, no Deno
// globals, so vitest can import it.
//
// The functions speak Anthropic shapes (system blocks, content blocks, tool_use / tool_result).
// This module translates them to chat-completions requests and translates the answer back into an
// Anthropic-shaped message, so capture, chat and insights-run do not change.
//
// Groq facts this relies on (console.groq.com/docs, read 2026-10-29):
// - response_format json_schema with strict:true on gpt-oss-20b/120b and qwen3.8-27b; every
//   property in `required`, optional ones nullable, additionalProperties:false on every object.
// - Structured outputs cannot be combined with tool use: a request with tools runs without
//   response_format, and the final answer is asked for in a second call with no tools.
// - Vision (qwen3.8-27b): at most 3 images, 20MB per request.
// - gpt-oss: reasoning_effort low|medium|high, include_reasoning; other reasoning models need
//   reasoning_format parsed|hidden with tools or JSON mode.

// ---- Anthropic-side shapes (structural subset of the SDK types) --------------------------------

export interface TextBlock {
  type: "text";
  text: string;
  cache_control?: unknown;
}
export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string };
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: string | { type: string; text?: string }[];
  is_error?: boolean;
}
export type Block = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;
export interface AMessage {
  role: "user" | "assistant";
  content: string | { type: string }[];
}
export interface ATool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal";
export interface AResult {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: (TextBlock | ToolUseBlock)[];
  stop_reason: StopReason;
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

export interface CompatCallOptions {
  model: string;
  system: { type: "text"; text: string }[];
  messages: AMessage[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  tools?: ATool[];
}

// ---- errors ------------------------------------------------------------------------------------

/** Thrown for answers we cannot use (refusal, truncation, bad JSON, input over the provider's limits). */
export class AiError extends Error {
  constructor(public code: "refused" | "truncated" | "bad_output" | "no_output" | "image_too_large", message?: string) {
    super(message ?? code);
  }
}

/** A failed HTTP exchange with the provider. status 0 = network error or timeout. */
export class ProviderError extends Error {
  constructor(public status: number, message: string, public errorCode?: string, public retryAfterS?: number) {
    super(message);
  }
}

/** Provider / AiError failures → HTTP status + the error codes the client already handles. */
export function providerFailure(e: unknown): { status: number; code: string } | null {
  if (e instanceof AiError) return e.code === "image_too_large" ? { status: 413, code: "image_too_large" } : { status: 502, code: `ai_${e.code}` };
  if (!(e instanceof ProviderError)) return null;
  const s = e.status;
  if (s === 0) return { status: 503, code: "ai_unreachable" };
  if (s === 401 || s === 403) return { status: 503, code: "ai_unconfigured" };
  if (s === 429 || s === 498 || s === 503) return { status: 503, code: "ai_busy" };
  if (s >= 500) return { status: 503, code: "ai_unreachable" };
  if (s >= 400) return { status: 502, code: "ai_bad_request" };
  return { status: 502, code: "ai_error" };
}

// ---- schemas -----------------------------------------------------------------------------------

type Schema = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const types = (s: Schema): string[] => (Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === "string" ? [s.type] : []);
const isObjectSchema = (s: Schema) => types(s).includes("object") || isObj(s.properties);

function allowsNull(s: Schema): boolean {
  if (types(s).includes("null")) return true;
  return Array.isArray(s.anyOf) && (s.anyOf as Schema[]).some((b) => isObj(b) && allowsNull(b));
}

function nullable(s: Schema): Schema {
  if (allowsNull(s)) return s;
  if (Array.isArray(s.anyOf)) return { ...s, anyOf: [...(s.anyOf as Schema[]), { type: "null" }] };
  if (typeof s.type === "string" || Array.isArray(s.type)) {
    const out: Schema = { ...s, type: [...types(s), "null"] };
    if (Array.isArray(s.enum)) out.enum = [...s.enum, null];
    return out;
  }
  const { description, ...rest } = s;
  return { ...(description !== undefined ? { description } : {}), anyOf: [rest, { type: "null" }] };
}

/**
 * A strict-mode copy of a JSON schema: every object lists all its properties in `required` and
 * sets additionalProperties:false; properties that were optional become nullable. Idempotent on
 * schemas that are already strict (schemas.ts).
 */
export function strictify(schema: Schema): Schema {
  const s: Schema = { ...schema };
  if (isObjectSchema(s)) {
    const props = isObj(s.properties) ? s.properties as Record<string, Schema> : {};
    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    s.properties = Object.fromEntries(
      Object.entries(props).map(([k, p]) => [k, required.has(k) ? strictify(p) : nullable(strictify(p))]),
    );
    s.required = Object.keys(props);
    s.additionalProperties = false;
  }
  if (isObj(s.items)) s.items = strictify(s.items);
  if (Array.isArray(s.anyOf)) s.anyOf = (s.anyOf as Schema[]).map((b) => (isObj(b) ? strictify(b) : b));
  for (const key of ["$defs", "definitions"]) {
    if (isObj(s[key])) s[key] = Object.fromEntries(Object.entries(s[key] as Record<string, Schema>).map(([k, d]) => [k, strictify(d)]));
  }
  return s;
}

const jsonType = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;

/** Errors of `value` against `schema` (the subset strict mode allows; $ref is not followed). Empty = valid. */
export function validate(schema: Schema, value: unknown, path = "$"): string[] {
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as Schema[];
    if (!branches.some((b) => validate(b, value, path).length === 0)) return [`${path}: matches no anyOf branch`];
  }
  const t = types(schema);
  const vt = jsonType(value);
  if (t.length && !t.includes(vt) && !(vt === "integer" && t.includes("number"))) return [`${path}: expected ${t.join("|")}, got ${vt}`];
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) return [`${path}: not one of the allowed values`];
  if ("const" in schema && schema.const !== value) return [`${path}: not the constant value`];
  const errors: string[] = [];
  if (isObj(value) && isObjectSchema(schema)) {
    const props = isObj(schema.properties) ? schema.properties as Record<string, Schema> : {};
    for (const k of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
      if (!(k in value)) errors.push(`${path}.${k}: missing`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errors.push(...validate(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: not allowed`);
    }
  }
  if (Array.isArray(value) && isObj(schema.items)) value.forEach((v, i) => errors.push(...validate(schema.items as Schema, v, `${path}[${i}]`)));
  return errors;
}

/**
 * Undo strictify's nulls: a property that the ORIGINAL schema left optional and the model set to
 * null is removed, so callers see the same shapes as before. Required-but-nullable stays null.
 */
export function normaliseNulls<T>(schema: Schema, value: T): T {
  if (Array.isArray(schema.anyOf)) {
    const want = Array.isArray(value) ? "array" : isObj(value) ? "object" : null;
    const branch = want && (schema.anyOf as Schema[]).find((b) => isObj(b) && (want === "object" ? isObjectSchema(b) : isObj(b.items)));
    return branch ? normaliseNulls(branch, value) : value;
  }
  if (Array.isArray(value)) return (isObj(schema.items) ? value.map((v) => normaliseNulls(schema.items as Schema, v)) : value) as T;
  if (!isObj(value)) return value;
  if (!isObjectSchema(schema)) return value;
  const props = isObj(schema.properties) ? schema.properties as Record<string, Schema> : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null && !required.has(k)) continue;
    out[k] = props[k] ? normaliseNulls(props[k], v) : v;
  }
  return out as T;
}

// ---- messages ----------------------------------------------------------------------------------

export type OaPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface OaToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type OaMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OaPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: OaToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface OaTool {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

const blocksOf = (m: AMessage): Block[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as Block[]));

function toolResultText(b: ToolResultBlock): string {
  const body = typeof b.content === "string"
    ? b.content
    : (b.content ?? []).flatMap((p) => (p.type === "text" && typeof p.text === "string" ? [p.text] : [])).join("\n");
  return b.is_error ? `ERROR: ${body}` : body;
}

function imageUrl(b: ImageBlock): string {
  return b.source.type === "base64" ? `data:${b.source.media_type};base64,${b.source.data}` : b.source.url;
}

/** Anthropic system + messages → chat-completions messages. Cache hints are dropped (no-op). */
export function toOpenAiMessages(system: { text: string }[], messages: AMessage[]): OaMessage[] {
  const out: OaMessage[] = [];
  const sys = system.map((b) => b.text).filter(Boolean).join("\n\n");
  if (sys) out.push({ role: "system", content: sys });
  for (const m of messages) {
    const blocks = blocksOf(m);
    if (m.role === "assistant") {
      const text = blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const calls: OaToolCall[] = blocks.flatMap((b) =>
        b.type === "tool_use" ? [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }] : []
      );
      out.push(calls.length ? { role: "assistant", content: text || null, tool_calls: calls } : { role: "assistant", content: text });
      continue;
    }
    // tool results answer the previous assistant turn, so they come first, one message each
    for (const b of blocks) if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: toolResultText(b) });
    const parts: OaPart[] = blocks.flatMap((b): OaPart[] =>
      b.type === "text" ? [{ type: "text", text: b.text }] : b.type === "image" ? [{ type: "image_url", image_url: { url: imageUrl(b) } }] : []
    );
    if (!parts.length) continue;
    const textOnly = parts.every((p) => p.type === "text");
    out.push({ role: "user", content: textOnly ? parts.map((p) => (p as { text: string }).text).join("\n") : parts });
  }
  return out;
}

export function toOpenAiTools(tools: ATool[]): OaTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.input_schema },
  }));
}

/**
 * Tool history as plain text, for the final structured call (Groq does not combine structured
 * outputs with tool use, so that call carries no tools and no tool messages).
 */
export function flattenToolHistory(messages: AMessage[]): AMessage[] {
  const names = new Map<string, string>();
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    const blocks = m.content as Block[];
    if (!blocks.some((b) => b.type === "tool_use" || b.type === "tool_result")) return m;
    const content = blocks.map((b): Block => {
      if (b.type === "tool_use") {
        names.set(b.id, b.name);
        return { type: "text", text: `[called tool ${b.name} with ${JSON.stringify(b.input ?? {})}]` };
      }
      if (b.type === "tool_result") {
        return { type: "text", text: `<tool_result tool="${names.get(b.tool_use_id) ?? "unknown"}">\n${toolResultText(b)}\n</tool_result>` };
      }
      return b;
    });
    return { role: m.role, content };
  });
}

export const MAX_IMAGES = 3;
export const MAX_IMAGE_REQUEST_BYTES = 20 * 1024 * 1024;

/** Enforce the provider's image limits before sending (client and capture already downscale/cap). */
export function assertImageLimits(messages: AMessage[]): void {
  const images = messages.flatMap((m) => blocksOf(m).filter((b): b is ImageBlock => b.type === "image"));
  if (images.length > MAX_IMAGES) throw new AiError("image_too_large", `at most ${MAX_IMAGES} images per request`);
  const bytes = images.reduce((n, b) => n + imageUrl(b).length, 0);
  if (bytes > MAX_IMAGE_REQUEST_BYTES) throw new AiError("image_too_large", "images exceed the request size limit");
}

interface OaResponse {
  id?: string;
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null; tool_calls?: OaToolCall[] | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

/** A chat-completions response → an Anthropic-shaped message. Unparseable tool arguments → bad_output. */
export function fromOpenAi(res: OaResponse, model: string): AResult {
  const choice = res.choices?.[0];
  if (!choice) throw new AiError("no_output", "no choices in the response");
  const msg = choice.message ?? {};
  const content: (TextBlock | ToolUseBlock)[] = [];
  const text = stripThink(msg.content ?? "");
  if (text) content.push({ type: "text", text });
  const calls = msg.tool_calls ?? [];
  for (const c of calls) {
    let input: unknown;
    try {
      input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      throw new AiError("bad_output", `tool ${c.function.name} arguments were not JSON`);
    }
    content.push({ type: "tool_use", id: c.id, name: c.function.name, input });
  }
  const stop: StopReason = msg.refusal
    ? "refusal"
    : calls.length
    ? "tool_use"
    : choice.finish_reason === "length"
    ? "max_tokens"
    : choice.finish_reason === "content_filter"
    ? "refusal"
    : "end_turn";
  return {
    id: res.id ?? "",
    type: "message",
    role: "assistant",
    model: res.model ?? model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0 },
  };
}

// ---- the client --------------------------------------------------------------------------------

export interface CompatClient {
  baseUrl: string;
  apiKey: string;
  maxCompletionTokens: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** transport retries on 429 / 5xx / network (in addition to the first try) */
  maxRetries?: number;
}

/** Longest Retry-After we wait out inside one edge-function request. */
const MAX_WAIT_S = 8;

export const FINAL_JSON_NUDGE =
  "Now give your final answer as one JSON object that matches the required schema, using the tool results above. No other text.";

/** Model-family request knobs (reasoning visibility and effort). */
export function modelParams(model: string, effort: CompatCallOptions["effort"]): Record<string, unknown> {
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: effort ?? "low", include_reasoning: false };
  if (/qwen3/i.test(model)) return { reasoning_format: "hidden" };
  return {};
}

async function post(c: CompatClient, body: Record<string, unknown>): Promise<OaResponse> {
  const f = c.fetch ?? fetch;
  const sleep = c.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = c.maxRetries ?? 2;
  for (let attempt = 0;; attempt++) {
    let res: Response;
    try {
      res = await f(`${c.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(c.timeoutMs ?? 90_000),
      });
    } catch (e) {
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new ProviderError(0, `provider unreachable: ${(e as Error).message ?? e}`);
    }
    if (res.ok) return (await res.json()) as OaResponse;
    const raw = await res.text().catch(() => "");
    let err: { message?: string; code?: string } = {};
    try {
      err = (JSON.parse(raw) as { error?: typeof err }).error ?? {};
    } catch { /* not JSON */ }
    const retryAfter = Number(res.headers.get("retry-after"));
    const e = new ProviderError(res.status, err.message ?? `provider error ${res.status}`, err.code, Number.isFinite(retryAfter) ? retryAfter : undefined);
    const transient = res.status === 429 || res.status === 498 || res.status >= 500;
    const waitS = e.retryAfterS ?? 0.5 * 2 ** attempt;
    if (transient && attempt < retries && waitS <= MAX_WAIT_S) {
      await sleep(waitS * 1000);
      continue;
    }
    throw e;
  }
}

/** Groq's 400 for a generation that failed its own schema / tool-call validation. */
const isGenerationFailure = (e: unknown) =>
  e instanceof ProviderError && e.status === 400 &&
  (e.errorCode === "json_validate_failed" || e.errorCode === "tool_use_failed" || /does not match the expected schema/i.test(e.message));

function baseBody(c: CompatClient, o: CompatCallOptions, messages: AMessage[]): Record<string, unknown> {
  return {
    model: o.model,
    messages: toOpenAiMessages(o.system, messages),
    max_completion_tokens: Math.min(o.maxTokens ?? 8000, c.maxCompletionTokens),
    ...modelParams(o.model, o.effort),
  };
}

const textOf = (r: AResult) => r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

/** The JSON value in `text` if it validates against the strict schema, else the reason it does not. */
function checkJson(text: string, strict: Schema): { ok: true; value: unknown } | { ok: false; why: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, why: "not valid JSON" };
  }
  const errors = validate(strict, value);
  return errors.length ? { ok: false, why: errors.slice(0, 3).join("; ") } : { ok: true, value };
}

function jsonResult(r: AResult, schema: Schema, value: unknown): AResult {
  return { ...r, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(normaliseNulls(schema, value)) }] };
}

/** One structured answer: strict json_schema, validated in code, retried once on invalid output. */
async function structuredCall(c: CompatClient, o: CompatCallOptions, messages: AMessage[]): Promise<AResult> {
  const strict = strictify(o.schema);
  const body = { ...baseBody(c, o, messages), response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: strict } } };
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: AResult;
    try {
      r = fromOpenAi(await post(c, body), o.model);
    } catch (e) {
      if (isGenerationFailure(e) || (e instanceof AiError && e.code === "bad_output")) {
        why = (e as Error).message;
        continue;
      }
      throw e;
    }
    if (r.stop_reason !== "end_turn") return r; // refusal / truncation: parseJson reports it
    const checked = checkJson(textOf(r), strict);
    if (checked.ok) return jsonResult(r, o.schema, checked.value);
    why = checked.why;
  }
  throw new AiError("bad_output", `structured output failed validation twice: ${why}`);
}

/**
 * The openai_compat counterpart of claude.ts call(). With tools: a tool round without
 * response_format; a tool call comes back as tool_use; a plain answer is accepted if it already
 * validates, else a final strict-JSON call with no tools produces it. Without tools: one
 * structured call.
 */
export async function compatCall(c: CompatClient, o: CompatCallOptions): Promise<AResult> {
  assertImageLimits(o.messages);
  if (!o.tools?.length) return await structuredCall(c, o, o.messages);

  const body = { ...baseBody(c, o, o.messages), tools: toOpenAiTools(o.tools), tool_choice: "auto" };
  let first: AResult | undefined;
  for (let attempt = 0; attempt < 2 && !first; attempt++) {
    try {
      first = fromOpenAi(await post(c, body), o.model);
    } catch (e) {
      if (attempt === 0 && (isGenerationFailure(e) || (e instanceof AiError && e.code === "bad_output"))) continue;
      throw e;
    }
  }
  if (first!.stop_reason !== "end_turn") return first!;
  const draft = textOf(first!);
  const strict = strictify(o.schema);
  const early = draft ? checkJson(draft, strict) : null;
  if (early?.ok) return jsonResult(first!, o.schema, early.value);
  const final: AMessage[] = [
    ...flattenToolHistory(o.messages),
    ...(draft ? [{ role: "assistant" as const, content: draft }] : []),
    { role: "user", content: FINAL_JSON_NUDGE },
  ];
  return await structuredCall(c, o, final);
}
