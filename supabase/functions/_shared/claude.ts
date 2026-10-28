// Model calls (Deno). One interface — aiClient / call / structured / parseJson / aiFailure — over
// two providers, chosen from the environment (ai_config.ts):
//   anthropic       official SDK. claude-haiku-5-5: text parsing, daily one-liner, alert notes;
//                   claude-sonnet-5-5: receipt vision, chat, weekly/monthly reviews (D-0013).
//                   Sonnet 5.5 requests opt into server-side refusal fallback ("default" routing).
//   openai_compat   fetch adapter (openai_compat.ts), Groq by default; per-role models from env.
// Messages are written in Anthropic shapes either way; the adapter translates them.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { type AiConfig, aiConfig, ANTHROPIC_MODELS, type Env, type Job } from "./ai_config.ts";
import { AiError, type AMessage, type ATool, compatCall, type CompatClient, providerFailure } from "./openai_compat.ts";

export { AiError };

const ENV_KEYS = [
  "AI_PROVIDER", "ANTHROPIC_API_KEY", "AI_BASE_URL", "AI_API_KEY", "AI_MAX_TOKENS",
  "AI_MODEL_PARSE", "AI_MODEL_VISION", "AI_MODEL_CHAT", "AI_MODEL_SUMMARY",
  "STT_BASE_URL", "STT_API_KEY", "STT_MODEL", "OPENAI_API_KEY",
];
export const readEnv = (): Env => Object.fromEntries(ENV_KEYS.map((k) => [k, Deno.env.get(k)]));

const CONFIG: AiConfig | null = aiConfig(readEnv());

/** Model per job for the configured provider (Claude IDs when unconfigured; then nothing is called). */
export const MODEL: Readonly<Record<Job, string>> = CONFIG?.models ?? ANTHROPIC_MODELS;

export type Beta = typeof Anthropic.Beta;
export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type TextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;
export type Message = Anthropic.Beta.Messages.BetaMessage;
export type ToolParam = Anthropic.Beta.Messages.BetaTool;
export type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;

export type AiClient =
  | { provider: "anthropic"; sdk: Anthropic }
  | { provider: "openai_compat"; compat: CompatClient };

/** The configured client, or null (→ 503 ai_unconfigured). */
export function aiClient(): AiClient | null {
  if (!CONFIG) return null;
  if (CONFIG.provider === "anthropic") return { provider: "anthropic", sdk: new Anthropic({ apiKey: CONFIG.apiKey, maxRetries: 2, timeout: 90_000 }) };
  return { provider: "openai_compat", compat: { baseUrl: CONFIG.baseUrl, apiKey: CONFIG.apiKey, maxCompletionTokens: CONFIG.maxCompletionTokens } };
}

/** System prompt as a stable cached prefix, optionally followed by a cached knowledge block. */
export function system(stable: string, cachedExtra?: string): TextBlockParam[] {
  const blocks: TextBlockParam[] = [{ type: "text", text: stable }];
  if (cachedExtra) blocks.push({ type: "text", text: cachedExtra });
  blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
  return blocks;
}

export interface CallOptions {
  model: string;
  system: TextBlockParam[];
  messages: MessageParam[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  tools?: ToolParam[];
}

export async function call(client: AiClient, o: CallOptions): Promise<Message> {
  if (client.provider === "openai_compat") {
    const m = await compatCall(client.compat, {
      model: o.model,
      system: o.system,
      messages: o.messages as unknown as AMessage[],
      schema: o.schema,
      effort: o.effort,
      maxTokens: o.maxTokens,
      tools: o.tools as unknown as ATool[] | undefined,
    });
    return m as unknown as Message;
  }
  const sonnet = o.model.startsWith("claude-sonnet-5-5");
  return await client.sdk.beta.messages.create({
    model: o.model,
    max_tokens: o.maxTokens ?? 8000,
    system: o.system,
    messages: o.messages,
    ...(o.tools ? { tools: o.tools } : {}),
    output_config: { effort: o.effort ?? "low", format: { type: "json_schema", schema: o.schema } },
    ...(sonnet ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
}

/** The JSON object of a final (non-tool) structured answer. */
export function parseJson<T>(m: Message): T {
  if (m.stop_reason === "refusal") throw new AiError("refused");
  if (m.stop_reason === "max_tokens") throw new AiError("truncated");
  const text = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  if (!text.trim()) throw new AiError("no_output");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError("bad_output", "structured output was not valid JSON");
  }
}

export async function structured<T>(client: AiClient, o: CallOptions): Promise<{ value: T; message: Message }> {
  const message = await call(client, o);
  return { value: parseJson<T>(message), message };
}

/** Map SDK / provider / AiError failures to an HTTP status + code for the client. */
export function aiFailure(e: unknown): { status: number; code: string } {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { status: 503, code: "ai_unconfigured" };
  if (e instanceof Anthropic.RateLimitError) return { status: 503, code: "ai_busy" };
  if (e instanceof Anthropic.BadRequestError) return { status: 502, code: "ai_bad_request" };
  if (e instanceof Anthropic.APIConnectionError) return { status: 503, code: "ai_unreachable" };
  if (e instanceof Anthropic.APIError) return { status: 502, code: "ai_error" };
  return providerFailure(e) ?? { status: 500, code: "internal" };
}

export { Anthropic };
