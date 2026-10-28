import * as React from "react";
import { ChromeProvider } from "@/components/ledger/chrome";
import { LedgerProvider } from "@/lib/store";
import "@/index.css";

/**
 * Root wrapper for anything built with Ledger's components outside the app shell.
 * It scopes the brand tokens (`data-brand="ledger"`), sets the paper and ink
 * defaults, and provides the ledger store and chrome context that AddSheet,
 * TabBar and the AI surfaces read. Wrap once at the top of a design.
 */
export function LedgerDesignSystem({ children, className }: { children: React.ReactNode; className?: string }) {
  const chrome = React.useMemo(() => ({ openAdd: () => {} }), []);
  // Sheets and drawers portal to <body>, outside this wrapper, so the brand
  // tokens must also live on <html> (the app sets the same attribute in index.html).
  React.useLayoutEffect(() => {
    const el = document.documentElement;
    if (el.dataset.brand === "ledger") return;
    el.dataset.brand = "ledger";
    return () => {
      delete el.dataset.brand;
    };
  }, []);
  return (
    <div data-brand="ledger" className={["bg-bg font-sans text-fg antialiased", className].filter(Boolean).join(" ")}>
      <LedgerProvider>
        <ChromeProvider value={chrome}>{children}</ChromeProvider>
      </LedgerProvider>
    </div>
  );
}
