// Claude calls (Deno, official SDK). Models per spec 2026-10-29 / D-0013:
//   claude-haiku-5-5   text parsing, daily one-liner, alert notes
//   claude-sonnet-5-5  receipt vision, chat, weekly/monthly reviews
// Sonnet 5.5 requests opt into server-side refusal fallback ("default" routing).
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

export const MODEL = {
  parseText: "claude-haiku-5-5",
  parsePhoto: "claude-sonnet-5-5",
  chat: "claude-sonnet-5-5",
  daily: "claude-haiku-5-5",
  alert: "claude-haiku-5-5",
  review: "claude-sonnet-5-5",
} as const;

export type Beta = typeof Anthropic.Beta;
export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type TextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;
export type Message = Anthropic.Beta.Messages.BetaMessage;
export type ToolParam = Anthropic.Beta.Messages.BetaTool;
export type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;

export function anthropic(): Anthropic | null {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  return apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 }) : null;
}

/** Thrown for answers we cannot use (refusal, truncation, bad JSON). */
export class AiError extends Error {
  constructor(public code: "refused" | "truncated" | "bad_output" | "no_output", message?: string) {
    super(message ?? code);
  }
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

export async function call(client: Anthropic, o: CallOptions): Promise<Message> {
  const sonnet = o.model.startsWith("claude-sonnet-5-5");
  return await client.beta.messages.create({
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

export async function structured<T>(client: Anthropic, o: CallOptions): Promise<{ value: T; message: Message }> {
  const message = await call(client, o);
  return { value: parseJson<T>(message), message };
}

/** Map SDK / AiError failures to an HTTP status + code for the client. */
export function aiFailure(e: unknown): { status: number; code: string } {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { status: 503, code: "ai_unconfigured" };
  if (e instanceof Anthropic.RateLimitError) return { status: 503, code: "ai_busy" };
  if (e instanceof Anthropic.BadRequestError) return { status: 502, code: "ai_bad_request" };
  if (e instanceof Anthropic.APIConnectionError) return { status: 503, code: "ai_unreachable" };
  if (e instanceof Anthropic.APIError) return { status: 502, code: "ai_error" };
  if (e instanceof AiError) return { status: 502, code: `ai_${e.code}` };
  return { status: 500, code: "internal" };
}

export { Anthropic };
