import * as React from "react";
import { CameraGate, ReceiptFrame } from "@/components/ledger/camera";
import { fileToCanvas, useCamera } from "@/lib/camera";
import { CloseIcon, Sparkle } from "@/components/ledger/icons";
import { Pill, Sheet } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { peso, shortDay } from "@/lib/format";
import { recognize, warmUp, type OcrLine } from "@/lib/ocr";
import { SPEND_CATEGORIES } from "@/lib/providers";
import { compressImage, draftToEntry, findDuplicate, parseReceipt, splitOf, type ReceiptDraft } from "@/lib/receipt";
import { back } from "@/lib/router";
import { newId, useLedger } from "@/lib/store";
import type { Account, Category, Entry } from "@/lib/types";

/*
 * Receipt scanner — the full-screen capture mode behind Add's Camera, for
 * several receipts in a row. Snap it and M8 reads the merchant, total and
 * how you paid, then splits the items by category. It only stops to ask
 * when it isn't sure, or when the receipt looks already logged.
 */

type Stage =
  | { k: "camera" }
  | { k: "reading"; image: string; progress: number; lines: OcrLine[]; draft?: ReceiptDraft; size: { w: number; h: number } }
  | { k: "review"; draft: ReceiptDraft }
  | { k: "unreadable"; image: string; draft: ReceiptDraft; failed?: boolean }
  | { k: "duplicate"; draft: ReceiptDraft; matchId: string };

const READ_HOLD_MS = 900; // let the filled-in fields land before moving on

export function Scan() {
  const { state, dispatch } = useLedger();
  const [stage, setStage] = React.useState<Stage>({ k: "camera" });
  const [logged, setLogged] = React.useState<string[]>([]);
  const [toast, setToast] = React.useState<{ desc: string; amount: string } | null>(null);

  React.useEffect(() => warmUp(), []);

  const log = (draft: ReceiptDraft) => {
    const id = newId("e");
    const entry = draftToEntry(draft, id);
    dispatch({ type: "add-entry", entry: { ...entry, queued: !navigator.onLine } });
    setLogged((l) => [...l, id]);
    setToast({ desc: entry.desc, amount: `−${peso(entry.amount)}` });
    setStage({ k: "camera" });
  };

  // the receipt matches something already logged by voice or typing
  const resolveDuplicate = (draft: ReceiptDraft, matchId: string, choice: "attach" | "new" | "discard") => {
    if (choice === "new") return log(draft);
    if (choice === "attach") {
      const e = draftToEntry(draft, matchId);
      dispatch({ type: "update-entry", id: matchId, patch: { split: e.split, receipt: e.receipt, category: e.category ?? undefined } });
      setLogged((l) => [...l, matchId]);
      setToast({ desc: e.desc, amount: "attached" });
    }
    setStage({ k: "camera" });
  };

  // one photo → OCR → draft → log, review, or say why not
  const read = async (canvas: HTMLCanvasElement) => {
    const image = await compressImage(canvas);
    setToast(null);
    setStage({ k: "reading", image, progress: 0, lines: [], size: { w: canvas.width, h: canvas.height } });
    let readerRan = false;
    try {
      const ocr = await recognize(canvas, (p) => setStage((s) => (s.k === "reading" ? { ...s, progress: p } : s)));
      readerRan = true;
      const draft = { ...parseReceipt(ocr.text, state.accounts), image };
      setStage((s) => (s.k === "reading" ? { ...s, progress: 1, lines: ocr.lines, draft } : s));
      await new Promise((r) => setTimeout(r, READ_HOLD_MS));

      if (draft.total == null) return setStage({ k: "unreadable", image, draft });
      const dup = findDuplicate(draft, state.entries);
      if (dup) return setStage({ k: "duplicate", draft, matchId: dup.id });
      if (draft.doubts.length) return setStage({ k: "review", draft });
      log(draft);
    } catch {
      setStage({ k: "unreadable", image, failed: !readerRan, draft: { merchant: "Receipt", total: null, items: [], accountId: null, when: new Date().toISOString(), image, doubts: [] } });
    }
  };

  if (stage.k === "review")
    return (
      <Review
        draft={stage.draft}
        accounts={state.accounts}
        onRetake={() => setStage({ k: "camera" })}
        onLog={(d) => log(d)}
      />
    );

  return (
    <div className="fixed inset-0 z-30 mx-auto flex w-full max-w-[430px] flex-col bg-cam text-cam-ink">
      {stage.k === "camera" ? (
        <Camera
          count={logged.length}
          toast={toast}
          onClose={() => back(logged.length ? "/money" : "/today")}
          onCapture={read}
        />
      ) : stage.k === "reading" ? (
        <Reading stage={stage} accounts={state.accounts} />
      ) : stage.k === "duplicate" ? (
        <Duplicate
          match={state.entries.find((e) => e.id === stage.matchId)}
          onChoose={(choice) => resolveDuplicate(stage.draft, stage.matchId, choice)}
        />
      ) : (
        <Unreadable
          image={stage.image}
          failed={stage.failed}
          onRetake={() => setStage({ k: "camera" })}
          onTotal={(total) => {
            const d = stage.draft;
            setStage({
              k: "review",
              draft: {
                ...d,
                total,
                items: d.items.length ? d.items : [{ name: d.merchant, amount: total, category: "Other", unsure: true }],
                doubts: [...d.doubts, "I couldn’t read the total, so check the category."],
              },
            });
          }}
        />
      )}
    </div>
  );
}

