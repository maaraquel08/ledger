import * as React from "react";
import { StatGrid } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Month = () => (
  <div style={frame}>
    <StatGrid items={[
      { label: "Spent", value: "₱42,180", tone: "danger" },
      { label: "Income", value: "₱96,000", tone: "success" },
      { label: "Left", value: "₱53,820" },
    ]} />
  </div>
);
export const Pair = () => (
  <div style={frame}>
    <StatGrid items={[
      { label: "Meralco", value: "₱2,840" },
      { label: "Avg Grab", value: "₱248" },
    ]} />
  </div>
);
