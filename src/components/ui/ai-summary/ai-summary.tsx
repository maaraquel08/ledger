"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * AI Summary — the banner that marks AI-authored copy.
 *
 * The summary sits on a painting. Each field is one gradient plus a handful
 * of colour masses pushed through a fractal-noise displacement warp, with a
 * grain pass on top — so a palette is a few hex values and three durations,
 * and nothing is ever re-rendered or fetched.
 *
 * A veil in `--fg` sits between the painting and the copy. It is what makes
 * the text legible, so it is per-palette rather than a constant: a hot field
 * needs a flat 72%, a deep one can be graded and let its top keep colour.
 *
 * The palettes are deliberately raw hex. They are paint, not semantics —
 * there is no brand meaning to inherit, and pinning them to tokens would make
 * every brand's field the same picture. Everything structural around them
 * (the veil, the copy, the radius, the accent in the marks) is tokens.
 */

type Mass = {
  /** centre [cx, cy] in the 680×500 view box */
  c: [number, number];
  /** radii [rx, ry] */
  r: [number, number];
  fill: string;
  /** opacity */
  o: number;
  /** SMIL drifts as [attribute, seconds, values] */
  anim?: [string, number, string][];
};

interface Field {
  gradient: { x1: number; y1: number; x2: number; y2: number };
  stops: [number, string][];
  warp: {
    freq: string;
    octaves: number;
    seed: number;
    blur: number;
    freqDur: number;
    freqValues: string;
    scale: number;
    scaleDur: number;
    scaleValues: string;
  };
  grain: {
    freq: number;
    octaves: number;
    seed: number;
    slope: number;
    opacity: number;
  };
  driftDur: number;
  veil: string;
  masses: Mass[];
}

