import * as React from "react";
import { Segmented } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Period = () => (
  <div style={frame}><Segmented value="Monthly" options={["Weekly", "Monthly", "Yearly"]} onChange={() => {}} /></div>
);
export const Two = () => (
  <div style={frame}><Segmented value="Spend" options={["Spend", "Income"]} onChange={() => {}} /></div>
);
