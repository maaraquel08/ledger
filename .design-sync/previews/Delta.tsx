import * as React from "react";
import { Delta } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Up = () => <div style={frame}><Delta value={12} /></div>;
export const Down = () => <div style={frame}><Delta value={-8} /></div>;
export const Flat = () => <div style={frame}><Delta value={0} /></div>;
export const InvertedForSpend = () => (
  <div style={{ ...frame, display: "flex", gap: 8 }}>
    <Delta value={-15} invert />
    <Delta value={22} invert />
  </div>
);
