import * as React from "react";
import { ProviderMark } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24 };

export const Wallet = () => <div style={frame}><ProviderMark provider="gcash" /></div>;
export const Bank = () => <div style={frame}><ProviderMark provider="bpi" /></div>;
export const Cash = () => <div style={frame}><ProviderMark provider="cash" /></div>;
export const Investing = () => <div style={frame}><ProviderMark provider="ibkr" /></div>;
export const Sizes = () => (
  <div style={{ ...frame, display: "flex", gap: 12, alignItems: "center" }}>
    <ProviderMark provider="bdo" size={28} radius={8} />
    <ProviderMark provider="maya" size={42} />
    <ProviderMark provider="unionbank" size={56} radius={14} />
  </div>
);