export const aiSummaryPalettes = {
  ember: {
    gradient: { x1: 0, y1: 0, x2: 0.4, y2: 1 },
    stops: [[0, "#8c3a20"], [0.33, "#c1512a"], [0.67, "#e0975c"], [1, "#9c4430"]],
    warp: { freq: "0.010 0.022", octaves: 4, seed: 4, blur: 8,
      freqDur: 26, freqValues: "0.010 0.022; 0.016 0.014; 0.008 0.026; 0.010 0.022",
      scale: 140, scaleDur: 34, scaleValues: "140;180;112;140" },
    grain: { freq: 0.9, octaves: 3, seed: 15, slope: 0.16, opacity: 0.55 },
    driftDur: 38,
    veil: "color-mix(in oklab, var(--fg) 72%, transparent)",
    masses: [
      { c: [160, 70], r: [270, 74], fill: "#6f2a1a", o: 0.75, anim: [["cx", 29, "160;250;100;160"]] },
      { c: [520, 110], r: [240, 60], fill: "#e56c33", o: 0.7, anim: [["ry", 28, "60;90;48;60"]] },
      { c: [340, 60], r: [210, 32], fill: "#f7b96e", o: 0.72, anim: [["opacity", 25, "0.72;0.36;0.83;0.72"]] },
      { c: [120, 220], r: [250, 64], fill: "#8e3a5c", o: 0.66, anim: [["cx", 50, "120;210;60;120"]] },
      { c: [570, 260], r: [230, 54], fill: "#f7e0c6", o: 0.55, anim: [["ry", 43, "54;81;43;54"]] },
      { c: [300, 320], r: [290, 44], fill: "#b8452e", o: 0.62 },
      { c: [200, 420], r: [300, 72], fill: "#7c3320", o: 0.75, anim: [["cx", 71, "200;290;140;200"], ["opacity", 41, "0.75;0.38;0.86;0.75"]] },
      { c: [600, 450], r: [240, 56], fill: "#e0a06a", o: 0.6, anim: [["ry", 58, "56;84;45;56"]] },
      { c: [430, 190], r: [150, 20], fill: "#ffd79c", o: 0.62 },
    ],
  },
  tide: {
    gradient: { x1: 0, y1: 0, x2: 0.25, y2: 1 },
    stops: [[0, "#0f3660"], [0.33, "#1c5f9e"], [0.67, "#7fb6d8"], [1, "#2a5f8f"]],
    warp: { freq: "0.007 0.026", octaves: 5, seed: 9, blur: 6,
      freqDur: 31, freqValues: "0.007 0.026; 0.011 0.017; 0.006 0.030; 0.007 0.026",
      scale: 96, scaleDur: 39, scaleValues: "96;128;78;96" },
    grain: { freq: 0.85, octaves: 3, seed: 22, slope: 0.14, opacity: 0.5 },
    driftDur: 44,
    veil:
      "linear-gradient(to top, color-mix(in oklab, var(--fg) 92%, transparent) 0%, color-mix(in oklab, var(--fg) 72%, transparent) 48%, color-mix(in oklab, var(--fg) 46%, transparent) 100%)",
    masses: [
      { c: [140, 80], r: [280, 66], fill: "#08243f", o: 0.7, anim: [["cx", 33, "140;230;80;140"]] },
      { c: [540, 140], r: [250, 52], fill: "#2b82c4", o: 0.72, anim: [["ry", 30, "52;78;42;52"]] },
      { c: [320, 40], r: [220, 28], fill: "#a7d5e9", o: 0.62, anim: [["opacity", 27, "0.62;0.3;0.72;0.62"]] },
      { c: [100, 240], r: [260, 58], fill: "#1a4f8c", o: 0.72, anim: [["cx", 54, "100;190;50;100"]] },
      { c: [580, 280], r: [220, 46], fill: "#cdeaf8", o: 0.5, anim: [["ry", 47, "46;70;37;46"]] },
      { c: [280, 330], r: [300, 40], fill: "#ecd9ae", o: 0.45 },
      { c: [180, 430], r: [310, 68], fill: "#0b2c50", o: 0.78, anim: [["cx", 77, "180;270;120;180"], ["opacity", 45, "0.78;0.42;0.88;0.78"]] },
      { c: [610, 460], r: [250, 54], fill: "#5f95bd", o: 0.55, anim: [["ry", 62, "54;81;43;54"]] },
      { c: [400, 200], r: [160, 18], fill: "#f4f9fb", o: 0.5 },
    ],
  },
  moss: {
    gradient: { x1: 0, y1: 0, x2: 0.12, y2: 1 },
    stops: [[0, "#2c5038"], [0.33, "#4e7c48"], [0.67, "#a8ba78"], [1, "#3a6350"]],
    warp: { freq: "0.012 0.016", octaves: 4, seed: 17, blur: 9,
      freqDur: 35, freqValues: "0.012 0.016; 0.018 0.011; 0.009 0.021; 0.012 0.016",
      scale: 118, scaleDur: 46, scaleValues: "118;152;92;118" },
    grain: { freq: 0.95, octaves: 3, seed: 31, slope: 0.18, opacity: 0.6 },
    driftDur: 52,
    veil:
      "linear-gradient(200deg, color-mix(in oklab, var(--fg) 52%, transparent) 0%, color-mix(in oklab, var(--fg) 78%, transparent) 55%, color-mix(in oklab, var(--fg) 90%, transparent) 100%)",
    masses: [
      { c: [150, 60], r: [260, 70], fill: "#27452f", o: 0.76, anim: [["cx", 41, "150;240;90;150"]] },
      { c: [530, 130], r: [240, 56], fill: "#5f9450", o: 0.68, anim: [["ry", 37, "56;84;45;56"]] },
      { c: [330, 70], r: [200, 30], fill: "#d2da96", o: 0.6, anim: [["opacity", 33, "0.6;0.3;0.7;0.6"]] },
      { c: [110, 230], r: [250, 60], fill: "#356b6b", o: 0.64, anim: [["cx", 63, "110;200;60;110"]] },
      { c: [560, 270], r: [230, 50], fill: "#eee6c6", o: 0.48, anim: [["ry", 55, "50;75;40;50"]] },
      { c: [300, 320], r: [280, 42], fill: "#8c6f37", o: 0.55 },
      { c: [190, 425], r: [300, 70], fill: "#22402f", o: 0.78, anim: [["cx", 84, "190;280;130;190"], ["opacity", 51, "0.78;0.4;0.88;0.78"]] },
      { c: [600, 450], r: [240, 54], fill: "#6f8f6a", o: 0.6, anim: [["ry", 69, "54;81;43;54"]] },
      { c: [420, 185], r: [150, 18], fill: "#f3f1d6", o: 0.52 },
    ],
  },
  ink: {
    gradient: { x1: 0, y1: 0, x2: 0.3, y2: 1 },
    stops: [[0, "#0a0a0a"], [0.33, "#161310"], [0.67, "#241a12"], [1, "#0f0d0c"]],
    warp: { freq: "0.006 0.012", octaves: 3, seed: 3, blur: 12,
      freqDur: 44, freqValues: "0.006 0.012; 0.009 0.008; 0.005 0.015; 0.006 0.012",
      scale: 72, scaleDur: 56, scaleValues: "72;98;58;72" },
    grain: { freq: 0.8, octaves: 3, seed: 7, slope: 0.12, opacity: 0.45 },
    driftDur: 60,
    veil:
      "linear-gradient(200deg, color-mix(in oklab, var(--fg) 20%, transparent) 0%, color-mix(in oklab, var(--fg) 46%, transparent) 100%)",
    masses: [
      { c: [200, 120], r: [300, 90], fill: "#f05a1e", o: 0.5, anim: [["cx", 47, "200;280;150;200"], ["opacity", 39, "0.5;0.28;0.58;0.5"]] },
      { c: [560, 340], r: [280, 80], fill: "#8a3b12", o: 0.45, anim: [["ry", 53, "80;110;66;80"]] },
      { c: [340, 240], r: [220, 40], fill: "#ffb066", o: 0.3, anim: [["opacity", 61, "0.3;0.16;0.36;0.3"]] },
    ],
  },
  /**
   * Ledger: espresso field, gold masses — the brand's ink and yellow as
   * paint. Added locally; re-add this entry if the component is re-pulled.
   */
  ledger: {
    gradient: { x1: 0, y1: 0, x2: 0.3, y2: 1 },
    stops: [[0, "#15120c"], [0.33, "#252017"], [0.67, "#33291a"], [1, "#17130d"]],
    warp: { freq: "0.007 0.014", octaves: 3, seed: 11, blur: 11,
      freqDur: 42, freqValues: "0.007 0.014; 0.010 0.009; 0.006 0.017; 0.007 0.014",
      scale: 80, scaleDur: 54, scaleValues: "80;106;64;80" },
    grain: { freq: 0.8, octaves: 3, seed: 5, slope: 0.12, opacity: 0.45 },
    driftDur: 58,
    veil:
      "linear-gradient(200deg, color-mix(in oklab, var(--fg) 40%, transparent) 0%, color-mix(in oklab, var(--fg) 52%, transparent) 100%)",
    masses: [
      { c: [210, 110], r: [300, 88], fill: "#d9a400", o: 0.42, anim: [["cx", 49, "210;290;160;210"], ["opacity", 37, "0.42;0.24;0.5;0.42"]] },
      { c: [560, 330], r: [280, 80], fill: "#8a7000", o: 0.5, anim: [["ry", 55, "80;108;64;80"]] },
      { c: [360, 230], r: [220, 38], fill: "#fcc305", o: 0.24, anim: [["opacity", 63, "0.24;0.12;0.3;0.24"]] },
      { c: [120, 420], r: [300, 70], fill: "#0d0b07", o: 0.6 },
    ],
  },
} as const satisfies Record<string, Field>;

