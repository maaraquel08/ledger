import * as React from "react";
import { cn } from "@/lib/cn";
import { fileToCanvas, useCamera } from "@/lib/camera";
import { balance, MAX_AMOUNT, peso } from "@/lib/format";
import { recognize, warmUp } from "@/lib/ocr";
import { INCOME_CATEGORIES, isUnusualAmount, moveLegs, overdraws } from "@/lib/entry-rules";
import { parseEntry } from "@/lib/parse";
import { SPEND_CATEGORIES } from "@/lib/providers";
import { compressImage, draftToEntry, parseReceipt, splitOf, type ReceiptDraft } from "@/lib/receipt";
import { canSpendFrom } from "@/lib/selectors";
import { navigate } from "@/lib/router";
import { newId, useLedger } from "@/lib/store";
import type { Account, Category, Entry } from "@/lib/types";
import { capture, dataUrlToBlob, undoEvent, upload, type CaptureResult } from "@/lib/cloud/api";
import { useCloud } from "@/lib/cloud/provider";
import { CameraGate, ReceiptFrame } from "./camera";
import {
  accountOption,
  AccountPanel,
  AmountInput,
  DateField,
  DraftRow,
  KINDS,
  NoteField,
  PickField,
  SourceRow,
  type Kind,
  type Part,
} from "./entry-draft";
import { CheckIcon } from "./icons";
import { CategoryChip, Cta, Segmented, Sheet } from "./primitives";
import { TOAST_DOCK, useToastPresence } from "./undo-toast";

/*
 * Add entry, two ways in: Manual (Expense | Income | Transfer, then one form with
 * every field in view: amount, category, account, date, note) and Camera (a
 * receipt read on the phone). The account starts on the most-used one.
 */

type Mode = "Manual" | "Camera";
const MODES: Mode[] = ["Manual", "Camera"];

type CamStage =
  | { k: "viewfinder" }
  /** cloud: M8 reads it on the server; otherwise the phone's own reader */
  | { k: "reading"; image: string; progress: number; cloud?: boolean }
  | { k: "read"; draft: ReceiptDraft }
  | { k: "unreadable"; failed: boolean };
/** A Camera draft part being fixed with its picker. */
type Fix = { part: "account" } | null;

const inputDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayInput = () => inputDay(new Date());

/** Most-used first, from this phone's own entries (D-0002); ties keep `base` order. */
function rankBy<T>(base: T[], counts: Map<T, number>) {
  return [...base].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
}

