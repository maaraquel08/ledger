// Speech to text (Deno). Claude does not take audio, so voice clips are transcribed first by a
// pluggable provider (spec 2026-10-29). First provider: OpenAI `gpt-4o-mini-transcribe`, no
// language hint (the Owner speaks Taglish).

export interface Transcriber {
  name: string;
  transcribe(audio: Blob, filename: string): Promise<string>;
}

export class SttError extends Error {}

export function openAiTranscriber(): Transcriber | null {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const model = "gpt-4o-mini-transcribe";
  return {
    name: `openai:${model}`,
    async transcribe(audio, filename) {
      const form = new FormData();
      form.append("model", model);
      form.append("response_format", "json");
      form.append("file", audio, filename);
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) throw new SttError(`transcription failed: ${res.status}`);
      const out = (await res.json()) as { text?: string };
      return (out.text ?? "").trim();
    },
  };
}
