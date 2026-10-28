import * as React from "react";
import { Sparkle } from "ledger";
const frame: React.CSSProperties = { width: 382, padding: 24 };

/** The M8 mark at its default 13px, on paper. */
export const Default = () => (
  <div style={frame}><Sparkle /></div>
);

/** Scaled up, on the espresso paint it usually sits near. */
export const Large = () => (
  <div style={{ ...frame, background: "#1a1410" }}><Sparkle size={32} /></div>
);
