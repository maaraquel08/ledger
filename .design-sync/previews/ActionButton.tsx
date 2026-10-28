import * as React from "react";
import { ActionButton } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Primary = () => <div style={frame}><ActionButton>Show the math</ActionButton></div>;
export const Secondary = () => <div style={frame}><ActionButton variant="secondary">Adjust budget</ActionButton></div>;
export const Pair = () => (
  <div style={{ ...frame, display: "flex", gap: 8 }}>
    <ActionButton>Show the math</ActionButton>
    <ActionButton variant="secondary">Adjust budget</ActionButton>
  </div>
);
