import * as React from "react";
import { AiSummary, AiSummaryText, AiSummaryMark } from "ledger";
const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Default = () => (
  <div style={frame}>
    <AiSummary palette="ledger">
      <AiSummaryText className="mt-0">Your 7th Grab this month, <AiSummaryMark>₱1,860 so far</AiSummaryMark>. A habit, not a decision.</AiSummaryText>
    </AiSummary>
  </div>
);

export const Wrapping = () => (
  <div style={frame}>
    <AiSummary palette="ledger">
      <AiSummaryText className="mt-0">Both bills land this week, <AiSummaryMark>₱4,310 leaves BPI before Friday</AiSummaryMark>, so payday covers it.</AiSummaryText>
    </AiSummary>
  </div>
);
