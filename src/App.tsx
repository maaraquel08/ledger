import * as React from "react";
import { AddSheet } from "@/components/ledger/add-sheet";
import { ChromeProvider, TabBar } from "@/components/ledger/chrome";
import { navigate, useRoute, match } from "@/lib/router";
import { useSession } from "@/lib/cloud/auth";
import { CloudLedgerProvider, useCloud } from "@/lib/cloud/provider";
import { LedgerProvider, useLedger, useOnline } from "@/lib/store";
import { cloud } from "@/lib/supabase";
import { AccountDetail } from "@/screens/accounts";
import { Analytics } from "@/screens/analytics";
import { ActivityDetail, Review } from "@/screens/activity";
import { Chat } from "@/screens/chat";
import { Money } from "@/screens/money";
import { Onboarding } from "@/screens/onboarding";
import { Scan } from "@/screens/scan";
import { DataScreen } from "@/screens/settings";
import { ImportOffer, localLedger, OpenFailed, Opening, SignIn } from "@/screens/sign-in";
import { Today } from "@/screens/today";
import { Welcome } from "@/screens/welcome";

const TAB_ROOTS = ["/today", "/money", "/analytics"];

/**
 * Old routes and where they live now. Insights became Analytics (D-0017),
 * Budgets folded into Today, Activity and Accounts into Money.
 */
function redirect(path: string): string | null {
  const [base, qs] = path.split("?");
  let m: Record<string, string> | null;
  if (base === "/home") return "/today";
  if (base === "/insights") return "/analytics";
  if (base === "/budgets") return "/today?plan=1";
  if (base === "/accounts") return "/money";
  if ((m = match("/accounts/:id", base))) return `/money/${encodeURIComponent(m.id)}`;
  // Activity's own filters (acct, cat, q, sort) carry over; its old period filter does not
  if (base === "/activity") {
    const p = new URLSearchParams(qs ?? "");
    p.delete("period");
    const s = p.toString();
    return `/money${s ? `?${s}` : ""}`;
  }
  return null;
}

/** "/money/abc" -> "Money", "/activity/e1" -> "Entry" */
function routeName(base: string) {
  const seg = base.split("/")[1];
  if (seg === "activity") return "Entry";
  if (seg === "money" && base !== "/money") return "Account";
  if (seg === "data") return "Your data";
  return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : "Welcome";
}

function Router() {
  const path = useRoute();
  const { state, dispatch, persistError } = useLedger();
  const online = useOnline();
  const [add, setAdd] = React.useState<{ open: boolean; accountId?: string; text?: string; date?: string }>({ open: false });

  // Signed-out users only see the welcome + onboarding flow.
  const publicRoute = path === "/" || path.startsWith("/onboarding");
  React.useEffect(() => {
    // signed in to an account that isn't set up yet: straight into setup, no Welcome
    if (cloud && !state.onboarded && path === "/") navigate("/onboarding/welcome", { replace: true });
    else if (!state.onboarded && !publicRoute) navigate("/", { replace: true });
    if (state.onboarded && (path === "/" || path.startsWith("/onboarding"))) navigate("/today", { replace: true });
  }, [state.onboarded, publicRoute, path]);

  // Back online: sync anything saved while away. (Cloud mode clears `queued` only on the server's ack.)
  const hasQueued = state.entries.some((e) => e.queued);
  React.useEffect(() => {
    if (!cloud && online && hasQueued) dispatch({ type: "flush-queue" });
  }, [online, hasQueued, dispatch]);

  let screen: React.ReactNode = null;
  let m: Record<string, string> | null;
  const base = path.split("?")[0];
  if (base === "/") screen = <Welcome />;
  else if ((m = match("/onboarding/:step", base))) screen = <Onboarding step={m.step} />;
  else if (base === "/today") screen = <Today path={path} />;
  else if (base === "/money") screen = <Money path={path} />;
  else if (base === "/analytics") screen = <Analytics path={path} />;
  else if ((m = match("/money/:id", base))) screen = <AccountDetail id={m.id} path={path} />;
  else if (base === "/review") screen = <Review />;
  else if ((m = match("/activity/:id", base))) screen = <ActivityDetail id={m.id} />;
  else if (base === "/chat") screen = <Chat path={path} />;
  else if (base === "/scan") screen = <Scan />;
  else if (cloud && base === "/data") screen = <DataScreen />;

  const target = state.onboarded && !publicRoute ? (redirect(path) ?? (screen ? null : "/today")) : null;
  React.useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target]);

  const mainRef = React.useRef<HTMLElement>(null);
  const firstRoute = React.useRef(true);
  React.useEffect(() => {
    document.title = `${routeName(base)} · Ledger`;
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [base]);

  const showTabs = state.onboarded && TAB_ROOTS.includes(base);

  return (
    <ChromeProvider value={{ openAdd: (o) => setAdd({ open: true, ...o }) }}>
      {persistError ? (
        <div role="alert" className="mx-auto w-full max-w-[430px] border-b border-danger/15 bg-[color-mix(in_oklab,var(--color-danger)_5%,var(--color-bg))] px-6 py-2.5 text-[12px] text-danger">
          Couldn't save on this phone. Free up space or delete receipt photos.
        </div>
      ) : null}
      {cloud ? <CloudBanner /> : null}
      <main id="main" tabIndex={-1} ref={mainRef} className="outline-none">
        <React.Fragment key={base}>{target ? null : screen}</React.Fragment>
      </main>
      {showTabs ? <TabBar path={base} /> : null}
      {state.onboarded ? (
        <AddSheet
          open={add.open}
          accountId={add.accountId}
          initialText={add.text}
          initialDate={add.date}
          onOpenChange={(open) => setAdd((a) => ({ ...a, open }))}
        />
      ) : null}
    </ChromeProvider>
  );
}

