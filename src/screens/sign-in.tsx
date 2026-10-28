import * as React from "react";
import { BackBar, Cta, Eyebrow, Screen } from "@/components/ledger/primitives";
import { signInWithUsername } from "@/lib/cloud/auth";
import { importState } from "@/lib/cloud/api";
import { useCloud } from "@/lib/cloud/provider";
import { peso } from "@/lib/format";
import { back, navigate } from "@/lib/router";
import { repository } from "@/lib/store";
import type { LedgerState } from "@/lib/types";

const FIELD =
  "h-12 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent";

/* ====================================================================== */
/*  Sign in (cloud mode): the Owner's username and password               */
/* ====================================================================== */

export function SignIn() {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [stage, setStage] = React.useState<{ k: "form"; error?: string } | { k: "signing-in" }>({ k: "form" });
  const valid = /^[a-z0-9._-]{3,}(@[a-z0-9.-]+\.[a-z]+)?$/i.test(username.trim()) && password.length > 0;
  const userRef = React.useRef<HTMLInputElement>(null);
  const error = stage.k === "form" ? stage.error : undefined;
  // a failed sign-in moves focus to the first field, which announces the error it's described by
  React.useEffect(() => {
    if (error) userRef.current?.focus();
  }, [error]);

  const submit = async () => {
    if (!valid || stage.k === "signing-in") return;
    if (!navigator.onLine) return setStage({ k: "form", error: "You’re offline. Connect to sign in." });
    setStage({ k: "signing-in" });
    try {
      await signInWithUsername(username, password);
      // the session listener routes on from here
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setStage({
        k: "form",
        error: /rate|seconds|too many/i.test(msg)
          ? "Too many tries in a short time. Wait a minute, then try again."
          : /invalid|credentials/i.test(msg)
            ? "That username and password don’t match."
            : "Couldn’t sign in. Try again.",
      });
    }
  };
  const clearError = () => stage.k === "form" && stage.error && setStage({ k: "form" });

  return (
    <Screen>
      <BackBar label="Back" onBack={() => back("/")} />
      <form
        className="flex flex-1 flex-col px-6 pt-8"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Eyebrow>SIGN IN</Eyebrow>
        <h1 className="mt-3 text-[26px] leading-[1.2] font-semibold tracking-[-0.026em] text-balance">Welcome back.</h1>
        <p className="mt-3 text-[14px] leading-[1.55] text-pretty text-fg-muted">This Ledger has one owner. You stay signed in on this phone.</p>
        <label className="mt-7 block">
          <Eyebrow className="mb-2">USERNAME</Eyebrow>
          <input
            ref={userRef}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              clearError();
            }}
            className={FIELD}
            aria-invalid={stage.k === "form" && !!stage.error}
            aria-describedby="sign-in-error"
          />
        </label>
        <label className="mt-4 block">
          <Eyebrow className="mb-2">PASSWORD</Eyebrow>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError();
            }}
            className={FIELD}
            aria-invalid={stage.k === "form" && !!stage.error}
            aria-describedby="sign-in-error"
          />
        </label>
        <p id="sign-in-error" role="alert" className="mt-2 min-h-5 text-[13px] text-danger">
          {stage.k === "form" ? stage.error : null}
        </p>
        <div className="mt-auto pt-10 pb-[max(26px,env(safe-area-inset-bottom))]">
          <Cta type="submit" disabled={!valid || stage.k === "signing-in"}>
            {stage.k === "signing-in" ? "Signing in…" : "Sign in"}
          </Cta>
        </div>
      </form>
    </Screen>
  );
}

/* ====================================================================== */
/*  Opening, failed to open                                                */
/* ====================================================================== */

