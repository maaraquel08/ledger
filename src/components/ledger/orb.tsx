import * as React from "react";
import { cn } from "@/lib/cn";

/* The yellow hold-to-talk orb, used by the Add entry sheet. */

interface OrbHandlers {
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onKeyUp: (e: React.KeyboardEvent) => void;
}

const RING_NORMAL =
  "shadow-[0_0_0_16px_color-mix(in_oklab,var(--color-highlight)_18%,var(--color-bg)),0_0_0_32px_color-mix(in_oklab,var(--color-highlight)_7%,var(--color-bg))]";
const RING_LOUD =
  "shadow-[0_0_0_16px_color-mix(in_oklab,var(--color-highlight)_38%,var(--color-bg)),0_0_0_32px_color-mix(in_oklab,var(--color-highlight)_18%,var(--color-bg))]";
const RING_OFF = "shadow-[0_0_0_16px_var(--color-surface),0_0_0_32px_color-mix(in_oklab,var(--color-surface)_50%,var(--color-bg))]";

/** The yellow orb: press and hold to talk. Yellow means "add" in Ledger. */
export function Orb({
  size,
  tone,
  children,
  label,
  onDown,
  onMove,
  onUp,
  onKeyDown,
  onKeyUp,
}: OrbHandlers & { size: number; tone: "normal" | "loud" | "off" | "quiet"; children: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{ width: size, height: size }}
      className={cn(
        "flex flex-none touch-none items-center justify-center rounded-full select-none [-webkit-touch-callout:none]",
        "transition-[box-shadow,background-color] duration-200 ease-out-quad motion-safe:transition-[width,height,box-shadow,background-color,scale] motion-safe:active:scale-[0.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        tone === "off" ? "bg-fill" : "bg-highlight text-highlight-fg",
        tone === "off" ? RING_OFF : tone === "loud" ? RING_LOUD : tone === "normal" ? RING_NORMAL : "",
      )}
    >
      {children}
    </button>
  );
}

