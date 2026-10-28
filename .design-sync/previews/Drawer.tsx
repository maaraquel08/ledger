import * as React from "react";
import { Cta, Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "ledger";

/** The sc1m drawer Ledger's Sheet is built on. Prefer Sheet; this is the raw part, open. */
export const Open = () => (
  <Drawer open onOpenChange={() => {}}>
    <DrawerContent>
      <DrawerTitle className="text-[15px] font-semibold">Adjust total budget</DrawerTitle>
      <DrawerDescription className="mt-1.5 text-[13.5px] text-fg-muted">
        Spread over the 13 days left in October.
      </DrawerDescription>
      <Cta className="mt-5">Save budget</Cta>
    </DrawerContent>
  </Drawer>
);
