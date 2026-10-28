import * as React from "react";
import { AiEyebrow } from "ledger";
const frame: React.CSSProperties = { width: 382, padding: 24 };

/** The M8 label that names an AI-authored block. */
export const Default = () => (
  <div style={frame}><AiEyebrow>M8 · THIS MONTH</AiEyebrow></div>
);

/** Another angle, same mark. */
export const Insight = () => (
  <div style={frame}><AiEyebrow>M8 · WHAT I NOTICED</AiEyebrow></div>
);
