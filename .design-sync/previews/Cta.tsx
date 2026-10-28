import * as React from "react";
import { Cta } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

/** The one main action on a screen or sheet: full width, ink. */
export const Primary = () => (
  <div style={frame}>
    <Cta>Save expense</Cta>
  </div>
);

/** Quiet alternative for the secondary path. */
export const Secondary = () => (
  <div style={frame}>
    <Cta variant="secondary">Add another</Cta>
  </div>
);

/** Disabled until the form has an amount. */
export const Disabled = () => (
  <div style={frame}>
    <Cta disabled>Save expense</Cta>
  </div>
);

/** A sheet footer: primary above secondary, 12px apart. */
export const Stacked = () => (
  <div style={{ ...frame, display: "grid", gap: 12 }}>
    <Cta>Log ₱820</Cta>
    <Cta variant="secondary">Retake</Cta>
  </div>
);
