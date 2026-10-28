import * as React from "react";

/**
 * Cloud mode voice capture: the clip itself, recorded while the Owner holds the orb, so the
 * server can transcribe it (Claude doesn't take audio, D-0013). Runs beside the Web Speech
 * transcript, which stays the offline fallback.
 */
export const recorderSupported =
  typeof window !== "undefined" && "MediaRecorder" in window && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

type Live = { rec: MediaRecorder; stream: MediaStream; chunks: Blob[] };

const baseType = (t: string) => t.split(";")[0] || "audio/webm";
export const extFor = (t: string) => (baseType(t) === "audio/mp4" ? "m4a" : baseType(t) === "audio/ogg" ? "ogg" : "webm");

export function useRecorder() {
  const live = React.useRef<Live | null>(null);
  const starting = React.useRef<Promise<void> | null>(null);
  const gen = React.useRef(0); // a cancel while the microphone is still opening wins

  const release = (l: Live | null) => l?.stream.getTracks().forEach((t) => t.stop());

  const start = React.useCallback(() => {
    if (!recorderSupported) return;
    const g = ++gen.current;
    starting.current = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (g !== gen.current) return stream.getTracks().forEach((t) => t.stop());
        const rec = new MediaRecorder(stream);
        const l: Live = { rec, stream, chunks: [] };
        rec.ondataavailable = (e) => e.data.size && l.chunks.push(e.data);
        rec.start();
        live.current = l;
      } catch {
        live.current = null; // no microphone: the transcript path still runs
      }
    })();
  }, []);

  /** the clip, or null when nothing was recorded */
  const stop = React.useCallback(async (): Promise<Blob | null> => {
    await starting.current;
    const l = live.current;
    live.current = null;
    if (!l) return null;
    return new Promise((resolve) => {
      l.rec.onstop = () => {
        release(l);
        const type = baseType(l.rec.mimeType || l.chunks[0]?.type || "audio/webm");
        resolve(l.chunks.length ? new Blob(l.chunks, { type }) : null);
      };
      l.rec.stop();
    });
  }, []);

  const cancel = React.useCallback(() => {
    gen.current++;
    const l = live.current;
    live.current = null;
    if (l && l.rec.state !== "inactive") l.rec.stop();
    release(l);
  }, []);

  React.useEffect(() => cancel, [cancel]);
  return { start, stop, cancel };
}
