/**
 * On-device text recognition for receipt photos (Tesseract.js). The engine
 * and English model load from a CDN on first use and are cached by the
 * browser; nothing about the photo leaves the phone.
 */

export interface OcrLine {
  text: string;
  /** box in source-image pixels */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  confidence: number;
}

type Worker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
let worker: Promise<Worker> | null = null;
let onProgress: ((p: number) => void) | null = null;

function getWorker() {
  worker ??= import("tesseract.js").then(({ createWorker }) =>
    createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") onProgress?.(m.progress);
      },
    }),
  );
  return worker;
}

/** Start loading the engine early (e.g. when the camera opens). */
export function warmUp() {
  void getWorker().catch(() => {
    worker = null;
  });
}

export async function recognize(image: HTMLCanvasElement | HTMLImageElement | Blob, progress?: (p: number) => void): Promise<OcrResult> {
  const w = await getWorker().catch((e) => {
    worker = null;
    throw e;
  });
  onProgress = progress ?? null;
  try {
    const { data } = await w.recognize(image, {}, { text: true, blocks: true });
    const lines: OcrLine[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ text: l.text.trim(), bbox: l.bbox });
    return { text: data.text, lines, confidence: data.confidence };
  } finally {
    onProgress = null;
  }
}
