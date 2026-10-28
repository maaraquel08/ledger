// Speech to text (Deno). The parse models do not take audio, so voice clips are transcribed first
// by an OpenAI-compatible /audio/transcriptions endpoint (spec 2026-10-29). Groq Whisper
// (whisper-large-v3) when the AI provider is openai_compat, else OpenAI gpt-4o-mini-transcribe;
// STT_BASE_URL / STT_API_KEY / STT_MODEL override (ai_config.ts). No language hint: the Owner
// speaks Taglish.
import { sttConfig } from "./ai_config.ts";
import { readEnv } from "./claude.ts";

export interface Transcriber {
  name: string;
  transcribe(audio: Blob, filename: string): Promise<string>;
}

export class SttError extends Error {}

export function transcriber(): Transcriber | null {
  const cfg = sttConfig(readEnv());
  if (!cfg) return null;
  return {
    name: `${new URL(cfg.baseUrl).host}:${cfg.model}`,
    async transcribe(audio, filename) {
      const form = new FormData();
      form.append("model", cfg.model);
      form.append("response_format", "json");
      form.append("file", audio, filename);
      const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new SttError(`transcription failed: ${res.status}`);
      const out = (await res.json()) as { text?: string };
      return (out.text ?? "").trim();
    },
  };
}
