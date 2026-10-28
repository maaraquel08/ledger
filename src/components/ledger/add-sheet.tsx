import * as React from "react";
import { cn } from "@/lib/cn";
import { fileToCanvas, useCamera } from "@/lib/camera";
import { addDays, balance, dayName, MAX_AMOUNT, monthShort, peso } from "@/lib/format";
import { recognize, warmUp } from "@/lib/ocr";
import { INCOME_CATEGORIES, isUnusualAmount } from "@/lib/entry-rules";
import { isQuestion, parseEntry, parseSpoken, splitEntries, type Parsed } from "@/lib/parse";
import { SPEND_CATEGORIES } from "@/lib/providers";
import { compressImage, draftToEntry, parseReceipt, splitOf, type ReceiptDraft } from "@/lib/receipt";
import { accountLabel } from "@/lib/selectors";
import { navigate } from "@/lib/router";
import { newId, useLedger } from "@/lib/store";
import type { Account, Category, Entry } from "@/lib/types";
import { useVoice, type VoiceError } from "@/lib/voice";
import { capture, dataUrlToBlob, undoEvent, upload, type CaptureResult } from "@/lib/cloud/api";
import { useCloud } from "@/lib/cloud/provider";
import { extFor, recorderSupported, useRecorder } from "@/lib/recorder";
import { CameraGate, ReceiptFrame } from "./camera";
import {
  AccountPanel,
  CategoryPanel,
  DatePanel,
  DescPanel,
  DraftRow,
  KeypadPanel,
  KindPanel,
  SourceRow,
  type Kind,
  type Part,
} from "./entry-draft";
import { CheckIcon, MicIcon } from "./icons";
import { Orb } from "./orb";
import { CategoryChip, Cta, EntryRow, Segmented, Sheet } from "./primitives";
import { TOAST_DOCK, useToastPresence } from "./undo-toast";

/*
 * Add entry, three ways in: Manual (the draft row over one swapping picker),
 * Voice (hold the orb) and Camera (a receipt read on the phone).
 * Every way ends in the same Activity row; missing parts stay gold and open
 * the same pickers. Study B in design-ledger/studies/add-entry-selection.
 */

type Mode = "Manual" | "Voice" | "Camera";
const MODES: Mode[] = ["Manual", "Voice", "Camera"];

type VoiceStage = { k: "idle"; hint?: string } | { k: "listening" } | { k: "sending" } | { k: "heard"; text: string; items: Parsed[] };
type CamStage =
  | { k: "viewfinder" }
  /** cloud: M8 reads it on the server; otherwise the phone's own reader */
  | { k: "reading"; image: string; progress: number; cloud?: boolean }
  | { k: "read"; draft: ReceiptDraft }
  | { k: "unreadable"; failed: boolean };
/** A Voice or Camera draft part being fixed with its picker. */
type FixPart = "amount" | "category" | "account";
type Fix = { i: number; part: FixPart } | null;

const KIND_WORD: Record<Kind, string> = { Expense: "Spent", Income: "Got", Invest: "Moved" };
const HOLD_MS = 280; // shorter than this is a tap, not a hold

const VOICE_ERROR: Record<VoiceError, string> = {
  denied: "Microphone access is off. Allow it in your browser’s site settings, or use Manual.",
  unsupported: "Voice isn’t supported in this browser. Use Manual.",
  "no-speech": "Couldn’t hear that. Hold and try again.",
  network: "Voice needs a connection in this browser. Use Manual.",
  other: "Couldn’t hear that. Hold and try again.",
};

const inputDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayInput = () => inputDay(new Date());
const yesterdayInput = () => inputDay(addDays(new Date(), -1));

/** "Today · Thu 29 Oct", "Yesterday · Wed 28 Oct", "Tue 20 Oct" */
function dayLabel(day: string) {
  const d = new Date(`${day}T12:00:00`);
  const short = `${dayName(d).slice(0, 3)} ${d.getDate()} ${monthShort(d)}`;
  if (day === todayInput()) return `Today · ${short}`;
  if (day === yesterdayInput()) return `Yesterday · ${short}`;
  return short;
}

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

