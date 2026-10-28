import * as React from "react";
import { AiSummary, AiSummaryLabel, AiSummaryText, AiSummaryMark } from "ledger";
const frame: React.CSSProperties = { width: 382, padding: 24 };

/** Ledger's espresso painting behind label and copy. */
export const Ledger = () => (
  <div style={frame}>
    <AiSummary palette="ledger">
      <AiSummaryLabel>M8 · THIS MONTH</AiSummaryLabel>
      <AiSummaryText>
        Your 7th Grab this month, <AiSummaryMark>₱1,860 so far</AiSummaryMark>. This one is a habit, not a decision.
      </AiSummaryText>
    </AiSummary>
  </div>
);

/** The stock ink palette, for comparison. */
export const Ink = () => (
  <div style={frame}>
    <AiSummary palette="ink">
      <AiSummaryLabel>M8 · BILLS</AiSummaryLabel>
      <AiSummaryText>
        Meralco is due Friday, <AiSummaryMark>₱2,840</AiSummaryMark>. Payday lands first.
      </AiSummaryText>
    </AiSummary>
  </div>
);
