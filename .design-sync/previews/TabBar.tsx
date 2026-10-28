import * as React from "react";
import { TabBar } from "ledger";

const box: React.CSSProperties = { position: "relative", width: 430, height: 160 };

/** Home active, with the yellow add button. */
export const Home = () => (
  <div style={box}><TabBar path="/" /></div>
);

/** Activity active, no add button. */
export const NoFab = () => (
  <div style={box}><TabBar path="/activity" fab={false} /></div>
);