const saveLabel = (kind: Kind) => (kind === "Income" ? "Save income" : kind === "Invest" ? "Save investment" : "Save expense");

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
  // the part being edited; null = draft complete
  const [part, setPart] = React.useState<Part | null>("amount");
  // the keypad's seven digits are full
  const [capped, setCapped] = React.useState(false);
  // "That's ₱X — is that right?" once, for an amount far outside the usual; holds only for that draft
  const [askedFor, setAskedFor] = React.useState<string | null>(null);

  // Voice and Camera drafts
  const [voiceStage, setVoiceStage] = React.useState<VoiceStage>({ k: "idle" });
  const [camStage, setCamStage] = React.useState<CamStage>({ k: "viewfinder" });
  const [fix, setFix] = React.useState<Fix>(null);
  const [fixAmount, setFixAmount] = React.useState("");

  const recorder = useRecorder();
  const recording = React.useRef(false);
  // cloud: while the clip goes to the server, the phone's transcript waits here as the fallback
  const spoken = React.useRef<((text: string) => void) | null>(null);
  const receiptPath = React.useRef<string | undefined>(undefined);

  const hear = (said: string) => {
      const text = said.trim();
      if (isQuestion(text)) return setVoiceStage({ k: "idle", hint: "That sounds like a question. Ask M8 from Today." });
      const items = splitEntries(text)
        .map((s) => parseSpoken(s, accounts))
        .filter((p) => p.amount != null);
      if (!items.length) {
        // cloud and offline: keep what was said; the capture function files it (or asks) when we're back
        if (cloud && text && !navigator.onLine) {
          dispatch({ type: "queue-capture", id: newId("c"), text });
          done({ ids: [], kind: "Voice note", amount: "Kept", tone: "fg", where: `“${text}” · filed when you’re back online`, later: true });
          return;
        }
        return setVoiceStage({ k: "idle", hint: "I didn’t catch an amount. Try “₱248 Grab, GCash”." });
      }
      setVoiceStage({ k: "heard", text, items });
  };
  const voice = useVoice({
    onDone: (said) => {
      if (spoken.current) return spoken.current(said);
      hear(said);
    },
    onError: (kind, heardNow) => {
      if (spoken.current) return spoken.current(heardNow);
      // cloud: the clip is still recording; the server transcribes it without the browser's help
      if (recording.current && kind === "unsupported") return;
      setVoiceStage((s) => (s.k === "listening" ? { k: "idle", hint: VOICE_ERROR[kind] } : s));
    },
  });
  const cancelVoice = voice.cancel;

  // An entry left half-done stays until it's saved or started over; closing never drops it.
  const hasDraft = React.useRef(false);
  const savedNow = React.useRef(false);
  const keep = React.useRef(false);
  const [kept, setKept] = React.useState(false);
  const [restart, setRestart] = React.useState(0);

  // Fresh sheet each time it opens, prefilled from the caller, unless a draft was kept.
  React.useEffect(() => {
    if (!open) {
      cancelVoice();
      keep.current = !savedNow.current && hasDraft.current;
      return;
    }
    savedNow.current = false;
    setCapped(false);
    setAskedFor(null);
    if (keep.current && !accountId && !initialText && !initialDate) {
      keep.current = false;
      setKept(true);
      setVoiceStage((s) => (s.k === "heard" ? s : { k: "idle" }));
      setCamStage((s) => (s.k === "read" ? s : { k: "viewfinder" }));
      return;
    }
    keep.current = false;
    setKept(false);
    receiptPath.current = undefined;
    const p = initialText?.trim() ? parseEntry(initialText, accountsRef.current) : null;
    setMode("Manual");
    setAcc(accountId ?? p?.accountId ?? null);
    setCat(p?.category ?? undefined);
    setKindOverride(p?.amount != null && p.amount > 0 ? "Income" : undefined);
    setAmountStr(p?.amount != null ? String(Math.abs(Math.round(p.amount))) : "");
    setDate(initialDate ?? todayInput());
    setNote(p?.desc ?? "");
    setToAcc(undefined);
    setPart("amount");
    setVoiceStage({ k: "idle" });
    setCamStage({ k: "viewfinder" });
    setFix(null);
  }, [open, accountId, initialText, initialDate, cancelVoice, restart]);

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
  const category: Category | null = kind === "Invest" ? "Investments" : (cat ?? null);
  const account = accounts.find((a) => a.id === acc);
  // Invest moves money into an investments account (never the one it leaves).
  const investAccounts = accounts.filter((a) => a.type === "investments" && a.id !== acc);
  const toAccount = kind === "Invest" ? (investAccounts.find((a) => a.id === toAcc) ?? investAccounts[0]) : undefined;
  const signedAmount = abs == null ? null : kind === "Income" ? abs : -abs;
  const draftNow = abs != null || note.trim() !== "" || voiceStage.k === "heard" || camStage.k === "read";
  React.useLayoutEffect(() => {
    hasDraft.current = draftNow;
  });

  // first required part still empty, after the change just made
  const missing = (o: { amt?: boolean; cat?: boolean; acc?: boolean } = {}): Part | null => {
    if (!(o.amt ?? abs != null)) return "amount";
    if (kind !== "Invest" && !(o.cat ?? !!category)) return "category";
    if (!(o.acc ?? !!acc)) return "account";
    return null;
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

  // whole pesos only: the row reads like the list does. Seven digits is the cap, and it says so.
  const keyInto = (value: string, set: React.Dispatch<React.SetStateAction<string>>) => (k: string) => {
    if (k === "⌫") {
      setCapped(false);
      return set(value.slice(0, -1));
    }
    if (value.length >= String(MAX_AMOUNT).length) return setCapped(true);
    set(value === "0" ? k : value + k);
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
  const captured = (r: CaptureResult, image?: string) => {
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
    const entry: Entry = {
      id: newId("e"),
      desc: note.trim() || category || kind,
      accountId: acc,
      category,
      amount: signedAmount,
      date: when,
      queued: !navigator.onLine,
    };
    const ids = [entry.id];
    if (toAccount) {
      const linkId = newId("l");
      const leg = { ...entry, id: newId("e"), accountId: toAccount.id, amount: -signedAmount, linkId };
      ids.push(leg.id);
      dispatch({ type: "add-entries", entries: [{ ...entry, linkId }, leg] });
    } else dispatch({ type: "add-entry", entry });
    const shown = amountOf(abs, kind);
    done({
      ids,
      kind: kind === "Income" ? "Income" : kind === "Invest" ? "Investment" : "Expense",
      amount: shown.text,
      tone: shown.tone === "empty" ? "fg" : shown.tone,
      where: toAccount ? `${acctName(acc)} → ${toAccount.name}` : `${acctName(acc)} · ${category ?? "Needs category"}`,
    });
  };

  /* ---------- voice ------------------------------------------------------ */

  const pressAt = React.useRef<number | null>(null);
  // cloud + online: record the clip too, so the server can transcribe it
  const begin = () => {
    pressAt.current = Date.now();
    setFix(null);
    setVoiceStage({ k: "listening" });
    recording.current = !!cloud && navigator.onLine && recorderSupported;
    if (recording.current) recorder.start();
    voice.start();
  };
  const sendClip = async () => {
    const said = new Promise<string>((resolve) => {
      spoken.current = (t) => {
        spoken.current = null;
        resolve(t);
      };
    });
    voice.finish();
    setVoiceStage({ k: "sending" });
    const clip = await recorder.stop();
    if (clip && cloud) {
      try {
        const path = await upload("voice", cloud.uid, clip, extFor(clip.type));
        const r = await capture({ client_id: newId("c"), kind: "voice", storage_path: path });
        if (r) {
          spoken.current = null;
          voice.cancel();
          captured(r);
          return;
        }
      } catch {
        /* the phone's transcript below */
      }
    }
    // no AI on the server, offline, or it failed: read the transcript on the phone
    const text = await Promise.race([said, new Promise<string>((r) => setTimeout(() => r(""), 4000))]);
    spoken.current = null;
    if (text.trim()) hear(text);
    else setVoiceStage({ k: "idle", hint: VOICE_ERROR["no-speech"] });
  };
  const release = () => {
    const t = pressAt.current;
    pressAt.current = null;
    if (t == null) return;
    if (Date.now() - t < HOLD_MS) {
      voice.cancel();
      if (recording.current) recorder.cancel();
      recording.current = false;
      setVoiceStage({ k: "idle", hint: "Hold the button while you talk." });
      return;
    }
    if (recording.current) {
      recording.current = false;
      void sendClip();
      return;
    }
    voice.finish();
  };
  const orb = {
    onDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      begin();
    },
    onMove: () => {},
    onUp: release,
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat && pressAt.current == null) {
        e.preventDefault();
        begin();
      }
    },
    onKeyUp: (e: React.KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") release();
    },
  };

  const heard = voiceStage.k === "heard" ? voiceStage : null;
  const setItem = (i: number, patch: Partial<Parsed>) =>
    setVoiceStage((s) => (s.k === "heard" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) } : s));
  const itemMissing = (p: Parsed): FixPart | null =>
    p.amount == null ? "amount" : !p.category ? "category" : !p.accountId ? "account" : null;

  const saveVoice = () => {
    if (!heard) return;
    const base = Date.now();
    const ids = heard.items.map(() => newId("e"));
    heard.items.forEach((p, i) =>
      dispatch({
        type: "add-entry",
        entry: {
          id: ids[i],
          desc: p.desc,
          accountId: p.accountId,
          category: p.category,
          amount: p.amount ?? 0,
          date: new Date(base + i).toISOString(),
          raw: heard.text,
          queued: !navigator.onLine,
          source: "voice",
        },
      }),
    );
    const total = heard.items.reduce((n, p) => n + (p.amount ?? 0), 0);
    const one = heard.items.length === 1 ? heard.items[0] : null;
    const k = kindOf(total);
    const shown = amountOf(Math.abs(total), k);
    done({
      ids,
      kind: one ? k : `${heard.items.length} entries`,
      amount: one ? shown.text : balance(total),
      tone: one ? (shown.tone === "empty" ? "fg" : shown.tone) : "fg",
      where: one ? `${acctName(one.accountId)} · ${one.category ?? "Needs category"}` : `“${heard.text}”`,
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
        if (r) return captured(r, image);
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

  /* ---------- fixing a Voice or Camera draft ----------------------------- */

  const openFix = (i: number, p: Part) => {
    if (p !== "amount" && p !== "category" && p !== "account") return;
    // a receipt's amount and categories come from its items
    if (mode === "Camera" && p !== "account") return;
    setFixAmount("");
    setFix({ i, part: p });
  };
  const fixPanel = (draft: { amount: number | null; category: Category | null; accountId: string | null }, update: (patch: Partial<Parsed>) => void) => {
    if (!fix) return null;
    const next = (patch: Partial<Parsed>) => {
      update(patch);
      const after = { ...draft, ...patch } as Parsed;
      const m = mode === "Camera" ? null : itemMissing(after);
      setFix(m ? { i: fix.i, part: m } : null);
    };
    if (fix.part === "amount")
      return (
        <KeypadPanel
          onKey={keyInto(fixAmount, setFixAmount)}
          note={capNote}
          canNext={!!fixAmount && parseFloat(fixAmount) > 0}
          onNext={() => next({ amount: -parseFloat(fixAmount) })}
        />
      );
    if (fix.part === "category")
      return (
        <CategoryPanel
          options={draft.amount != null && draft.amount > 0 ? ranked.income : ranked.spend}
          value={draft.category}
          onPick={(c) => next({ category: c })}
        />
      );
    return <AccountPanel options={ranked.accounts} value={draft.accountId} onPick={(id) => next({ accountId: id })} />;
  };

  /* ---------- render ----------------------------------------------------- */

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    voice.cancel();
    setFix(null);
    if (voiceStage.k === "listening") setVoiceStage({ k: "idle" });
    setMode(m);
  };

  const rowOf = (p: Parsed, active: Part | null, onPart?: (part: Part) => void) => {
    const k = p.amount != null ? kindOf(p.amount) : "Expense";
    return (
      <DraftRow
        title={p.desc}
        account={accounts.find((a) => a.id === p.accountId)}
        amount={amountOf(p.amount == null ? null : Math.abs(p.amount), k)}
        chip={p.category ? { label: p.category, part: "category" } : { label: "Needs category", part: "category", warn: true }}
        active={active}
        onPart={onPart}
      />
    );
  };

  let body: React.ReactNode;
  let cta: { label: string; disabled: boolean; onClick: () => void };

  if (mode === "Manual") {
    body = (
      <>
        <DraftRow
          title={note.trim() || KIND_WORD[kind]}
          account={account}
          amount={amountOf(abs, kind)}
          chip={
            kind === "Invest"
              ? toAccount
                ? { label: `To ${accountLabel(toAccount)}`, part: "to" }
                : { label: "No investments account", part: "to", warn: true }
              : category
                ? { label: category, part: "category" }
                : { label: "Needs category", part: "category", warn: true }
          }
          active={part}
          onPart={(p) => setPart(part === p ? null : p)}
        />
        <div className="mt-3">
          {part === "kind" ? (
            <KindPanel
              value={kind}
              noInvestAccount={!accounts.some((a) => a.type === "investments")}
              onPick={(k) => {
                setKindOverride(k);
                setCat(undefined);
                setPart(abs == null ? "amount" : k === "Invest" ? missing({ cat: true }) : "category");
              }}
            />
          ) : part === "amount" ? (
            <KeypadPanel onKey={keyInto(amountStr, setAmountStr)} note={capNote} canNext={abs != null} onNext={() => setPart(missing({ amt: true }))} />
          ) : part === "desc" ? (
            <DescPanel
              value={note}
              onChange={setNote}
              placeholder={kind === "Expense" ? "Grab, Landers, lunch w/ team" : kind === "Income" ? "Payroll · Acme Inc." : "VOO"}
              onDone={() => setPart(missing())}
            />
          ) : part === "category" ? (
            <CategoryPanel
              options={kind === "Income" ? ranked.income : ranked.spend}
              value={category}
              onPick={(c) => {
                setCat(c);
                setPart(missing({ cat: true }));
              }}
            />
          ) : part === "account" ? (
            <AccountPanel
              options={ranked.accounts}
              value={acc}
              allowNone
              onPick={(id) => {
                setAcc(id);
                setPart(missing({ acc: true }));
              }}
            />
          ) : part === "to" ? (
            <AccountPanel
              options={investAccounts}
              value={toAccount?.id ?? null}
              onPick={(id) => {
                if (id) setToAcc(id);
                setPart(null);
              }}
            />
          ) : part === "date" ? (
            <DatePanel
              value={date}
              today={todayInput()}
              yesterday={yesterdayInput()}
              onPick={(d) => {
                setDate(d);
                setPart(null);
              }}
            />
          ) : (
            <div className="flex h-12 items-center justify-between border-y border-line text-[14px]">
              <button type="button" onClick={() => setPart("date")} className="text-fg-muted active:opacity-60">
                {dayLabel(date)}
              </button>
              <button type="button" onClick={() => setPart("desc")} className="font-medium underline underline-offset-4 active:opacity-60">
                {note.trim() ? "Edit note" : "Add note"}
              </button>
            </div>
          )}
        </div>
      </>
    );
    cta = {
      label: confirmBig ? `Yes, save ${amountOf(abs, kind).text}` : `${saveLabel(kind)}${abs != null ? ` · ${amountOf(abs, kind).text}` : ""}`,
      disabled: signedAmount == null,
      onClick: saveManual,
    };
    if (confirmBig && abs != null)
      body = (
        <>
          {body}
          <p role="alert" className="mt-3 text-[14px] leading-[1.5]">
            That’s <span className="tnum font-semibold">{peso(abs)}</span>. Is that right?{" "}
            <button type="button" onClick={() => { setAskedFor(null); setPart("amount"); }} className="relative font-medium underline underline-offset-4 after:absolute after:-inset-3 after:content-[''] active:opacity-60">
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
  } else if (mode === "Voice") {
    if (heard && fix) {
      const item = heard.items[fix.i];
      body = (
        <>
          {rowOf(item, fix.part, (p) => openFix(fix.i, p))}
          <div className="mt-3">{fixPanel(item, (patch) => setItem(fix.i, patch))}</div>
          <BackLink onClick={() => setFix(null)}>{heard.items.length > 1 ? "Back to the list" : "Done"}</BackLink>
        </>
      );
    } else if (heard) {
      const again = (
        <button
          type="button"
          aria-label="Say it again"
          onClick={() => setVoiceStage({ k: "idle" })}
          className="flex size-12 items-center justify-center rounded-full bg-highlight text-highlight-fg active:opacity-80"
        >
          <MicIcon size={20} />
        </button>
      );
      body =
        heard.items.length === 1 ? (
          <>
            {rowOf(heard.items[0], null, (p) => openFix(0, p))}
            <div className="mt-3">
              <SourceRow lead={again} label="HEARD">
                “{heard.text}”
              </SourceRow>
            </div>
          </>
        ) : (
          <>
            <ManyEntries
              count={`${heard.items.length} ENTRIES · ${balance(heard.items.reduce((n, p) => n + (p.amount ?? 0), 0))}`}
              needs={heard.items.filter((p) => itemMissing(p)).length}
            >
              {heard.items.map((p, i) => (
                <ListRow key={i} onClick={() => openFix(i, itemMissing(p) ?? "category")}>
                  <EntryRow
                    entry={{ id: `heard-${i}`, desc: p.desc, accountId: p.accountId, category: p.category, amount: p.amount ?? 0, date: "" }}
                    account={accounts.find((a) => a.id === p.accountId)}
                  />
                </ListRow>
              ))}
            </ManyEntries>
            <div className="mt-3">
              <SourceRow lead={again} label="HEARD">
                <span className="line-clamp-2">“{heard.text}”</span>
              </SourceRow>
            </div>
          </>
        );
    } else {
      const listening = voiceStage.k === "listening";
      const sending = voiceStage.k === "sending";
      body = (
        <div className="flex h-[300px] flex-col items-center justify-center gap-[46px]">
          <Orb size={132} tone={listening ? "loud" : "normal"} {...orb} label={listening ? "Release to finish" : "Hold to talk"}>
            <MicIcon size={40} />
          </Orb>
          <div className="flex flex-col items-center gap-1.5 px-6 text-center" role="status">
            <span className="text-[15px] font-semibold">{listening ? "Listening…" : sending ? "Filing it…" : "Hold to log"}</span>
            <span className="text-[13px] leading-[1.45] text-fg-subtle">
              {listening
                ? voice.heard || "Release when you’re done"
                : sending
                  ? voice.heard || "M8 is listening to the clip"
                  : voiceStage.k === "idle" && voiceStage.hint
                    ? voiceStage.hint
                    : "“₱248 Grab to work, GCash”"}
            </span>
          </div>
        </div>
      );
    }
    const total = heard ? heard.items.reduce((n, p) => n + (p.amount ?? 0), 0) : 0;
    cta = {
      label: !heard
        ? "Save expense"
        : heard.items.length === 1
          ? `${saveLabel(kindOf(total))} · ${amountOf(Math.abs(total), kindOf(total)).text}`
          : `Save ${heard.items.length} entries · ${balance(total)}`,
      disabled: !heard,
      onClick: saveVoice,
    };
  } else {
    if (receipt && receiptEntry && fix) {
      body = (
        <>
          <ReceiptRow entry={receiptEntry} accounts={accounts} active={fix.part} onPart={(p) => openFix(0, p)} />
          <div className="mt-3">
            {fixPanel({ amount: receiptEntry.amount, category: receiptEntry.category, accountId: receipt.accountId }, (patch) =>
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
              header={<ReceiptRow entry={receiptEntry} accounts={accounts} onPart={(p) => openFix(0, p)} />}
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
            <ReceiptRow entry={receiptEntry} accounts={accounts} onPart={(p) => openFix(0, p)} />
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
          <SheetCamera onCapture={read} />
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

  // A physical keyboard drives the keypad: digits and Backspace while it shows, Enter saves.
  const keyboard = React.useRef<{ key?: (k: string) => void; save?: () => void }>({});
  const keypadKey =
    mode === "Manual" && part === "amount" ? keyInto(amountStr, setAmountStr) : fix?.part === "amount" ? keyInto(fixAmount, setFixAmount) : undefined;
  React.useLayoutEffect(() => {
    keyboard.current = { key: keypadKey, save: cta.disabled ? undefined : cta.onClick };
  });
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const { key, save } = keyboard.current;
      if (/^[0-9]$/.test(e.key) && key) {
        e.preventDefault();
        key(e.key);
      } else if (e.key === "Backspace" && key) {
        e.preventDefault();
        key("⌫");
      } else if (e.key === "Enter" && !e.repeat && save && (!t?.closest("button, a, [role='button']") || t.closest("[data-keypad]"))) {
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
function SheetCamera({ onCapture }: { onCapture: (c: HTMLCanvasElement) => void }) {
  const { video, status, start, snap } = useCamera();
  const file = React.useRef<HTMLInputElement>(null);
  const live = status === "live";
  const choose = () => file.current?.click();
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex h-[232px] items-center justify-center overflow-hidden rounded-lg bg-cam text-cam-ink">
        <video ref={video} playsInline muted className={cn("absolute inset-0 size-full object-cover", !live && "hidden")} />
        {live ? <ReceiptFrame className="h-[84%] w-[48%]" corner={24} /> : <CameraGate status={status} onAllow={start} onChoose={choose} />}
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
