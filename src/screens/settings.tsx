import * as React from "react";
import { ChevronRight } from "@/components/ledger/icons";
import { BackBar, Cta, Eyebrow, Screen } from "@/components/ledger/primitives";
import { Switch } from "@/components/ui/switch/switch";
import { exportAll } from "@/lib/cloud/api";
import { useCloud } from "@/lib/cloud/provider";
import { pushIsOn, pushSupport, turnPushOff, turnPushOn } from "@/lib/cloud/push";
import { back, navigate } from "@/lib/router";

const FIELD =
  "h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent";
const ERASE_WORD = "ERASE";

/* ====================================================================== */
/*  Profile sheet, cloud mode: account, sync, notifications, data          */
/* ====================================================================== */

export function CloudSettings({ onClose }: { onClose: () => void }) {
  const c = useCloud()!;
  const [confirmOut, setConfirmOut] = React.useState(false);

  return (
    <div className="pt-1">
      <p className="font-mono text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle">{c.email}</p>
      <p className="mt-1 text-[13px] text-fg-muted" role="status">
        {c.pending ? `${c.pending} change${c.pending === 1 ? "" : "s"} saved on this phone, not synced yet` : "Synced"}
      </p>

      <PushRow />

      <div className="mt-2 divide-y divide-line border-y border-line">
        <button
          type="button"
          onClick={() => {
            onClose();
            navigate("/data");
          }}
          className="flex min-h-12 w-full items-center justify-between gap-3 text-left text-[14.5px] active:opacity-60"
        >
          Your data
          <ChevronRight size={16} className="flex-none text-fg-subtle" />
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-2.5">
        {confirmOut ? (
          <div role="alertdialog" aria-label="Confirm sign out">
            <p className="text-[13.5px] leading-[1.5] text-fg-muted">
              {c.pending} change{c.pending === 1 ? " hasn’t" : "s haven’t"} reached your account yet. Signing out now drops {c.pending === 1 ? "it" : "them"}.
            </p>
            <div className="mt-3 flex gap-2.5">
              <Cta variant="secondary" autoFocus onClick={() => setConfirmOut(false)}>
                Stay signed in
              </Cta>
              <Cta className="!bg-danger !text-accent-fg" onClick={() => void c.signOut()}>
                Sign out
              </Cta>
            </div>
          </div>
        ) : (
          <Cta variant="secondary" onClick={() => (c.pending ? setConfirmOut(true) : void c.signOut())}>
            Sign out
          </Cta>
        )}
        <EraseAccount onDone={onClose} />
      </div>
    </div>
  );
}

