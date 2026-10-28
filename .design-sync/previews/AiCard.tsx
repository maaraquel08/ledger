import * as React from "react";
import { AiCard, AiMark } from "ledger";
const frame: React.CSSProperties = { width: 382, padding: 24 };

/** A single M8 finding with its key phrase marked. */
export const Finding = () => (
  <div style={frame}>
    <AiCard label="M8 · THIS MONTH">
      Your 7th Grab this month, <AiMark>₱1,860 so far</AiMark>. This one is a habit, not a decision.
    </AiCard>
  </div>
);

/** A shorter note. */
export const Short = () => (
  <div style={frame}>
    <AiCard label="M8 · FOOD & DRINK">
      You spent <AiMark>₱3,420 on coffee</AiMark>, up 18% on last month.
    </AiCard>
  </div>
);

/** Without a marked phrase. */
export const Plain = () => (
  <div style={frame}>
    <AiCard label="M8 · QUIET WEEK">
      Nothing unusual since Monday. Your wallet and payroll account are both on track.
    </AiCard>
  </div>
);
