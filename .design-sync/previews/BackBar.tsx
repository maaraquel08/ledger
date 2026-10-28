import * as React from "react";
import { BackBar, ActionButton } from "ledger";

const frame: React.CSSProperties = { width: 382 };

/** Label only. */
export const Basic = () => (
  <div style={frame}><BackBar label="Activity" onBack={() => {}} /></div>
);

/** With a trailing action. */
export const WithAction = () => (
  <div style={frame}>
    <BackBar label="Accounts" onBack={() => {}} right={<button type="button" className="text-[15px]">Edit</button>} />
  </div>
);
