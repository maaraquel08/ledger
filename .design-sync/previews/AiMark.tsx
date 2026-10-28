import * as React from "react";
import { AiCard, AiMark } from "ledger";
const frame: React.CSSProperties = { width: 382, padding: 24 };

/** The one highlighted phrase in M8 copy: yellow with ink text. */
export const InSentence = () => (
  <div style={frame}>
    <AiCard label="M8 · THIS MONTH">
      Your 7th Grab this month, <AiMark>₱1,860 so far</AiMark>. This one is a habit, not a decision.
    </AiCard>
  </div>
);

/** It wraps cleanly when the phrase is long. */
export const Wrapping = () => (
  <div style={frame}>
    <AiCard label="M8 · BILLS">
      Meralco and Globe both land this week, <AiMark>₱4,310 leaves BPI before Friday</AiMark>, so payday covers it.
    </AiCard>
  </div>
);