/* ---------- r1 · camera ---------------------------------------------------- */

function Camera({
  count,
  toast,
  onClose,
  onCapture,
}: {
  count: number;
  toast: { desc: string; amount: string } | null;
  onClose: () => void;
  onCapture: (c: HTMLCanvasElement) => void;
}) {
  const { video, status, start, torch, snap: frame, flash } = useCamera();
  const live = status === "live";
  const file = React.useRef<HTMLInputElement>(null);

  const snap = () => {
    const c = frame();
    if (c) onCapture(c);
    else file.current?.click();
  };

  const pick = (f: File | undefined) => {
    if (f) fileToCanvas(f, onCapture);
  };

  return (
    <>
      <div className="relative z-10 flex items-center justify-between px-6 pt-[max(14px,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          aria-label={count ? "Done" : "Close"}
          className={cn("relative flex h-9 items-center justify-center rounded-full bg-cam-ink/12 after:absolute after:-inset-1 after:content-['']", count ? "px-3.5 text-[13px] font-semibold" : "w-9")}
        >
          {count ? `Done · ${count}` : <CloseIcon size={14} />}
        </button>
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.16em] text-cam-muted">RECEIPT</span>
        <span className="w-9" />
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_40%,color-mix(in_oklab,var(--color-cam-muted)_35%,var(--color-cam))_0%,var(--color-cam)_75%)]">
        <video ref={video} playsInline muted className={cn("absolute inset-0 size-full object-cover", !live && "hidden")} />
        {live ? <ReceiptFrame /> : <CameraGate status={status} onAllow={start} onChoose={() => file.current?.click()} />}
        {toast ? (
          <div role="status" className="absolute inset-x-5 bottom-4 flex items-center gap-3 rounded-[14px] bg-cam-sheet/95 px-4 py-3 screen-in">
            <Sparkle size={12} />
            <span className="min-w-0 flex-1 truncate text-[13.5px]">Logged {toast.desc}</span>
            <span className="tnum flex-none text-[13.5px]">{toast.amount}</span>
            <span className="font-mono text-[9.5px] text-cam-muted">SCAN ANOTHER</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-[18px] bg-cam px-8 pt-5 pb-[max(28px,env(safe-area-inset-bottom))]">
        <p className="text-[13px] text-cam-ink/85">{live ? "Fit the whole receipt in the frame" : "Choose a photo of the receipt"}</p>
        <div className="flex w-full items-center justify-between">
          <button type="button" onClick={() => file.current?.click()} aria-label="Choose a photo" className="size-11 rounded-md bg-cam-line" />
          <button
            type="button"
            onClick={live ? snap : () => file.current?.click()}
            aria-label={live ? "Take photo" : "Choose a photo"}
            className="flex size-[76px] items-center justify-center rounded-full border-4 border-cam-ink transition-transform duration-fast ease-out motion-safe:active:scale-[0.96]"
          >
            <span className="block size-[60px] rounded-full bg-highlight" />
          </button>
          <button
            type="button"
            onClick={flash}
            disabled={torch === null}
            aria-label="Flash"
            aria-pressed={!!torch}
            className={cn("flex size-11 items-center justify-center rounded-full disabled:opacity-35", torch ? "bg-highlight text-highlight-fg" : "bg-cam-ink/12")}
          >
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden>
              <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />
            </svg>
          </button>
        </div>
        <div className="flex w-full justify-between font-mono text-[10px] font-medium text-cam-muted">
          <span>PHOTOS</span>
          <span />
          <span>FLASH</span>
        </div>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </>
  );
}

