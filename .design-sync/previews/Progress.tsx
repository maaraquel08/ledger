import * as React from "react";
import { Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

/** sc1m progress with label and value; Ledger draws its own bars on Insights, use this for generic loading. */
export const Labeled = () => (
  <div style={frame}>
    <Progress value={62}>
      <div className="mb-2 flex items-center justify-between">
        <ProgressLabel>Reading receipt</ProgressLabel>
        <ProgressValue />
      </div>
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </Progress>
  </div>
);

/** Track only. */
export const Bare = () => (
  <div style={frame}>
    <Progress value={30}>
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </Progress>
  </div>
);
