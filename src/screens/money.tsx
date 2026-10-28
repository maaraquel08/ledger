import * as React from "react";
import { PageTitle, Screen } from "@/components/ledger/primitives";
import type { Provider } from "@/lib/types";
import { AccountsSummary, AddAccountSheet } from "@/screens/accounts";
import { LedgerList } from "@/screens/ledger-list";

/** Money: net worth and accounts on top, the full ledger beneath. */
export function Money({ path }: { path: string }) {
  const [adding, setAdding] = React.useState<{ provider?: Provider } | null>(null);
  // arriving with filters (an analysis card, an old Activity link): open on the ledger, not the accounts
  const ledgerRef = React.useRef<HTMLDivElement>(null);
  const arrivedFiltered = React.useRef(path.includes("?"));
  React.useEffect(() => {
    if (arrivedFiltered.current) ledgerRef.current?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <Screen tabbed>
      <PageTitle
        right={
          <button type="button" onClick={() => setAdding({})} className="-mr-2 flex h-11 items-center px-2 text-[15px] font-medium active:opacity-60">
            Add account
          </button>
        }
      >
        Money
      </PageTitle>
      <AccountsSummary onAdd={(provider) => setAdding({ provider })} />
      <div ref={ledgerRef} className="scroll-mt-2 border-t border-line pt-4">
        <LedgerList path={path} base="/money" />
      </div>
      <div className="h-16" aria-hidden />
      <AddAccountSheet open={adding !== null} onOpenChange={(o) => !o && setAdding(null)} initialProvider={adding?.provider} />
    </Screen>
  );
}
