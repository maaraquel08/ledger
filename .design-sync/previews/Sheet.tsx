import * as React from "react";
import { Cta, Eyebrow, Pill, Sheet } from "ledger";

/** A picker sheet: title, close, pills, one primary action. */
export const Picker = () => (
  <Sheet open onOpenChange={() => {}} title="Sort by">
    <Eyebrow className="mt-4 mb-2.5">ORDER</Eyebrow>
    <div className="flex flex-wrap gap-2">
      <Pill active className="min-h-10 px-3.5 text-[12.5px]">Newest</Pill>
      <Pill className="min-h-10 px-3.5 text-[12.5px]">Oldest</Pill>
      <Pill className="min-h-10 px-3.5 text-[12.5px]">Largest</Pill>
    </div>
    <Cta className="mt-5">Show 128 entries</Cta>
  </Sheet>
);

/** A confirmation sheet: the scope of the action, then the action. */
export const Confirm = () => (
  <Sheet open onOpenChange={() => {}} title="Remove account">
    <p className="mt-4 text-[14px] leading-[1.5] text-fg-muted">
      Remove ‘Daily wallet’? Its entries stay in Activity but lose their account.
    </p>
    <Cta className="mt-5">Remove account</Cta>
    <Cta className="mt-3" variant="secondary">Keep it</Cta>
  </Sheet>
);
