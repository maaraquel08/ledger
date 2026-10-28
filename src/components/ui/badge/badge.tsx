import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * The tinted tones share one formula, so a tone is three custom properties:
 *   --badge-tone  the hue
 *   --badge-wash  how much of it lands in the fill
 *   --badge-ink   how far the label is pulled from --fg toward the hue
 *
 * Same shape as the banner's wash, at heavier percentages — a badge is small
 * enough that the banner's 7% would read as an off-white smudge.
 */
const mix = [
  "bg-[color-mix(in_oklab,var(--badge-tone)_var(--badge-wash),var(--color-bg))]",
  "text-[color-mix(in_oklab,var(--badge-tone)_var(--badge-ink),var(--color-fg))]",
].join(" ");

/**
 * Wash and ink are tuned per tone, not shared. Warning washes hardest (15%)
 * and inks lightest (50%) because yellow carries the least weight of the four
 * at any given percentage; green needs 14% where blue and red need 12%.
 * Flattening these to one pair would make warning the faintest chip on screen.
 */
const tones: Record<Tone, string> = {
  // neutral is not a tint of anything — it is the absence of a state, so it
  // takes the plain surface rather than a 0% mix of some arbitrary hue
  neutral: "bg-surface text-fg-muted",
  info: `[--badge-tone:var(--color-info)] [--badge-wash:12%] [--badge-ink:55%] ${mix}`,
  success: `[--badge-tone:var(--color-success)] [--badge-wash:14%] [--badge-ink:55%] ${mix}`,
  warning: `[--badge-tone:var(--color-warning)] [--badge-wash:15%] [--badge-ink:50%] ${mix}`,
  danger: `[--badge-tone:var(--color-danger)] [--badge-wash:12%] [--badge-ink:50%] ${mix}`,
};

export interface BadgeProps extends React.ComponentPropsWithRef<"span"> {
  tone?: Tone;
  /**
   * Optional leading glyph. Study 3A is deliberately glyphless — the fill
   * carries the state on its own — so this stays empty unless a badge has to
   * survive greyscale, or sits somewhere the tint alone is ambiguous.
   *
   * The slot fixes the size and stops the icon shrinking, so a 16px or 24px
   * source glyph still lands at the label's optical weight. It inherits the
   * tone's ink through currentColor.
   */
  icon?: React.ReactNode;
}

export function Badge({
  tone = "neutral",
  icon,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-[5px] rounded-sm px-[11px] text-xs font-semibold",
        // 2px in sc1m, which is the radius the study was drawn at — taken from
        // the token rather than hardcoded so a rounder brand stays rounder
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden
          className="grid size-3 shrink-0 place-items-center [&>*]:size-full"
        >
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