/** Cloud mode: a change the server refused, or the account couldn't be reached (showing the copy on this phone). */
function CloudBanner() {
  const c = useCloud();
  if (!c) return null;
  const text = c.syncError ?? (c.loadError && c.status === "ready" ? "Couldn’t reach your account. Showing what’s saved on this phone." : null);
  if (!text) return null;
  return (
    <div role="alert" className="mx-auto flex w-full max-w-[430px] items-start gap-3 border-b border-danger/15 bg-[color-mix(in_oklab,var(--color-danger)_5%,var(--color-bg))] px-6 py-2.5 text-[12px] text-danger">
      <span className="min-w-0 flex-1">{text}</span>
      {c.syncError ? (
        <button type="button" onClick={c.dismissSyncError} className="-my-2 h-8 flex-none font-semibold underline underline-offset-2 active:opacity-60">
          OK
        </button>
      ) : null}
    </div>
  );
}

/** Signed out (cloud mode): Welcome and the sign-in screen only. */
function SignedOut() {
  const path = useRoute();
  const base = path.split("?")[0];
  const known = base === "/" || base === "/sign-in";
  React.useEffect(() => {
    if (!known) navigate("/", { replace: true });
  }, [known]);
  React.useEffect(() => {
    document.title = `${base === "/sign-in" ? "Sign in" : "Welcome"} · Ledger`;
  }, [base]);
  if (base === "/sign-in") return <SignIn />;
  return known ? <Welcome /> : null;
}

/** Signed in: wait for the first load, offer to bring this phone's ledger over, then the app. */
function CloudGate() {
  const c = useCloud()!;
  const { state } = useLedger();
  const [local, setLocal] = React.useState(() => localLedger(c.uid));
  if (c.status === "loading") return <Opening />;
  if (c.status === "error") return <OpenFailed />;
  if (!state.onboarded && local) return <ImportOffer local={local} onDone={() => setLocal(null)} />;
  return <Router />;
}

function CloudApp() {
  const { loading, session } = useSession();
  React.useEffect(() => {
    if (loading) document.title = "Opening · Ledger";
  }, [loading]);
  if (loading) return <Opening label="Opening Ledger…" />;
  if (!session) return <SignedOut />;
  return (
    <CloudLedgerProvider key={session.user.id} uid={session.user.id} email={session.user.email ?? ""}>
      <CloudGate />
    </CloudLedgerProvider>
  );
}

export default function App() {
  if (cloud) return <CloudApp />;
  return (
    <LedgerProvider>
      <Router />
    </LedgerProvider>
  );
}
