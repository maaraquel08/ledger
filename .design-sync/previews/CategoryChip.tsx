import * as React from "react";
import { CategoryChip } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Neutral = () => <div style={frame}><CategoryChip>Transport</CategoryChip></div>;
export const Warn = () => <div style={frame}><CategoryChip tone="warn">Needs category</CategoryChip></div>;
export const Row = () => (
  <div style={{ ...frame, display: "flex", gap: 8 }}>
    <CategoryChip>Food & drink</CategoryChip>
    <CategoryChip>Rent & bills</CategoryChip>
    <CategoryChip tone="warn">On phone</CategoryChip>
  </div>
);
