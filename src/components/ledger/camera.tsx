import type { CameraStatus } from "@/lib/camera";
import { cn } from "@/lib/cn";

/** Yellow corner brackets over the viewfinder. */
export function ReceiptFrame({ className, corner = 30 }: { className?: string; corner?: number }) {
  const c = "absolute border-highlight";
  const size = { width: corner, height: corner };
  return (
    <div aria-hidden className={cn("pointer-events-none relative h-[62%] w-[66%]", className)}>
      <span style={size} className={cn(c, "top-0 left-0 rounded-tl-[6px] border-t-[3px] border-l-[3px]")} />
      <span style={size} className={cn(c, "top-0 right-0 rounded-tr-[6px] border-t-[3px] border-r-[3px]")} />
      <span style={size} className={cn(c, "bottom-0 left-0 rounded-bl-[6px] border-b-[3px] border-l-[3px]")} />
      <span style={size} className={cn(c, "right-0 bottom-0 rounded-br-[6px] border-r-[3px] border-b-[3px]")} />
    </div>
  );
}

/**
 * What the viewfinder shows until frames arrive: never a black box. Asking →
 * one button that opens the browser's prompt; denied → how to turn it back on;
 * no camera → a photo instead. Every state keeps "Choose a photo instead". `cloud`: the photo
 * is uploaded and read by M8's AI (add sheet, signed in and online), so the copy says so.
 */
export function CameraGate({ status, onAllow, onChoose, cloud = false }: { status: CameraStatus; onAllow: () => void; onChoose: () => void; /** the photo is uploaded and read by M8's AI */ cloud?: boolean }) {
  if (status === "live") return null;
  const btn = "flex min-h-11 items-center justify-center rounded-md px-4 text-[13.5px] font-semibold active:opacity-80";
  const title =
    status === "denied" ? "Camera access is off" : status === "none" ? "No camera here" : status === "waiting" ? "Allow camera access" : "Use the camera to read receipts";
  const body =
    status === "denied"
      ? "Tap the lock or ⓘ next to the address, set Camera to Allow, then reload this page. Or choose a photo."
      : status === "none"
        ? "This browser or device can’t open a camera. Choose a photo of the receipt."
        : status === "waiting"
          ? "Your browser is asking. Tap Allow to see the viewfinder."
          : cloud
            ? "The photo is uploaded to your account and M8 reads it with AI. You can undo anything it files."
            : "Ledger reads the photo on your phone. Nothing is recorded until you save.";
  return (
    <div className="relative flex max-w-[280px] flex-col items-center gap-3 px-4 text-center" role="status">
      <span className="text-[15px] font-semibold text-cam-ink">{title}</span>
      <p className="text-[13px] leading-[1.5] text-cam-ink/80">{body}</p>
      {status === "ask" ? (
        <button type="button" onClick={onAllow} className={cn(btn, "bg-cam-ink text-cam")}>
          Allow camera access
        </button>
      ) : null}
      <button type="button" onClick={onChoose} className={cn(btn, status === "ask" || status === "waiting" ? "border border-cam-line text-cam-ink" : "bg-cam-ink text-cam")}>
        Choose a photo instead
      </button>
    </div>
  );
}
