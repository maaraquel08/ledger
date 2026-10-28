import * as React from "react";
import { Pill } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Inactive = () => <div style={frame}><Pill>Grab</Pill></div>;
export const Active = () => <div style={frame}><Pill active>Food & drink</Pill></div>;
export const FilterRow = () => (
  <div style={{ ...frame, display: "flex", gap: 8, flexWrap: "wrap" }}>
    <Pill active>All</Pill>
    <Pill>GCash</Pill>
    <Pill>BPI</Pill>
    <Pill>Cash</Pill>
  </div>
);
