import * as React from "react";
import { cn } from "@/lib/cn";
import { CheckIcon } from "./icons";

/*
 * The espresso toast at the top of the column, with Undo. The Add sheet keeps
 * its own (it knows about sync); everything else that needs an Undo uses this.
 */

export interface UndoNote {
  /** mono eyebrow: "ADJUSTMENT RECORDED" */
  label: string;
  /** big line: "+₱800" or "4 entries" */
  amount: string;
  /** one line under it */
  where: string;
}

const SHOWN_MS = 7000; // long enough to read and reach Undo

/**
 * Where every toast sits: above the yellow Add button (tab bar ~66px + 14px gap +
 * 60px button), so it never covers the button or the tabs. Shared by the Add sheet.
 */
export const TOAST_DOCK =
  "pointer-events-none fixed inset-x-0 bottom-[calc(152px+env(safe-area-inset-bottom))] z-[100] mx-auto w-full max-w-[430px] px-4";

/**
 * transitions.dev 22-toast presence: keeps the last value mounted while the close
 * transition runs, and flips `open` a frame after mount so the enter transition plays.
 */
export function useToastPresence<T>(value: T | null) {
  const [shown, setShown] = React.useState<T | null>(value);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (value) {
      setShown(value);
      const f = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(f);
    }
    setOpen(false);
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--toast-close")) || 250;
    const t = setTimeout(() => setShown(null), ms);
    return () => clearTimeout(t);
  }, [value]);
  return { shown, open };
}

/** Shows `note` for 7s (held while focused); Undo calls onUndo, then it closes. */
export function UndoToast({ note, onUndo, onClose }: { note: UndoNote | null; onUndo: () => void; onClose: () => void }) {
  const [held, setHeld] = React.useState(false);
  const toast = useToastPresence(note);
  React.useEffect(() => {
    if (!note || held) return;
    const t = setTimeout(onClose, SHOWN_MS);
    return () => clearTimeout(t);
  }, [note, held, onClose]);

  return (
    <div role="status" className={TOAST_DOCK}>
      {toast.shown ? (
        <div
          className={cn("t-toast pointer-events-auto rounded-[18px] bg-accent px-4 pt-3.5 pb-3 text-accent-fg shadow-overlay", toast.open && "is-open")}
          onFocus={() => setHeld(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false);
          }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold tracking-[0.16em] text-accent-fg/60 uppercase">
                <CheckIcon size={12} />
                {toast.shown.label}
              </div>
              <div className="tnum mt-2 text-[30px] leading-none font-semibold tracking-[-0.03em]">{toast.shown.amount}</div>
              <div className="mt-2 truncate text-[15px] text-accent-fg/85">{toast.shown.where}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                onUndo();
                onClose();
              }}
              className="-mr-1 flex h-11 flex-none items-center px-2 text-[15px] font-semibold text-highlight active:opacity-60"
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