/** "Rice, eggs, milk +5 more" (receipt dot leaders dropped) */
const itemList = (all: string[]) => {
  const names = all.map((n) => n.replace(/[\s.·]+$/, ""));
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3} more` : names.join(", ");
};

const kindOf = (amount: number) => (amount > 0 ? "Income" : "Expense");
const amountOf = (amount: number | null, kind: Kind) =>
  amount == null
    ? { text: "₱0", tone: "empty" as const }
    : { text: `${kind === "Expense" ? "−" : kind === "Income" ? "+" : ""}${peso(amount)}`, tone: kind === "Expense" ? ("danger" as const) : kind === "Income" ? ("success" as const) : ("fg" as const) };
/** What the save toast shows: how big, where, and what kind. */
type Saved = {
  ids: string[];
  kind: string;
  amount: string;
  tone: "danger" | "success" | "fg";
  where: string;
  offline: boolean;
  /** cloud: the capture function saved it; Undo reverts that batch */
  undoEventId?: string;
  /** cloud: it landed in Review with this question */
  review?: string;
  /** cloud: kept on this phone to be read when back online; nothing to undo */
  later?: boolean;
};
const SAVED_MS = 7000; // long enough to read the amount and reach Undo

const saveLabel = (kind: Kind) => (kind === "Income" ? "Save income" : kind === "Transfer" ? "Save transfer" : "Save expense");

export function AddSheet({
  open,
  accountId,
  initialText,
  initialDate,
  onOpenChange,
}: {
  open: boolean;
  accountId?: string;
  /** a sentence ("grab gcash 248") read into the Manual draft */
  initialText?: string;
  initialDate?: string;
  onOpenChange: (o: boolean) => void;
}) {
  const { state, dispatch } = useLedger();
  const cloud = useCloud(); // null in local mode
  const accounts = state.accounts;
  // read when the sheet opens, without resetting it when accounts change
  const accountsRef = React.useRef(accounts);
  React.useLayoutEffect(() => {
    accountsRef.current = accounts;
  });

  const [mode, setMode] = React.useState<Mode>("Manual");
  const [saved, setSaved] = React.useState<Saved | null>(null);
  const [toastHeld, setToastHeld] = React.useState(false);
  const toast = useToastPresence(saved);

  // Manual draft
  const [acc, setAcc] = React.useState<string | null>(null);
  const [cat, setCat] = React.useState<Category | undefined>(undefined);
  const [kindOverride, setKindOverride] = React.useState<Kind | undefined>(undefined);
  const [amountStr, setAmountStr] = React.useState("");
  const [date, setDate] = React.useState(todayInput);
  const [note, setNote] = React.useState("");
  const [toAcc, setToAcc] = React.useState<string | undefined>(undefined);
  const amountRef = React.useRef<HTMLInputElement>(null);
  // a digit past the seven-digit cap was refused
  const [capped, setCapped] = React.useState(false);
  // "That's ₱X — is that right?" once, for an amount far outside the usual; holds only for that draft
  const [askedFor, setAskedFor] = React.useState<string | null>(null);

  // Camera draft
  const [camStage, setCamStage] = React.useState<CamStage>({ k: "viewfinder" });
  const [fix, setFix] = React.useState<Fix>(null);

  const receiptPath = React.useRef<string | undefined>(undefined);

  // An entry left half-done stays until it's saved or started over; closing never drops it.
  const hasDraft = React.useRef(false);
  const savedNow = React.useRef(false);
  const keep = React.useRef(false);
  const [kept, setKept] = React.useState(false);
  const [restart, setRestart] = React.useState(0);

  // Fresh sheet each time it opens, prefilled from the caller, unless a draft was kept.
  React.useEffect(() => {
    if (!open) {
      keep.current = !savedNow.current && hasDraft.current;
      return;
    }
    savedNow.current = false;
    setCapped(false);
    setAskedFor(null);
    if (keep.current && !accountId && !initialText && !initialDate) {
      keep.current = false;
      setKept(true);
      setCamStage((s) => (s.k === "read" ? s : { k: "viewfinder" }));
      return;
    }
    keep.current = false;
    setKept(false);
    receiptPath.current = undefined;
    const p = initialText?.trim() ? parseEntry(initialText, accountsRef.current) : null;
    setMode("Manual");
    setAcc(accountId ?? p?.accountId ?? null);
    // the sentence's guess; the toggle overrides it
    const guess: Kind | undefined = p?.category === "Investments" || p?.category === "Transfer" ? "Transfer" : p?.amount != null && p.amount > 0 ? "Income" : undefined;
    setCat(guess === "Transfer" ? undefined : (p?.category ?? undefined));
    setKindOverride(guess);
    setAmountStr(p?.amount != null ? String(Math.abs(Math.round(p.amount))) : "");
    setDate(initialDate ?? todayInput());
    setNote(p?.desc ?? "");
    setToAcc(guess === "Transfer" && p?.category === "Investments" ? accountsRef.current.find((a) => a.type === "investments" && a.id !== (accountId ?? p?.accountId))?.id : undefined);
    setCamStage({ k: "viewfinder" });
    setFix(null);
  }, [open, accountId, initialText, initialDate, restart]);

  // the toast holds while focus is inside it, so Undo can't vanish under a keyboard user
  React.useEffect(() => {
    if (!saved || toastHeld) return;
    const t = setTimeout(() => setSaved(null), SAVED_MS);
    return () => clearTimeout(t);
  }, [saved, toastHeld]);

  React.useEffect(() => {
    if (open && mode === "Camera") warmUp();
  }, [open, mode]);

  /* ---------- manual draft --------------------------------------------- */

  const kind: Kind = kindOverride ?? "Expense";
  const abs = amountStr && parseFloat(amountStr) > 0 ? parseFloat(amountStr) : null;
  const category: Category | null = kind === "Transfer" ? null : (cat ?? null);
  const signedAmount = abs == null ? null : kind === "Income" ? abs : -abs;
  const draftNow = abs != null || note.trim() !== "" || camStage.k === "read";
  React.useLayoutEffect(() => {
    hasDraft.current = draftNow;
  });

  const pickKind = (k: Kind) => {
    if (k === kind) return;
    setKindOverride(k === "Expense" ? undefined : k);
    setCat(undefined);
    setToAcc(undefined);
    setAskedFor(null);
  };

  // Rank pickers by how often this phone has used each value.
  const ranked = React.useMemo(() => {
    const cats = new Map<Category, number>();
    const accs = new Map<string, number>();
    for (const e of state.entries) {
      if (e.category) cats.set(e.category, (cats.get(e.category) ?? 0) + 1);
      if (e.accountId) accs.set(e.accountId, (accs.get(e.accountId) ?? 0) + 1);
    }
    return {
      spend: rankBy(SPEND_CATEGORIES, cats),
      income: rankBy(INCOME_CATEGORIES, cats),
      accounts: rankBy(accounts, new Map(accounts.map((x) => [x, accs.get(x.id) ?? 0]))),
    };
  }, [state.entries, accounts]);
  // money is spent from cash, banks, wallets and cards: an investments account is offered only
  // where money can come in or move (income, invest), not as the source of a purchase
  const spendable = React.useMemo(() => ranked.accounts.filter(canSpendFrom), [ranked.accounts]);
  // the account starts on the most-used one the kind allows, so most entries are amount + category
  const accOptions = kind === "Expense" ? spendable : ranked.accounts;
  const accId = acc != null && accOptions.some((x) => x.id === acc) ? acc : (accOptions[0]?.id ?? null);
  const account = accounts.find((x) => x.id === accId);
  // a transfer goes from any account to any other, investments included: money into an
  // investments account is how investing works (D-0010)
  const toOptions = accounts.filter((x) => x.id !== accId);
  const toAccount = kind === "Transfer" ? toOptions.find((x) => x.id === toAcc) : undefined;
  const short = kind === "Transfer" && account != null && abs != null && overdraws(account, abs);

  // whole pesos only: the row reads like the list does. Seven digits is the cap, and it says so.
  const typeAmount = (raw: string) => {
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    const max = String(MAX_AMOUNT).length;
    setCapped(digits.length > max);
    setAmountStr(digits.slice(0, max));
  };
  const capNote = capped ? `${peso(MAX_AMOUNT)} is the most one entry can hold.` : undefined;

  const done = (s: Omit<Saved, "offline">) => {
    savedNow.current = true;
    setKept(false);
    setSaved({ ...s, offline: !navigator.onLine });
    onOpenChange(false);
  };
  const undo = () => {
    const s = saved;
    setSaved(null);
    if (!s) return;
    if (cloud && s.undoEventId) {
      // the capture function saved it: undo_event reverts that whole batch (and anything it
      // marked, like a refunded purchase), so read the server again; offline → void instead.
      // Nothing is removed here first: an entry the capture only changed must stay.
      const ids = s.ids;
      undoEvent(s.undoEventId).then(
        (r) => {
          cloud.applyServer(r);
          void cloud.reload();
        },
        () => ids.forEach((id) => dispatch({ type: "delete-entry", id })),
      );
      return;
    }
    // deleting one leg of a transfer removes both; the second dispatch is then a no-op
    s.ids.forEach((id) => dispatch({ type: "delete-entry", id }));
  };

  /** cloud: what the capture function did, as the same toast the phone's own save shows */
  const captured = (r: CaptureResult, from: { kind: "photo"; storagePath?: string; image?: string }) => {
    const { image } = from;
    // a question with nothing filed ("I couldn’t find an amount"): keep it in Review, not just in the toast
    if (cloud && r.outcome === "review" && !r.entries.length) {
      const question = r.gate.question ?? "M8 couldn’t find an amount. How much was it?";
      const id = r.raw_input_id || newId("c");
      cloud.park({ id, at: Date.now(), kind: from.kind, storagePath: from.storagePath, question, image });
      return done({ ids: [id], kind: "In Review", amount: "—", tone: "fg", where: question, review: question });
    }
    cloud?.applyServer({
      entries: r.entries.map((e) => (image && e.receipt ? { ...e, receipt: { ...e.receipt, image } } : e)),
      removed: [],
    });
    // a refund lands in Review (it asks which purchase it was for): read the server again
    if (r.entries.some((e) => e.refunded)) void cloud?.reload();
    const total = r.entries.reduce((n, e) => n + e.amount, 0);
    const one = r.entries.length === 1 ? r.entries[0] : null;
    const k = kindOf(total);
    const shown = amountOf(Math.abs(total), k);
    const asked = r.entries.find((e) => e.status === "review");
    const review = r.outcome === "review" || !!asked;
    const question = r.gate.question ?? asked?.reviewQuestion;
    done({
      // only entries this capture created: a purchase it marked refunded is never voided by Undo
      ids: r.entries.filter((e) => !e.refunded).map((e) => e.id),
      kind: review ? "In Review" : one ? (one.source === "receipt" ? "Receipt" : k) : `${r.entries.length} entries`,
      amount: r.entries.length ? (one ? shown.text : balance(total)) : "—",
      tone: one ? (shown.tone === "empty" ? "fg" : shown.tone) : "fg",
      where: review
        ? (question ?? "M8 has a question about it. Answer it in Review.")
        : one
          ? `${acctName(one.accountId)} · ${one.category ?? "Needs category"}`
          : `${r.entries.length} entries`,
      undoEventId: r.undo_event_id,
      review: review ? (question ?? "") : undefined,
    });
  };
  const acctName = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name ?? "No account";

  const unusual = signedAmount != null && isUnusualAmount(signedAmount, category, state.entries);
  const draftKey = `${signedAmount}|${category}`;
  const confirmBig = askedFor === draftKey;

  const saveManual = () => {
    if (signedAmount == null) return;
    if (unusual && !confirmBig) return setAskedFor(draftKey);
    const when = date !== todayInput() ? new Date(`${date}T12:00:00`).toISOString() : new Date().toISOString();
    if (kind === "Transfer") {
      if (!account || !toAccount || abs == null || short) return;
      const legs = moveLegs({ from: account, to: toAccount, amount: abs, date: when, newId, desc: note.trim() || undefined, queued: !navigator.onLine });
      dispatch({ type: "add-entries", entries: legs });
      return done({
        ids: legs.map((l) => l.id),
        kind: legs[0].category === "Investments" ? "Investment" : "Transfer",
        amount: peso(abs),
        tone: "fg",
        where: `${account.name} → ${toAccount.name}`,
      });
    }
    const entry: Entry = {
      id: newId("e"),
      desc: note.trim() || category || kind,
      accountId: accId,
      category,
      amount: signedAmount,
      date: when,
      queued: !navigator.onLine,
    };
    dispatch({ type: "add-entry", entry });
    const shown = amountOf(abs, kind);
    done({
      ids: [entry.id],
      kind: kind === "Income" ? "Income" : "Expense",
      amount: shown.text,
      tone: shown.tone === "empty" ? "fg" : shown.tone,
      where: `${acctName(accId)} · ${category ?? "Needs category"}`,
    });
  };

  /* ---------- camera ----------------------------------------------------- */

  const read = async (canvas: HTMLCanvasElement) => {
    setFix(null);
    const image = await compressImage(canvas);
    receiptPath.current = undefined;
    if (cloud && navigator.onLine) {
      // cloud: M8 reads the photo on the server (Claude vision); the phone's reader is the fallback
      setCamStage({ k: "reading", image, progress: 0, cloud: true });
      try {
        const sharp = await compressImage(canvas, 1600, 0.8);
        receiptPath.current = await upload("receipts", cloud.uid, dataUrlToBlob(sharp), "jpg");
        const r = await capture({ client_id: newId("c"), kind: "photo", storage_path: receiptPath.current });
        if (r) return captured(r, { kind: "photo", storagePath: receiptPath.current, image });
      } catch {
        /* read it here instead */
      }
    }
    setCamStage({ k: "reading", image, progress: 0 });
    let readerRan = false;
    try {
      const ocr = await recognize(canvas, (progress) => setCamStage((s) => (s.k === "reading" ? { ...s, progress } : s)));
      readerRan = true;
      const draft = { ...parseReceipt(ocr.text, accounts), image };
      setCamStage(draft.total == null ? { k: "unreadable", failed: false } : { k: "read", draft });
    } catch {
      setCamStage({ k: "unreadable", failed: !readerRan });
    }
  };
  const receipt = camStage.k === "read" ? camStage.draft : null;
  const receiptEntry = receipt ? draftToEntry(receipt, "preview") : null;

  const saveReceipt = () => {
    if (!receipt) return;
    const base = draftToEntry(receipt, newId("e"));
    // cloud: the photo already uploaded for M8 stays with the entry
    const entry = { ...base, queued: !navigator.onLine, ...(receiptPath.current && base.receipt ? { receipt: { ...base.receipt, path: receiptPath.current } } : {}) };
    dispatch({ type: "add-entry", entry });
    done({
      ids: [entry.id],
      kind: "Receipt",
      amount: `−${peso(entry.amount)}`,
      tone: "danger",
      where: `${acctName(entry.accountId)} · ${entry.split?.length ? `${entry.split.length} categories` : (entry.category ?? "Needs category")}`,
    });
  };

  /* ---------- fixing a Camera draft ----------------------------- */

  // a receipt's amount and categories come from its items; only the account is picked here
  const openFix = (p: Part) => {
    if (p === "account") setFix({ part: "account" });
  };
  const fixPanel = (draft: { accountId: string | null }, update: (patch: { accountId: string | null }) => void) => {
    if (!fix) return null;
    return (
      <AccountPanel
        options={spendable}
        value={draft.accountId}
        onPick={(id) => {
          update({ accountId: id });
          setFix(null);
        }}
      />
    );
  };

  /* ---------- render ----------------------------------------------------- */

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setFix(null);
    setMode(m);
  };

  let body: React.ReactNode;
  let cta: { label: string; disabled: boolean; onClick: () => void };

  if (mode === "Manual") {
    const sign = kind === "Expense" ? "−" : kind === "Income" ? "+" : "";
    const canSave = signedAmount != null && (kind !== "Transfer" || (!!account && !!toAccount && !short));
    body = (
      <>
        <Segmented value={kind} options={KINDS} onChange={pickKind} />
        <div className="mt-5 flex flex-col gap-4">
          <AmountInput ref={amountRef} value={amountStr} onChange={typeAmount} sign={abs != null ? sign : ""} note={capNote} onEnter={() => canSave && saveManual()} />
          {kind !== "Transfer" ? (
            <PickField
              label="Category"
              value={category ?? ""}
              onChange={(v) => setCat(v as Category)}
              placeholder="Pick a category"
              options={(kind === "Income" ? ranked.income : ranked.spend).map((c) => ({ value: c, label: c }))}
            />
          ) : null}
          <PickField
            label={kind === "Transfer" ? "From" : kind === "Income" ? "Into" : "Paid with"}
            value={accId ?? ""}
            onChange={(id) => {
              setAcc(id);
              // a destination that is now the source has to be picked again
              if (id === toAcc) setToAcc(undefined);
            }}
            options={accOptions.map(accountOption)}
          />
          {kind === "Transfer" ? (
            <PickField label="To" value={toAccount?.id ?? ""} onChange={setToAcc} placeholder="Pick an account" options={toOptions.map(accountOption)} />
          ) : null}
          <DateField value={date} max={todayInput()} onChange={setDate} />
          <NoteField
            value={note}
            onChange={setNote}
            placeholder={kind === "Expense" ? "Optional: Grab, lunch w/ team" : kind === "Income" ? "Optional: Payroll" : "Optional: Move to savings"}
          />
        </div>
      </>
    );
    cta = {
      label: confirmBig ? `Yes, save ${amountOf(abs, kind).text}` : `${saveLabel(kind)}${abs != null ? ` · ${amountOf(abs, kind).text}` : ""}`,
      disabled: !canSave,
      onClick: saveManual,
    };
    if (short && account)
      body = (
        <>
          {body}
          <p role="alert" className="mt-3 text-[13px] text-danger">
            That would leave {account.name} at {balance(account.balance - (abs ?? 0))}. Move less, or pick another account.
          </p>
        </>
      );
    if (confirmBig && abs != null)
      body = (
        <>
          {body}
          <p role="alert" className="mt-3 text-[14px] leading-[1.5]">
            That’s <span className="tnum font-semibold">{peso(abs)}</span>. Is that right?{" "}
            <button type="button" onClick={() => { setAskedFor(null); amountRef.current?.focus(); }} className="relative font-medium underline underline-offset-4 after:absolute after:-inset-3 after:content-[''] active:opacity-60">
              Change it
            </button>
          </p>
        </>
      );
    if (kept)
      body = (
        <>
          <div className="mb-3 flex min-h-11 items-center justify-between gap-3 text-[13px] text-fg-muted" role="status">
            <span>Your unsaved entry is still here.</span>
            <button type="button" onClick={() => { setKept(false); setRestart((n) => n + 1); }} className="relative flex-none font-medium text-fg underline underline-offset-4 after:absolute after:-inset-3 after:content-[''] active:opacity-60">
              Start over
            </button>
          </div>
          {body}
        </>
      );
  } else {
    if (receipt && receiptEntry && fix) {
      body = (
        <>
          <ReceiptRow entry={receiptEntry} accounts={accounts} active={fix.part} onPart={openFix} />
          <div className="mt-3">
            {fixPanel({ accountId: receipt.accountId }, (patch) =>
              setCamStage((s) => (s.k === "read" && patch.accountId !== undefined ? { k: "read", draft: { ...s.draft, accountId: patch.accountId } } : s)),
            )}
          </div>
          <BackLink onClick={() => setFix(null)}>Done</BackLink>
        </>
      );
    } else if (receipt && receiptEntry) {
      const split = splitOf(receipt.items);
      const thumb = receipt.image ? (
        <img src={receipt.image} alt="" className="h-[52px] w-10 rounded-sm bg-cam object-cover" />
      ) : (
        <span className="block h-[52px] w-10 rounded-sm bg-cam" />
      );
      body = (
        <>
          {split.length > 1 ? (
            <ManyEntries
              count={`${split.length} CATEGORIES · ${balance(receiptEntry.amount)}`}
              needs={split.filter((s) => receipt.items.some((i) => i.category === s.category && i.unsure)).length}
              header={<ReceiptRow entry={receiptEntry} accounts={accounts} onPart={openFix} />}
            >
              {split.map((s) => {
                const unsure = receipt.items.some((i) => i.category === s.category && i.unsure);
                return (
                  <ListRow key={s.category}>
                    <div className="flex w-full items-center gap-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14.5px] leading-[1.3]">{itemList(s.items)}</div>
                        <div className="mt-[7px]">
                          <CategoryChip tone={unsure ? "warn" : "neutral"}>{unsure ? `${s.category}?` : s.category}</CategoryChip>
                        </div>
                      </div>
                      <span className="tnum text-[18px] font-semibold tracking-[-0.01em] text-danger">−{peso(s.amount)}</span>
                    </div>
                  </ListRow>
                );
              })}
            </ManyEntries>
          ) : (
            <ReceiptRow entry={receiptEntry} accounts={accounts} onPart={openFix} />
          )}
          <div className="mt-3">
            <SourceRow
              lead={thumb}
              label="READ FROM RECEIPT"
              action={
                <button type="button" onClick={() => setCamStage({ k: "viewfinder" })} className="flex-none text-[14px] font-medium underline underline-offset-4 active:opacity-60">
                  Retake
                </button>
              }
            >
              {receipt.merchant} · {receipt.items.length} {receipt.items.length === 1 ? "item" : "items"}
            </SourceRow>
          </div>
        </>
      );
    } else if (camStage.k === "reading") {
      body = (
        <div className="relative flex h-[300px] flex-col items-center justify-center gap-3 overflow-hidden rounded-lg bg-cam text-cam-ink" role="status">
          <img src={camStage.image} alt="" className="absolute inset-0 size-full object-cover opacity-40" />
          <span className="relative text-[14px] font-medium">Reading the receipt…</span>
          <span className="relative h-1 w-32 overflow-hidden rounded-full bg-cam-line">
            <span className="block h-full bg-highlight transition-[width] duration-200" style={{ width: `${Math.round(camStage.progress * 100)}%` }} />
          </span>
          <span className="relative font-mono text-[9.5px] tracking-[0.16em] text-cam-muted">{camStage.cloud ? "M8 IS READING IT" : "ON YOUR PHONE"}</span>
        </div>
      );
    } else if (camStage.k === "unreadable") {
      body = (
        <div className="flex h-[300px] flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[14px] leading-[1.5] text-fg-muted">
            {camStage.failed ? "The reader couldn’t start on this phone." : "I couldn’t read the total on that photo."} Try again in better light, or enter it in Manual.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setCamStage({ k: "viewfinder" })} className="h-11 rounded-md border border-line-strong px-4 text-[13px] font-medium active:bg-surface">
              Retake
            </button>
            <button type="button" onClick={() => switchMode("Manual")} className="h-11 rounded-md border border-line-strong px-4 text-[13px] font-medium active:bg-surface">
              Use Manual
            </button>
          </div>
        </div>
      );
    } else {
      body = (
        <>
          <SheetCamera onCapture={read} cloud={!!cloud && navigator.onLine} />
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              navigate("/scan");
            }}
            className="mt-1 h-11 text-[13px] font-medium text-fg-muted underline underline-offset-4 active:opacity-60"
          >
            Scan several receipts
          </button>
        </>
      );
    }
    cta = {
      label: receiptEntry ? `Save receipt · ${balance(receiptEntry.amount)}` : "Save expense",
      disabled: !receipt,
      onClick: saveReceipt,
    };
  }

  // Enter saves from anywhere in the sheet but a field or a button (the amount field's Enter means "Next").
  const keyboard = React.useRef<{ save?: () => void }>({});
  React.useLayoutEffect(() => {
    keyboard.current = { save: cta.disabled ? undefined : cta.onClick };
  });
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const { save } = keyboard.current;
      if (e.key === "Enter" && !e.repeat && save && !t?.closest("button, a, [role='button']")) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // D-0012: "Synced" only once the server has acknowledged every entry in the toast
  const synced = !!toast.shown && toast.shown.ids.every((id) => {
    const e = state.entries.find((x) => x.id === id);
    return !e || !e.queued;
  });

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="Add entry">
        <div className="pt-4">
          <Segmented value={mode} options={MODES} onChange={switchMode} />
          <div className="mt-3">{body}</div>
          <Cta className="mt-3" disabled={cta.disabled} onClick={cta.onClick}>
            {cta.label}
          </Cta>
        </div>
      </Sheet>
      <div role="status" className={TOAST_DOCK}>
        {toast.shown ? (
          <div
            className={cn("t-toast pointer-events-auto rounded-[18px] bg-accent px-4 pt-3.5 pb-3 text-accent-fg shadow-overlay", toast.open && "is-open")}
            onFocus={() => setToastHeld(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setToastHeld(false);
            }}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold tracking-[0.16em] text-accent-fg/60 uppercase">
                  <CheckIcon size={12} />
                  {cloud ? cloudLabel(toast.shown, synced) : `${toast.shown.kind} saved${toast.shown.offline ? " · on your phone" : ""}`}
                </div>
                <div className="tnum mt-2 text-[30px] leading-none font-semibold tracking-[-0.03em]">{toast.shown.amount}</div>
                <div className="mt-2 truncate text-[15px] text-accent-fg/85">{toast.shown.where}</div>
              </div>
              {toast.shown.ids.length || toast.shown.undoEventId ? (
                <button type="button" onClick={undo} className="-mr-1 flex h-11 flex-none items-center px-2 text-[15px] font-semibold text-highlight active:opacity-60">
                  Undo
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ---------- pieces --------------------------------------------------------- */

/** The toast's eyebrow in cloud mode: what happened, then where it is (D-0012 copy). */
function cloudLabel(s: Saved, synced: boolean) {
  if (s.review != null) return "In Review · M8 has a question";
  if (s.later) return "Saved on this phone";
  return `${s.kind} saved · ${synced ? "Synced" : "Saved on this phone"}`;
}

/** A receipt as the row it will be saved as; only the account is picked here. */
function ReceiptRow({ entry, accounts, active, onPart }: { entry: Entry; accounts: Account[]; active?: Part | null; onPart: (p: Part) => void }) {
  return (
    <DraftRow
      title={entry.desc}
      account={accounts.find((a) => a.id === entry.accountId)}
      amount={amountOf(Math.abs(entry.amount), "Expense")}
      chip={entry.category ? { label: entry.category, part: "category" } : { label: "Needs category", part: "category", warn: true }}
      active={active}
      onPart={onPart}
    />
  );
}

/**
 * Any number of entries (or receipt lines): a count and what still needs a
 * detail on top, then a fixed-height list that scrolls. The cut-off last row
 * says there's more.
 */
function ManyEntries({ count, needs, header, children }: { count: string; needs: number; header?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      {header ? <div className="mb-3">{header}</div> : null}
      <div className="flex items-center justify-between pt-1 pb-3 font-mono text-[9.5px] font-semibold tracking-[0.16em]">
        <span className="text-fg">{count}</span>
        {needs ? <span className="text-gold-ink">{needs === 1 ? "1 NEEDS A DETAIL" : `${needs} NEED A DETAIL`}</span> : null}
      </div>
      <div className="no-scrollbar max-h-[312px] overflow-y-auto overscroll-contain border-t border-line">{children}</div>
    </div>
  );
}

function ListRow({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  const cls = "block w-full border-b border-line py-3 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "active:opacity-60")}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mt-2 h-11 text-[13px] font-medium text-fg-muted underline underline-offset-4">
      {children}
    </button>
  );
}

/** The receipt viewfinder inside the sheet; the stream stops when it unmounts. */
function SheetCamera({ onCapture, cloud }: { onCapture: (c: HTMLCanvasElement) => void; cloud: boolean }) {
  const { video, status, start, snap } = useCamera();
  const file = React.useRef<HTMLInputElement>(null);
  const live = status === "live";
  const choose = () => file.current?.click();
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex h-[232px] items-center justify-center overflow-hidden rounded-lg bg-cam text-cam-ink">
        <video ref={video} playsInline muted className={cn("absolute inset-0 size-full object-cover", !live && "hidden")} />
        {live ? <ReceiptFrame className="h-[84%] w-[48%]" corner={24} /> : <CameraGate status={status} onAllow={start} onChoose={choose} cloud={cloud} />}
      </div>
      <div className="flex items-center gap-4">
        <p className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-fg-muted">
          Fit the whole receipt in the frame. We’ll read the total, shop and date.{" "}
          <button type="button" onClick={() => file.current?.click()} className="font-medium text-fg underline underline-offset-2">
            Choose a photo
          </button>
        </p>
        <button
          type="button"
          aria-label={live ? "Take photo" : "Choose a photo"}
          onClick={() => {
            const c = live ? snap() : null;
            if (c) onCapture(c);
            else choose();
          }}
          className="flex size-14 flex-none items-center justify-center rounded-full border-[3px] border-accent transition-transform duration-fast ease-out motion-safe:active:scale-[0.96]"
        >
          <span className="block size-11 rounded-full bg-highlight" />
        </button>
      </div>
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && fileToCanvas(e.target.files[0], onCapture)} />
    </div>
  );
}
