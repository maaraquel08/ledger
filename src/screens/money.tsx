import * as React from "react";
import { PageTitle, Screen } from "@/components/ledger/primitives";
import type { Provider } from "@/lib/types";
import { AccountsSummary, AddAccountSheet } from "@/screens/accounts";

/** Money: net worth and accounts (the ledger lives on Activity). */
export function Money() {
  const [adding, setAdding] = React.useState<{ provider?: Provider } | null>(null);
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
      <div className="h-16" aria-hidden />
      <AddAccountSheet open={adding !== null} onOpenChange={(o) => !o && setAdding(null)} initialProvider={adding?.provider} />
    </Screen>
  );
}
