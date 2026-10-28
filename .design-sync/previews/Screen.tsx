import * as React from "react";
import { Screen, BackBar, PageTitle, Eyebrow, Amount } from "ledger";

/** The phone column: back bar, title, then content. */
export const Composed = () => (
  <div style={{ width: 430 }}>
    <Screen className="!min-h-0 pb-6">
      <BackBar label="Activity" onBack={() => {}} />
      <PageTitle>GCash</PageTitle>
      <div className="px-6 pt-5">
        <Eyebrow>Today</Eyebrow>
        <div className="mt-3 flex justify-between text-[15px]"><span>Grab</span><Amount value={-248} /></div>
        <div className="mt-3 flex justify-between text-[15px]"><span>Jollibee</span><Amount value={-312} /></div>
      </div>
    </Screen>
  </div>
);
