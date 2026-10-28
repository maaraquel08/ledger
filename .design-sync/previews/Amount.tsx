import * as React from "react";
import { Amount } from "ledger";

const frame: React.CSSProperties = { width: 382, padding: 24, fontSize: 22, fontWeight: 600 };

export const Spend = () => <div style={frame}><Amount value={-2840} /></div>;
export const Income = () => <div style={frame}><Amount value={48000} /></div>;
export const Plain = () => <div style={frame}><Amount value={-248} plain /></div>;
export const Large = () => <div style={{ ...frame, fontSize: 34 }}><Amount value={128400} /></div>;
