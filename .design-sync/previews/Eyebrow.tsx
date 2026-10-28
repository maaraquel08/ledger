import * as React from "react";
import { Eyebrow } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

/** Mono uppercase section label. */
export const Section = () => (
  <div style={frame}><Eyebrow>This week</Eyebrow></div>
);

export const Stacked = () => (
  <div style={frame}>
    <Eyebrow>Accounts</Eyebrow>
    <div className="mt-2 text-[15px]">GCash · Daily wallet</div>
    <Eyebrow className="mt-6">Upcoming bills</Eyebrow>
    <div className="mt-2 text-[15px]">Meralco · due Oct 24</div>
  </div>
);
