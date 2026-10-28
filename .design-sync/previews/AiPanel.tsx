import * as React from "react";
import { AiPanel, AiMark } from "ledger";
const frame: React.CSSProperties = { width: 382, padding: 24 };

/** The panel with its own body, for richer content than one finding. */
export const WithList = () => (
  <div style={frame}>
    <AiPanel label="M8 · 3 THINGS TO KNOW">
      <ul className="mt-3 grid gap-2 text-[14px]/[1.5] text-bg/[0.86]">
        <li>Grab rides are up to <AiMark>7 this month</AiMark>.</li>
        <li>Meralco is due Friday, ₱2,840.</li>
        <li>Two entries still need a category.</li>
      </ul>
    </AiPanel>
  </div>
);

/** Label only, with a one-line body. */
export const Compact = () => (
  <div style={frame}>
    <AiPanel label="M8 · SAVED">
      <p className="mt-2.5 text-[14px]/[1.5] text-bg/[0.86]">Logged <AiMark>grab gcash 248</AiMark> to Daily wallet.</p>
    </AiPanel>
  </div>
);
