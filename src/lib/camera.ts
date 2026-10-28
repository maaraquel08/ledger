import * as React from "react";

/*
 * The receipt camera, shared by the full-screen scanner (/scan) and the
 * Camera mode of the Add entry sheet: the back camera stream, a still
 * capture, a photo-library fallback and the torch.
 */

/**
 * Where the camera stands. "ask": the browser hasn't been asked yet (or can't say),
 * so the screen offers a button instead of a black viewfinder; "waiting": the
 * browser's own prompt is up; "live": frames are coming; "denied": the Owner (or
 * a setting) said no; "none": no camera or no API here.
 */
export type CameraStatus = "ask" | "waiting" | "live" | "denied" | "none";

export function useCamera() {
  const video = React.useRef<HTMLVideoElement>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const alive = React.useRef(true);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const [status, setStatus] = React.useState<CameraStatus>(supported ? "ask" : "none");
  const [torch, setTorch] = React.useState<boolean | null>(null); // null = unsupported

  /** Ask for the camera; the browser shows its prompt the first time. */
  const start = React.useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) return setStatus("none");
    setStatus("waiting");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (!alive.current) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
        }
        setStatus("live");
        const caps = s.getVideoTracks()[0]?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        if (caps?.torch) setTorch(false);
      })
      .catch((e: DOMException) => {
        if (alive.current) setStatus(e.name === "NotAllowedError" || e.name === "SecurityError" ? "denied" : "none");
      });
  }, []);

  React.useEffect(() => {
    alive.current = true;
    if (supported) {
      // already allowed: open straight away; already blocked: say so; otherwise wait for the button
      const perms = navigator.permissions?.query?.({ name: "camera" as PermissionName });
      if (perms)
        perms.then(
          (p) => {
            if (!alive.current) return;
            if (p.state === "granted") start();
            else if (p.state === "denied") setStatus("denied");
          },
          () => {},
        );
    }
    return () => {
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [supported, start]);

  /** Copy for a camera that isn't live, or null when it is (or is about to be). */
  const error =
    status === "denied"
      ? "Camera access is off. Allow it in your browser’s site settings, or choose a photo."
      : status === "none"
        ? "No camera here. Choose a photo of the receipt instead."
        : null;

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

  return { video, status, start, error, torch, snap, flash };
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