export function Opening({ label = "Opening your ledger…" }: { label?: string }) {
  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center px-6 pb-24" role="status" aria-busy="true">
        <Eyebrow>LEDGER</Eyebrow>
        <p className="mt-3 text-[19px] font-semibold tracking-[-0.01em]">{label}</p>
        <div className="mt-6 flex flex-col gap-3" aria-hidden>
          {[100, 72, 86].map((w, i) => (
            <div key={i} className="skeleton h-5 rounded-md" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </Screen>
  );
}

export function OpenFailed() {
  const cloud = useCloud()!;
  const [busy, setBusy] = React.useState(false);
  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
        <h2 className="text-[19px] leading-[1.25] font-semibold text-balance">Couldn’t open your ledger</h2>
        <p className="mt-2.5 max-w-[280px] text-[14px] leading-[1.5] text-fg-muted">
          {navigator.onLine ? "Your account didn’t answer. Nothing on this phone was lost." : "You’re offline, and this phone has no saved copy yet."}
        </p>
        <Cta
          className="mt-7 max-w-[240px]"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await cloud.reload();
            setBusy(false);
          }}
        >
          {busy ? "Trying…" : "Try again"}
        </Cta>
        <button type="button" onClick={() => void cloud.signOut()} className="mt-3 h-11 text-[13px] font-medium text-fg-muted underline underline-offset-4 active:opacity-60">
          Sign out
        </button>
      </div>
    </Screen>
  );
}

/* ====================================================================== */
/*  First sign-in with a ledger already on this phone                      */
/* ====================================================================== */

const declinedKey = (uid: string) => `ledger:import-declined:${uid}`;

/** This phone's own ledger (local mode), if it has one worth moving: not the demo, not empty. */
export function localLedger(uid: string): LedgerState | null {
  try {
    if (localStorage.getItem(declinedKey(uid)) === "1") return null;
  } catch {
    /* ignore */
  }
  const s = repository.load();
  if (!s || !s.onboarded || s.demo || (s.entries.length === 0 && s.accounts.length === 0)) return null;
  return s;
}

export function ImportOffer({ local, onDone }: { local: LedgerState; onDone: () => void }) {
  const cloud = useCloud()!;
  const [stage, setStage] = React.useState<{ k: "ask"; error?: string } | { k: "moving" }>({ k: "ask" });
  const total = local.accounts.reduce((n, a) => n + (a.type === "credit" ? -a.balance : a.balance), 0);

  const bring = async () => {
    setStage({ k: "moving" });
    try {
      await importState(local);
      repository.clear(); // the account has it now; the phone copy would only drift
      await cloud.reload();
      onDone();
      navigate("/today", { replace: true });
    } catch {
      setStage({ k: "ask", error: navigator.onLine ? "Couldn’t move them. Nothing was lost; try again." : "You’re offline. Connect, then try again." });
    }
  };

  return (
    <Screen>
      <div className="flex flex-1 flex-col px-6 pt-12">
        <Eyebrow>ON THIS PHONE</Eyebrow>
        <h1 className="mt-3 text-[26px] leading-[1.2] font-semibold tracking-[-0.026em] text-balance">Bring your entries from this phone</h1>
        <p className="mt-3 text-[14px] leading-[1.55] text-pretty text-fg-muted">
          This phone has a ledger from before you signed in. Move it into your account so it’s backed up and M8 can read it. Balances come across exactly.
        </p>
        <dl className="mt-7 divide-y divide-line border-y border-line">
          {[
            ["Entries", String(local.entries.length)],
            ["Accounts", String(local.accounts.length)],
            ["Goals", String(local.profile.goals.length)],
            ["Net of accounts", peso(total)],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between py-3">
              <dt className="text-[13.5px] text-fg-subtle">{k}</dt>
              <dd className="tnum text-[14px] font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p role="alert" className="mt-3 min-h-5 text-[13px] text-danger">
          {stage.k === "ask" ? stage.error : null}
        </p>
        <div className="mt-auto flex flex-col gap-3 pt-8 pb-[max(26px,env(safe-area-inset-bottom))]">
          <Cta disabled={stage.k === "moving"} onClick={() => void bring()}>
            {stage.k === "moving" ? "Moving your entries…" : "Bring them over"}
          </Cta>
          <button
            type="button"
            disabled={stage.k === "moving"}
            onClick={() => {
              try {
                localStorage.setItem(declinedKey(cloud.uid), "1");
              } catch {
                /* ignore */
              }
              onDone();
            }}
            className="h-11 text-[13px] font-medium text-fg-muted underline underline-offset-4 active:opacity-60"
          >
            Start fresh instead
          </button>
        </div>
      </div>
    </Screen>
  );
}
