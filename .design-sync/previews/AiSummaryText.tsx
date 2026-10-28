import * as React from "react";
import { AiSummary, AiSummaryText } from "ledger";
const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Default = () => (
  <div style={frame}>
    <AiSummary palette="ledger">
      <AiSummaryText className="mt-0">Your 7th Grab this month, ₱1,860 so far. This one is a habit, not a decision.</AiSummaryText>
    </AiSummary>
  </div>
);

export const Short = () => (
  <div style={frame}>
    <AiSummary palette="ledger">
      <AiSummaryText className="mt-0">Nothing unusual since Monday.</AiSummaryText>
    </AiSummary>
  </div>
);
