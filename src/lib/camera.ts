import * as React from "react";

/*
 * The receipt camera, shared by the full-screen scanner (/scan) and the
 * Camera mode of the Add entry sheet: the back camera stream, a still
 * capture, a photo-library fallback and the torch.
 */

export function useCamera() {
  const video = React.useRef<HTMLVideoElement>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [torch, setTorch] = React.useState<boolean | null>(null); // null = unsupported

  React.useEffect(() => {
    let alive = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can’t open the camera. Choose a photo instead.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
        }
        const caps = s.getVideoTracks()[0]?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        if (caps?.torch) setTorch(false);
      })
      .catch((e: DOMException) =>
        setError(
          e.name === "NotAllowedError"
            ? "Camera access is off. Allow it in your browser’s site settings, or choose a photo."
            : "No camera here. Choose a photo of the receipt instead.",
        ),
      );
    return () => {
      alive = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /** The current frame as a canvas, or null before the stream is live. */
  const snap = React.useCallback(() => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    return c;
  }, []);

  const flash = React.useCallback(() => {
    const t = stream.current?.getVideoTracks()[0];
    if (!t || torch === null) return;
    const next = !torch;
    t.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .then(() => setTorch(next))
      .catch(() => setTorch(null));
  }, [torch]);

  return { video, error, torch, snap, flash };
}

/** A picked photo drawn onto a canvas, ready for the reader. */
export function fileToCanvas(f: File, done: (c: HTMLCanvasElement) => void) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    done(c);
  };
  img.src = URL.createObjectURL(f);
}
