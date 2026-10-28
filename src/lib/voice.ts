import * as React from "react";

/* The Web Speech API is not in lib.dom for every target; type what we use. */
interface RecResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecEvent {
  resultIndex: number;
  results: ArrayLike<RecResult>;
}
interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecCtor = new () => Rec;

const Recognition: RecCtor | undefined =
  typeof window === "undefined"
    ? undefined
    : ((window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecCtor }).webkitSpeechRecognition);

export const voiceSupported = !!Recognition;

export type VoiceError = "denied" | "no-speech" | "unsupported" | "network" | "other";

/**
 * Hold-to-talk. start() on press, finish() on release (resolves with the
 * final transcript via onDone), cancel() on slide-away. `heard` updates
 * live while listening so the sentence can be shown as it is spoken.
 */
export function useVoice({ onDone, onError }: { onDone: (text: string) => void; onError: (e: VoiceError, heard: string) => void }) {
  const rec = React.useRef<Rec | null>(null);
  const finalText = React.useRef("");
  const interimText = React.useRef("");
  const mode = React.useRef<"idle" | "listening" | "finishing" | "cancelled">("idle");
  const [heard, setHeard] = React.useState("");
  const cbs = React.useRef({ onDone, onError });
  React.useLayoutEffect(() => {
    cbs.current = { onDone, onError };
  });

  const start = React.useCallback(() => {
    if (!Recognition) {
      cbs.current.onError("unsupported", "");
      return false;
    }
    rec.current?.abort();
    const r = new Recognition();
    r.lang = "en-PH";
    r.continuous = true;
    r.interimResults = true;
    finalText.current = "";
    interimText.current = "";
    setHeard("");
    r.onresult = (e) => {
      let fin = "";
      let tmp = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript;
        else tmp += res[0].transcript;
      }
      finalText.current = fin;
      interimText.current = tmp;
      setHeard(`${fin}${tmp}`.trim());
    };
    r.onerror = (e) => {
      if (mode.current === "cancelled") return;
      mode.current = "idle";
      const heardNow = `${finalText.current}${interimText.current}`.trim();
      const kind: VoiceError =
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "denied"
          : e.error === "no-speech"
            ? "no-speech"
            : e.error === "network"
              ? "network"
              : e.error === "aborted"
                ? "no-speech"
                : "other";
      cbs.current.onError(kind, heardNow);
    };
    r.onend = () => {
      const was = mode.current;
      mode.current = "idle";
      if (was === "cancelled") return;
      const text = `${finalText.current}${interimText.current}`.trim();
      if (was === "finishing" || was === "listening") {
        if (text) cbs.current.onDone(text);
        else cbs.current.onError("no-speech", "");
      }
    };
    rec.current = r;
    mode.current = "listening";
    try {
      r.start();
    } catch {
      mode.current = "idle";
      cbs.current.onError("other", "");
      return false;
    }
    return true;
  }, []);

  const finish = React.useCallback(() => {
    if (mode.current !== "listening") return;
    mode.current = "finishing";
    rec.current?.stop();
  }, []);

  const cancel = React.useCallback(() => {
    mode.current = "cancelled";
    rec.current?.abort();
    setHeard("");
  }, []);

  React.useEffect(() => () => rec.current?.abort(), []);

  return { heard, start, finish, cancel };
}
