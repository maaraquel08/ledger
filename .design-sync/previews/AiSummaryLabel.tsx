import * as React from "react";
import { AiSummary, AiSummaryLabel } from "ledger";
const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Default = () => (
  <div style={frame}>
    <AiSummary palette="ledger"><AiSummaryLabel>M8 · THIS MONTH</AiSummaryLabel></AiSummary>
  </div>
);

export const Alternate = () => (
  <div style={frame}>
    <AiSummary palette="ledger"><AiSummaryLabel>M8 · WHAT I NOTICED</AiSummaryLabel></AiSummary>
  </div>
);
