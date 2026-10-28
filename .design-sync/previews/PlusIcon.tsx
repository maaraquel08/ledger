import * as React from "react";
import { PlusIcon } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };
const label = "font-mono text-[10px] text-fg-subtle";

/** The glyph at the five sizes used across the app. */
export const Sizes = () => (
  <div style={frame}>
    <div className="flex items-end justify-between text-fg">
      {[16, 20, 24, 32, 48].map((s) => (
        <div key={s} className="flex flex-col items-center gap-2">
          <PlusIcon size={s} />
          <span className={label}>{s}px</span>
        </div>
      ))}
    </div>
  </div>
);

/** Ink colour comes from currentColor: fg, subtle, and on an ink circle. */
export const Ink = () => (
  <div style={frame}>
    <div className="flex items-center justify-between">
      <div className="flex flex-col items-center gap-2 text-fg">
        <PlusIcon size={28} />
        <span className={label}>text-fg</span>
      </div>
      <div className="flex flex-col items-center gap-2 text-fg-subtle">
        <PlusIcon size={28} />
        <span className={label}>text-fg-subtle</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-fg">
          <PlusIcon size={20} />
        </span>
        <span className={label}>on ink</span>
      </div>
    </div>
  </div>
);