export type AiSummaryPalette = keyof typeof aiSummaryPalettes;

/** False during SSR and the first client paint, true once hydrated. */
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

/**
 * Whether the painting may animate.
 *
 * SMIL ignores `prefers-reduced-motion` — a CSS rule cannot stop `<animate>`
 * — so the timelines have to be left out of the DOM entirely. The server
 * snapshot is `false`, which means the first paint is always the still
 * painting and the motion is added on hydration: no mismatch, and a reader
 * who asked for no motion never gets a frame of it.
 */
function useMayAnimate() {
  return React.useSyncExternalStore(
    subscribeMotion,
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** The painting itself: gradient, warped colour masses, grain. */
function VectorField({
  palette,
  animate,
}: {
  palette: AiSummaryPalette;
  animate: boolean;
}) {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const f = aiSummaryPalettes[palette] as Field;

  return (
    <svg
      viewBox="0 0 680 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className="absolute inset-0 block size-full"
    >
      <defs>
        <linearGradient id={`${id}-base`} {...f.gradient}>
          {f.stops.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>

        {/* The warp: fractal noise displaces the masses, then a blur melts
            the displaced edges back into each other. Animating the noise
            frequency and the displacement scale on different periods is what
            keeps the field from looping visibly. */}
        <filter
          id={`${id}-paint`}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency={f.warp.freq}
            numOctaves={f.warp.octaves}
            seed={f.warp.seed}
            result="n"
          >
            {animate && (
              <animate
                attributeName="baseFrequency"
                dur={`${f.warp.freqDur}s`}
                repeatCount="indefinite"
                values={f.warp.freqValues}
                calcMode="spline"
                keyTimes="0;0.34;0.68;1"
                keySplines="0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1"
              />
            )}
          </feTurbulence>
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale={f.warp.scale}
            xChannelSelector="R"
            yChannelSelector="G"
            result="warp"
          >
            {animate && (
              <animate
                attributeName="scale"
                dur={`${f.warp.scaleDur}s`}
                repeatCount="indefinite"
                values={f.warp.scaleValues}
                calcMode="spline"
                keyTimes="0;0.33;0.66;1"
                keySplines="0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1"
              />
            )}
          </feDisplacementMap>
          <feGaussianBlur in="warp" stdDeviation={f.warp.blur} />
        </filter>

        <filter
          id={`${id}-grain`}
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency={f.grain.freq}
            numOctaves={f.grain.octaves}
            seed={f.grain.seed}
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope={f.grain.slope} />
          </feComponentTransfer>
        </filter>
      </defs>

      <rect width="680" height="500" fill={`url(#${id}-base)`} />

      <g
        filter={`url(#${id}-paint)`}
        className="vf-drift"
        style={{ animationDuration: `${f.driftDur}s` }}
      >
        {f.masses.map((m, i) => (
          <ellipse
            key={i}
            cx={m.c[0]}
            cy={m.c[1]}
            rx={m.r[0]}
            ry={m.r[1]}
            fill={m.fill}
            opacity={m.o}
          >
            {animate &&
              m.anim?.map(([attr, dur, values]) => (
                <animate
                  key={attr}
                  attributeName={attr}
                  dur={`${dur}s`}
                  repeatCount="indefinite"
                  values={values}
                />
              ))}
          </ellipse>
        ))}
      </g>

      <rect
        width="680"
        height="500"
        filter={`url(#${id}-grain)`}
        opacity={f.grain.opacity}
        className="vf-shimmer"
      />
    </svg>
  );
}

/**
 * The card: painting, veil, then the copy.
 *
 * `isolate` matters — the veil and the content are positioned siblings of the
 * SVG, and without a stacking context of its own the card would let a
 * portalled popup elsewhere on the page slide between them.
 */
export function AiSummary({
  palette = "ink",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Which painting to hang behind the copy. */
  palette?: AiSummaryPalette;
}) {
  const animate = useMayAnimate();

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-lg bg-fg",
        className,
      )}
      {...props}
    >
      <VectorField palette={palette} animate={animate} />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: aiSummaryPalettes[palette].veil }}
      />
      <div className="relative px-[22px] pt-5 pb-[22px]">{children}</div>
    </div>
  );
}

/** Eyebrow: names the angle, in the page background colour at low contrast. */
export function AiSummaryLabel({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "font-mono text-[9.5px] font-bold tracking-[0.16em] text-bg/[0.86] uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** Body copy. Looser leading than AS1 — it is sitting on a picture. */
export function AiSummaryText({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "mt-3 text-[15px]/[1.85] text-pretty text-bg/[0.86]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The phrase that carries the finding, highlighted in the accent.
 *
 * Static: the highlight is there from the first paint. It is a reading aid,
 * not an event — sweeping it in pulls the eye to the mark at a moment the
 * reader has not reached yet, and repeats on every remount.
 *
 * `box-decoration-break: clone` keeps the pill intact when the phrase wraps.
 */
export function AiSummaryMark({
  className,
  ...props
}: React.ComponentProps<"mark">) {
  return (
    <mark
      className={cn("ai-mark rounded-[3px] px-[5px] py-0.5 text-bg", className)}
      {...props}
    />
  );
}
