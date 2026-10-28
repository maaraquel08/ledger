import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "info" | "warning" | "success" | "danger";

/**
 * Flat wash: a borderless tint, a tone-coloured icon, and body copy in the
 * tone's own ink rather than muted grey. The whole block is the signal, so it
 * survives being skimmed at speed.
 *
 * Three values drive every tone, so a tone is a row in this table and nothing
 * else:
 *   --banner-tone  the hue
 *   --banner-wash  how much of it lands in the fill
 *   --banner-ink   how far the body copy is pulled from --fg toward the hue
 *
 * The wash and ink percentages differ per tone on purpose — they are not a
 * single number applied four times. Yellow carries far less weight than blue
 * at the same percentage, so warning washes harder (8%) and inks lighter
 * (45%) to land at the same perceived strength. Normalising these would make
 * the warning banner read as the weakest of the set.
 */
const tones: Record<Tone, string> = {
  info: "[--banner-tone:var(--color-info)] [--banner-wash:7%] [--banner-ink:55%]",
  warning:
    "[--banner-tone:var(--color-warning)] [--banner-wash:8%] [--banner-ink:45%]",
  success:
    "[--banner-tone:var(--color-success)] [--banner-wash:7%] [--banner-ink:50%]",
  danger:
    "[--banner-tone:var(--color-danger)] [--banner-wash:7%] [--banner-ink:50%]",
};

/** Spoken prefix for the icon, which is decorative to a screen reader. */
const toneLabels: Record<Tone, string> = {
  info: "Note",
  warning: "Warning",
  success: "Success",
  danger: "Error",
};

/**
 * Phosphor `fill` weight, path data verbatim from @phosphor-icons/core — see
 * /docs/foundations/icons. Inlined rather than imported: the icon package
 * ships its React icons as client components, and Banner is deliberately
 * server-safe, so importing one would force the whole banner into the client
 * bundle for a static glyph.
 *
 * The counters (the dot of the info "i", the bar of the warning) are real
 * holes in Phosphor's path rather than shapes painted in the background
 * colour, so they show the banner's own wash at any tint, in either theme,
 * under any brand — nothing to keep in sync.
 */
const icons: Record<Tone, string> = {
  /* phosphor: info fill */
  info: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-4,48a12,12,0,1,1-12,12A12,12,0,0,1,124,72Zm12,112a16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40a8,8,0,0,1,0,16Z",
  /* phosphor: warning fill */
  warning:
    "M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z",
  /* phosphor: check-circle fill */
  success:
    "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z",
  /* phosphor: x-circle fill */
  danger:
    "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
};

export interface BannerProps extends React.ComponentPropsWithRef<"div"> {
  tone?: Tone;
}

export function Banner({
  tone = "info",
  className,
  children,
  role,
  ...props
}: BannerProps) {
  return (
    <div
      // danger is the one tone that interrupts: an error the reader must hear
      // about now. The rest announce politely. Pass `role` to override.
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(
        "flex gap-[11px] rounded-lg px-4 py-[13px]",
        "[--banner-bg:color-mix(in_oklab,var(--banner-tone)_var(--banner-wash),var(--color-bg))]",
        "bg-(--banner-bg)",
        "text-[13.5px] leading-[1.6] text-pretty",
        "text-[color-mix(in_oklab,var(--banner-tone)_var(--banner-ink),var(--color-fg))]",
        tones[tone],
        className,
      )}
      {...props}
    >
      <svg
        aria-hidden
        viewBox="0 0 256 256"
        fill="currentColor"
        className="mt-[3px] size-[15px] shrink-0 text-(--banner-tone)"
      >
        <path d={icons[tone]} />
      </svg>
      {/* a div, never a p: MDX wraps multi-line JSX children in a paragraph of
          its own, and a <p> inside a <p> is unwrappable HTML — it fragments
          the subtree and fails hydration. */}
      <div>
        <span className="sr-only">{toneLabels[tone]}: </span>
        {children}
      </div>
    </div>
  );
}
