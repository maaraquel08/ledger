// Which AI provider and models the edge functions use, from the environment. Pure module (no Deno
// globals): the caller passes the env, so vitest can import it.
//
//   AI_PROVIDER=anthropic       Claude via the Anthropic SDK (ANTHROPIC_API_KEY)
//   AI_PROVIDER=openai_compat   any OpenAI-compatible chat-completions API (AI_BASE_URL, AI_API_KEY);
//                               defaults target Groq's free tier
// Unset: anthropic when ANTHROPIC_API_KEY is set, else openai_compat when AI_API_KEY is set, else
// null (the functions answer 503 ai_unconfigured).

export type Env = Record<string, string | undefined>;

/** The jobs the functions ask a model to do. */
export type Job = "parseText" | "parsePhoto" | "chat" | "daily" | "alert" | "review";
/** Model roles for openai_compat, one env var each. */
export type Role = "parse" | "vision" | "chat" | "summary";

/** Claude models per job (spec 2026-10-29 / D-0013): Haiku for the small jobs, Sonnet for the rest. */
export const ANTHROPIC_MODELS: Record<Job, string> = {
  parseText: "claude-haiku-5-5",
  parsePhoto: "claude-sonnet-5-5",
  chat: "claude-sonnet-5-5",
  daily: "claude-haiku-5-5",
  alert: "claude-haiku-5-5",
  review: "claude-sonnet-5-5",
};

/** Job → role. Every narrative (daily, alert, weekly/monthly review) is a summary job. */
export const JOB_ROLE: Record<Job, Role> = {
  parseText: "parse",
  parsePhoto: "vision",
  chat: "chat",
  daily: "summary",
  alert: "summary",
  review: "summary",
};

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Groq model IDs, checked against console.groq.com/docs (models, structured-outputs, vision) 2026-10-29. */
export const COMPAT_DEFAULT_MODELS: Record<Role, string> = {
  parse: "openai/gpt-oss-20b",
  vision: "qwen/qwen3.8-27b",
  chat: "openai/gpt-oss-120b",
  summary: "openai/gpt-oss-120b",
};

/** Completion cap for openai_compat. Groq's per-minute token budget is small on the free tier. */
export const COMPAT_DEFAULT_MAX_TOKENS = 4096;

export const STT_MODELS = { groq: "whisper-large-v3", openai: "gpt-4o-mini-transcribe" } as const;

export type AiConfig =
  | { provider: "anthropic"; apiKey: string; models: Record<Job, string> }
  | {
    provider: "openai_compat";
    baseUrl: string;
    apiKey: string;
    models: Record<Job, string>;
    maxCompletionTokens: number;
  };

export interface SttConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const get = (env: Env, key: string): string | undefined => {
  const v = env[key]?.trim();
  return v ? v : undefined;
};

/** The provider to use, or null when it is not configured. */
export function resolveProvider(env: Env): "anthropic" | "openai_compat" | null {
  const explicit = get(env, "AI_PROVIDER")?.toLowerCase();
  if (explicit === "anthropic") return get(env, "ANTHROPIC_API_KEY") ? "anthropic" : null;
  if (explicit === "openai_compat") return get(env, "AI_API_KEY") ? "openai_compat" : null;
  if (explicit) return null; // an unknown value is a misconfiguration, not a silent fallback
  if (get(env, "ANTHROPIC_API_KEY")) return "anthropic";
  if (get(env, "AI_API_KEY")) return "openai_compat";
  return null;
}

export function aiConfig(env: Env): AiConfig | null {
  const provider = resolveProvider(env);
  if (provider === "anthropic") return { provider, apiKey: get(env, "ANTHROPIC_API_KEY")!, models: { ...ANTHROPIC_MODELS } };
  if (provider !== "openai_compat") return null;
  const role: Record<Role, string> = {
    parse: get(env, "AI_MODEL_PARSE") ?? COMPAT_DEFAULT_MODELS.parse,
    vision: get(env, "AI_MODEL_VISION") ?? COMPAT_DEFAULT_MODELS.vision,
    chat: get(env, "AI_MODEL_CHAT") ?? COMPAT_DEFAULT_MODELS.chat,
    summary: get(env, "AI_MODEL_SUMMARY") ?? COMPAT_DEFAULT_MODELS.summary,
  };
  const models = Object.fromEntries(Object.entries(JOB_ROLE).map(([job, r]) => [job, role[r]])) as Record<Job, string>;
  const cap = Number(get(env, "AI_MAX_TOKENS"));
  return {
    provider,
    baseUrl: (get(env, "AI_BASE_URL") ?? GROQ_BASE_URL).replace(/\/+$/, ""),
    apiKey: get(env, "AI_API_KEY")!,
    models,
    maxCompletionTokens: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : COMPAT_DEFAULT_MAX_TOKENS,
  };
}

/**
 * Speech to text. Defaults to Groq Whisper when the AI provider is openai_compat (one key), else
 * OpenAI. STT_BASE_URL / STT_API_KEY / STT_MODEL override each part. Null when there is no key.
 */
export function sttConfig(env: Env): SttConfig | null {
  const explicitBase = get(env, "STT_BASE_URL");
  const groqDefault = resolveProvider(env) === "openai_compat";
  const baseUrl = (explicitBase ?? (groqDefault ? GROQ_BASE_URL : OPENAI_BASE_URL)).replace(/\/+$/, "");
  const apiKey = get(env, "STT_API_KEY") ??
    (explicitBase
      ? (get(env, "AI_API_KEY") ?? get(env, "OPENAI_API_KEY"))
      : groqDefault
      ? get(env, "AI_API_KEY")
      : get(env, "OPENAI_API_KEY"));
  if (!apiKey) return null;
  const model = get(env, "STT_MODEL") ?? (/(^|\.)openai\.com(\/|$)/.test(hostOf(baseUrl)) ? STT_MODELS.openai : STT_MODELS.groq);
  return { baseUrl, apiKey, model };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host + "/";
  } catch {
    return url;
  }
}
