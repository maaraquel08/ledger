import * as React from "react";
import { AddSheet } from "ledger";

/** Opened empty: the one-line capture field. */
export const Empty = () => <AddSheet open onOpenChange={() => {}} />;

/** Prefilled text shows the WHAT I UNDERSTOOD preview. (Keypad mode is tap-only; not previewed.) */
export const Prefilled = () => <AddSheet open onOpenChange={() => {}} initialText="grab gcash 248" />;