/** "Weekly review and alerts": Web Push, hidden without a VAPID key (D-0016). */
function PushRow() {
  const support = React.useMemo(() => pushSupport(), []);
  const [on, setOn] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (support === "ok") pushIsOn().then(setOn, () => setOn(false));
  }, [support]);

  if (support === "no-key") return null;

  const toggle = async (next: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      if (next) {
        const why = await turnPushOn();
        if (why === "denied") setNote("Notifications are blocked for Ledger. Allow them in your browser’s site settings, then try again.");
        setOn(why == null);
      } else {
        await turnPushOff();
        setOn(false);
      }
    } catch {
      setNote("Couldn’t change notifications. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex min-h-12 items-center justify-between gap-4">
        <div className="min-w-0">
          <div id="push-label" className="text-[14.5px]">
            Weekly review and alerts
          </div>
          <div className="mt-0.5 text-[12.5px] leading-[1.45] text-fg-subtle">At most 3 a week, never at night, never with amounts.</div>
        </div>
        {support === "ok" ? <Switch aria-labelledby="push-label" checked={on} disabled={busy} onCheckedChange={(v) => void toggle(v)} /> : null}
      </div>
      {support === "ios-home-screen" ? (
        <p className="mt-1 text-[12.5px] leading-[1.5] text-fg-muted">
          On iPhone, notifications need Ledger on your Home Screen. Tap Share, then Add to Home Screen, and turn this on from there.
        </p>
      ) : support === "unsupported" ? (
        <p className="mt-1 text-[12.5px] leading-[1.5] text-fg-muted">This browser can’t show notifications.</p>
      ) : null}
      {note ? (
        <p role="alert" className="mt-1 text-[12.5px] leading-[1.5] text-danger">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** Erase all data in the account: typed confirmation, then erase_my_data() + Storage. The login stays. */
function EraseAccount({ onDone }: { onDone: () => void }) {
  const c = useCloud()!;
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ok = typed.trim().toUpperCase() === ERASE_WORD;

  if (!open)
    return (
      <Cta variant="secondary" className="!text-danger" onClick={() => setOpen(true)}>
        Erase all data
      </Cta>
    );

  return (
    <form
      role="alertdialog"
      aria-label="Confirm erase all data"
      className="rounded-lg border border-danger/50 p-3.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        setError(null);
        try {
          await c.eraseAll();
          onDone();
          navigate("/onboarding/welcome", { replace: true });
        } catch {
          setError(navigator.onLine ? "Couldn’t erase. Nothing was deleted; try again." : "You’re offline. Connect, then try again.");
          setBusy(false);
        }
      }}
    >
      <p className="text-[15px] font-semibold">Erase everything in your account?</p>
      <p className="mt-1 text-[13.5px] leading-[1.5] text-fg-muted">
        Every account, entry, goal, insight, receipt photo and voice clip is deleted from your account and this phone. You stay signed in. It can’t be undone.
      </p>
      <label className="mt-3 block">
        <Eyebrow className="mb-2">TYPE {ERASE_WORD} TO CONFIRM</Eyebrow>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} className={`${FIELD} font-mono`} />
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2.5">
        <Cta
          variant="secondary"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Cancel
        </Cta>
        <Cta type="submit" className="!bg-danger !text-accent-fg disabled:!bg-fill disabled:!text-fg-subtle" disabled={!ok || busy}>
          {busy ? "Erasing…" : "Erase everything"}
        </Cta>
      </div>
    </form>
  );
}

/* ====================================================================== */
/*  Your data: what is stored where, and an export                         */
/* ====================================================================== */

const WHERE: { title: string; lines: string[] }[] = [
  {
    title: "IN YOUR LEDGER ACCOUNT",
    lines: [
      "Accounts, entries, splits and receipt lines, goals, budgets and reported balances.",
      "What you typed or said, the questions M8 asked, and M8’s reviews and alerts.",
      "Receipt photos and voice clips, in private storage only you can open.",
      "Held by Supabase, in Singapore. Only your sign-in can read it.",
    ],
  },
  {
    title: "ON THIS PHONE",
    lines: [
      "A copy of your ledger, so Ledger opens without a connection.",
      "Changes not synced yet, until your account confirms them.",
      "This session’s conversation with M8.",
    ],
  },
  {
    title: "SENT TO READ IT",
    lines: [
      "To file an entry or answer a question, your account sends the text, receipt photo or a voice clip’s transcript to Claude (Anthropic). Voice clips are transcribed by OpenAI.",
      "Nothing is sent to a bank. Ledger never moves money.",
    ],
  },
];

export function DataScreen() {
  const c = useCloud()!;
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ledger-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg("Exported. Check your downloads.");
    } catch {
      setMsg(navigator.onLine ? "Couldn’t export. Try again." : "You’re offline. Connect, then export.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen className="pb-[max(32px,env(safe-area-inset-bottom))]">
      <BackBar label="Today" onBack={() => back("/today")} />
      <div className="px-6 pt-4">
        <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.026em]">Your data</h1>
        <p className="mt-2 font-mono text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle">{c.email}</p>
      </div>
      {WHERE.map((s) => (
        <section key={s.title} className="px-6 pt-7">
          <Eyebrow>{s.title}</Eyebrow>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {s.lines.map((l) => (
              <li key={l} className="py-3 text-[14px] leading-[1.5] text-pretty">
                {l}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="px-6 pt-7">
        <Eyebrow>EXPORT</Eyebrow>
        <p className="mt-2 text-[13.5px] leading-[1.5] text-fg-muted">One JSON file with every row in your account: entries, accounts, goals, reviews and the history of every change.</p>
        <Cta className="mt-4" disabled={busy} onClick={() => void download()}>
          {busy ? "Preparing your file…" : "Export all data"}
        </Cta>
        <p role="status" className="mt-2 min-h-5 text-[13px] text-fg-muted">
          {msg}
        </p>
      </section>
    </Screen>
  );
}