/* ---------- r2 · reading ---------------------------------------------------- */

function Reading({ stage, accounts }: { stage: Extract<Stage, { k: "reading" }>; accounts: Account[] }) {
  const d = stage.draft;
  const marks = d
    ? stage.lines.filter(
        (l) =>
          (d.merchant !== "Receipt" && l.text.toLowerCase().includes(d.merchant.toLowerCase().split(" ")[0])) ||
          (/\btotal\b/i.test(l.text) && !/sub ?total/i.test(l.text)),
      )
    : [];
  const when = d ? new Date(d.when) : null;
  const cell = (label: string, value: React.ReactNode, dim?: boolean) => (
    <div className="bg-cam-cell px-3.5 py-3">
      <div className="font-mono text-[9.5px] font-semibold tracking-[0.12em] text-cam-muted/80">{label}</div>
      <div className={cn("mt-1.5 line-clamp-2 break-words text-[14px] font-medium", dim ? "text-cam-muted/60" : "text-cam-ink")}>{value}</div>
    </div>
  );

  return (
    <>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8 pt-[max(20px,env(safe-area-inset-top))] pb-[230px]">
        <div className="relative max-h-full" style={{ aspectRatio: `${stage.size.w} / ${stage.size.h}` }}>
          <img src={stage.image} alt="Your receipt" className="block max-h-[60dvh] w-auto rounded-[4px] shadow-[0_10px_30px_rgba(0,0,0,.4)]" />
          {/* the lines M8 read the merchant and total from */}
          {marks.map((l, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute rounded-[3px] bg-highlight/45 mix-blend-multiply"
              style={{
                left: `${(l.bbox.x0 / stage.size.w) * 100}%`,
                top: `${(l.bbox.y0 / stage.size.h) * 100}%`,
                width: `${((l.bbox.x1 - l.bbox.x0) / stage.size.w) * 100}%`,
                height: `${((l.bbox.y1 - l.bbox.y0) / stage.size.h) * 100}%`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-cam-sheet px-6 pt-6 pb-[max(32px,env(safe-area-inset-bottom))]" aria-live="polite">
        <div className="flex items-center gap-2">
          <Sparkle size={12} />
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.16em] text-cam-muted">
            {d ? `READING · ${d.items.length} ITEM${d.items.length === 1 ? "" : "S"} FOUND` : `READING · ${Math.round(stage.progress * 100)}%`}
          </span>
        </div>
        {!d ? (
          <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-cam-line">
            <div className="h-full bg-highlight motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${Math.max(6, stage.progress * 100)}%` }} />
          </div>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-cam-line bg-cam-line">
          {cell("MERCHANT", d?.merchant ?? "…", !d)}
          {cell("TOTAL", d?.total != null ? <span className="font-semibold text-highlight">{peso(d.total)}</span> : "…", !d)}
          {cell("PAID WITH", d ? payLabel(accounts.find((a) => a.id === d.accountId)) : "…", !d || !d.accountId)}
          {cell(
            "WHEN",
            when ? `${shortDay(when.toISOString()) === "TODAY" ? "Today" : when.toLocaleDateString("en-PH", { day: "numeric", month: "short" })}, ${when.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : "…",
            true,
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- r6 · already logged? ------------------------------------------- */

function Duplicate({ match, onChoose }: { match?: Entry; onChoose: (c: "attach" | "new" | "discard") => void }) {
  const said = match?.raw ?? match?.desc ?? "that";
  const at = match ? new Date(match.date).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "";
  const ghost = "min-h-11 rounded-lg border border-cam-line px-4 text-[14px] text-cam-ink active:bg-cam-ink/10";
  return (
    <>
      <div className="flex-1" />
      <div role="alert" className="flex flex-col gap-4 bg-cam px-6 pt-6 pb-[max(32px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <Sparkle size={12} />
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.16em] text-cam-ink/85">ALREADY LOGGED?</span>
        </div>
        <p className="text-[15px] leading-[1.45] text-pretty text-cam-ink">
          You {match?.source === "voice" ? "said" : "logged"} “{said}”{at ? ` at ${at}` : ""}. This receipt looks like the same purchase.
        </p>
        <button type="button" onClick={() => onChoose("attach")} className="min-h-12 rounded-lg bg-highlight px-4 text-[14px] font-semibold text-highlight-fg active:opacity-80">
          Attach to that entry
        </button>
        <div className="flex gap-2.5">
          <button type="button" onClick={() => onChoose("new")} className={cn(ghost, "flex-1")}>
            Log as new
          </button>
          <button type="button" onClick={() => onChoose("discard")} className={cn(ghost, "flex-1")}>
            Discard
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------- r7 · can't read ----------------------------------------------- */

function Unreadable({ image, failed, onRetake, onTotal }: { image: string; failed?: boolean; onRetake: () => void; onTotal: (n: number) => void }) {
  const [typing, setTyping] = React.useState(false);
  const [value, setValue] = React.useState("");
  const n = parseFloat(value.replace(/[^\d.]/g, ""));
  return (
    <>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_40%,color-mix(in_oklab,var(--color-cam-muted)_35%,var(--color-cam))_0%,var(--color-cam)_75%)]">
        <img src={image} alt="" className="max-h-[60%] max-w-[60%] rotate-[-6deg] opacity-85 blur-[5px]" />
      </div>
      <div role="alert" className="flex flex-col gap-4 bg-cam px-6 pt-6 pb-[max(32px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <span className="block size-[7px] rounded-full bg-highlight" />
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.16em] text-cam-ink/85">{failed ? "COULDN’T START THE READER" : "COULDN’T READ THE TOTAL"}</span>
        </div>
        <p className="text-[14px] leading-[1.5] text-cam-ink/85">
          {failed
            ? "The reader downloads the first time you scan. Connect to the internet and retake, or type the total."
            : "Hold steady and fill the frame. Flat and well-lit works best."}
        </p>
        {typing ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (n > 0) onTotal(n);
            }}
          >
            <label className="flex flex-1 items-center gap-1.5 rounded-lg border border-cam-line px-4 focus-within:border-cam-ink">
              <span className="text-cam-muted">₱</span>
              <input
                autoFocus
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Total"
                aria-label="Receipt total"
                className="h-[50px] min-w-0 flex-1 bg-transparent text-[16px] text-cam-ink outline-none placeholder:text-cam-muted"
              />
            </label>
            <button type="submit" disabled={!(n > 0)} className="rounded-lg bg-highlight px-5 text-[14px] font-semibold text-highlight-fg disabled:opacity-40">
              Next
            </button>
          </form>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={onRetake} className="flex-1 rounded-lg bg-highlight py-[15px] text-[14px] font-semibold text-highlight-fg">
              Retake
            </button>
            <button type="button" onClick={() => setTyping(true)} className="flex-1 rounded-lg border border-cam-line py-[15px] text-[14px] font-medium">
              Type the total
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- r4 · review ------------------------------------------------------ */

function Review({ draft, accounts, onRetake, onLog }: { draft: ReceiptDraft; accounts: Account[]; onRetake: () => void; onLog: (d: ReceiptDraft) => void }) {
  const [d, setD] = React.useState(draft);
  const [pickAccount, setPickAccount] = React.useState(false);
  const [editing, setEditing] = React.useState<number | null>(null);
  const split = splitOf(d.items);
  const unsure = d.items.some((i) => i.unsure);
  const account = accounts.find((a) => a.id === d.accountId);
  const when = new Date(d.when);
  const total = d.total ?? d.items.reduce((n, i) => n + i.amount, 0);
  const doubts = d.doubts.filter((x) => (x.includes("how you paid") ? !d.accountId : true)).filter((x) => (unsure ? true : !/could be|category/.test(x)));

  return (
    <div className="screen-in mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 pt-3">
        <button type="button" onClick={onRetake} className="-ml-1 flex h-11 items-center justify-self-start pr-2 text-[14px] text-fg-subtle active:opacity-60">
          ‹ Retake
        </button>
        <span className="eyebrow">Review</span>
        <span />
      </div>

      <div className="flex-1 px-6 pt-5">
        <div className="flex items-center gap-3.5">
          {d.image ? <img src={d.image} alt="Receipt" className="h-[68px] w-[52px] flex-none rounded-[4px] border border-line object-cover" /> : null}
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 break-words text-[15px] font-medium">{d.merchant}</div>
            <div className="mt-1 font-mono text-[10px] font-medium text-fg-subtle">
              {shortDay(d.when)} · {when.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).toUpperCase()} · {d.items.length} ITEM
              {d.items.length === 1 ? "" : "S"}
            </div>
          </div>
          <span className="tnum text-[24px] font-semibold tracking-[-0.02em]">{peso(total)}</span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setPickAccount(true)}
            className={cn("rounded-lg border px-[13px] py-[11px] text-left", d.accountId ? "border-line" : "border-warning/40 bg-highlight/8")}
          >
            <div className={cn("font-mono text-[9.5px] font-semibold tracking-[0.12em]", d.accountId ? "text-fg-subtle" : "text-gold-ink")}>
              PAID WITH{d.accountId ? "" : " · CHECK"}
            </div>
            <div className="mt-1.5 truncate text-[14px] font-medium">{account ? (account.type === "cash" ? "Cash" : account.providerLabel) : "Choose"} ▾</div>
          </button>
          <div className={cn("rounded-lg border px-[13px] py-[11px]", unsure ? "border-warning/40 bg-highlight/8" : "border-line")}>
            <div className={cn("font-mono text-[9.5px] font-semibold tracking-[0.12em]", unsure ? "text-gold-ink" : "text-fg-subtle")}>
              SPLIT{unsure ? " · CHECK" : ""}
            </div>
            <div className="mt-1.5 text-[14px] font-medium">
              {split.length} categor{split.length === 1 ? "y" : "ies"}
            </div>
          </div>
        </div>

        {doubts.map((x) => (
          <p key={x} className="mt-[18px] flex items-center gap-[7px] text-[12.5px] text-fg-muted">
            <Sparkle size={12} />
            {x}
          </p>
        ))}

        <ul className="mt-2.5">
          {d.items.map((it, i) => (
            <li key={i} className="flex items-center gap-2.5 border-b border-surface py-[9px]">
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{it.name}</span>
              <button
                type="button"
                onClick={() => setEditing(i)}
                className={cn(
                  "hit min-h-10 rounded-[6px] px-[7px] text-[10.5px] font-medium whitespace-nowrap",
                  it.unsure ? "bg-highlight/20 text-gold-ink" : "bg-surface text-fg-muted",
                )}
              >
                {it.category}
                {it.unsure ? "?" : ""}
              </button>
              <span className="tnum min-w-[62px] flex-none text-right text-[13.5px] font-medium">{peso(it.amount)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="sticky bottom-0 bg-bg px-5 pt-3.5 pb-[max(24px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          disabled={!(total > 0)}
          onClick={() => onLog({ ...d, items: d.items.map((i) => ({ ...i, unsure: false })), doubts: [] })}
          className="w-full rounded-lg bg-accent py-[15px] text-[14px] font-semibold text-accent-fg disabled:bg-fill disabled:text-fg-subtle"
        >
          Log {peso(total)}
        </button>
      </div>

      <Sheet open={pickAccount} onOpenChange={setPickAccount} title="Paid with">
        <div className="flex flex-wrap gap-2 pt-5">
          {accounts
            .filter((a) => a.type !== "investments")
            .map((a) => (
              <Pill
                key={a.id}
                active={a.id === d.accountId}
                className="max-w-full min-h-10 text-[13px] whitespace-normal text-start"
                onClick={() => {
                  setD({ ...d, accountId: a.id });
                  setPickAccount(false);
                }}
              >
                {a.type === "cash" ? "Cash" : `${a.providerLabel}${a.last4 ? ` ··${a.last4}` : ""}`}
              </Pill>
            ))}
        </div>
      </Sheet>
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing !== null ? d.items[editing]?.name : ""}>
        <div className="flex flex-wrap gap-2 pt-5">
          {SPEND_CATEGORIES.map((c: Category) => (
            <Pill
              key={c}
              active={editing !== null && d.items[editing]?.category === c && !d.items[editing]?.unsure}
              className="min-h-10 text-[13px]"
              onClick={() => {
                if (editing === null) return;
                setD({ ...d, items: d.items.map((it, i) => (i === editing ? { ...it, category: c, unsure: false } : it)) });
                setEditing(null);
              }}
            >
              {c}
            </Pill>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

const payLabel = (a?: Account) => (!a ? "—" : a.type === "cash" ? "Cash" : `${a.providerLabel}${a.last4 ? ` ··${a.last4}` : ""}`);
