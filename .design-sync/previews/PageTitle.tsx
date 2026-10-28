import * as React from "react";
import { PageTitle, Pill } from "ledger";

const frame: React.CSSProperties = { width: 382, paddingBottom: 16 };

export const Basic = () => (
  <div style={frame}><PageTitle>Activity</PageTitle></div>
);

export const WithAction = () => (
  <div style={frame}>
    <PageTitle right={<Pill>Filter</Pill>}>BPI Payroll</PageTitle>
  </div>
);
