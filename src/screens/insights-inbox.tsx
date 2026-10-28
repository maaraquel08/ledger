import * as React from "react";
import { AiCard, Eyebrow } from "@/components/ledger/primitives";
import { loadInsights, markInsights, type Insight } from "@/lib/cloud/api";
import { stamp } from "@/lib/format";
import { cloud } from "@/lib/supabase";

/*
 * Cloud mode: what M8 wrote on its cadence (D-0016). The daily one-liner replaces Today's local
 * sentence while it is fresh; weekly reviews, monthly closes and alerts sit in an inbox until
 * dismissed. Every number in a narrative was computed in SQL (D-0013).
 */

const DAY = 24 * 60 * 60 * 1000;

const LABEL: Record<Insight["kind"], string> = {
  daily: "M8 · TODAY",
  weekly: "M8 · WEEKLY REVIEW",
  monthly: "M8 · MONTHLY CLOSE",
  alert: "M8 · HEADS UP",
  answer: "M8",
};

export function useInsights() {
  const [list, setList] = React.useState<Insight[]>([]);
  React.useEffect(() => {
    if (!cloud) return;
    let live = true;
    const load = () =>
      loadInsights().then(
        (rows) => live && setList(rows.filter((r) => r.narrative)),
        () => {},
      );
    void load();
    const wake = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", wake);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  const daily = list.find((i) => i.kind === "daily" && !i.stale && Date.now() - new Date(i.created_at).getTime() < DAY) ?? null;
  const inbox = list.filter((i) => i.kind !== "daily");

  // what's on screen has been read
  const unread = inbox.filter((i) => !i.read_at).map((i) => i.id).join(",");
  React.useEffect(() => {
    if (unread) markInsights(unread.split(","), "read_at").catch(() => {});
  }, [unread]);

  const dismiss = (id: string) => {
    setList((l) => l.filter((i) => i.id !== id));
    markInsights([id], "dismissed_at").catch(() => {});
  };
  return { daily, inbox, dismiss };
}

export function InsightsInbox({ items, onDismiss }: { items: Insight[]; onDismiss: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <section className="px-6 pt-7" aria-label="From M8">
      <Eyebrow>FROM M8</Eyebrow>
      <div className="mt-3 flex flex-col gap-3">
        {items.map((i) => (
          <div key={i.id}>
            <AiCard label={`${LABEL[i.kind]}${i.stale ? " · OUT OF DATE" : ""}${i.read_at ? "" : " · NEW"}`}>
              <span className={i.stale ? "opacity-70" : undefined}>{i.narrative}</span>
            </AiCard>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle">
                {i.stale ? "YOUR ENTRIES CHANGED SINCE · " : ""}
                {stamp(i.created_at).toUpperCase()}
              </span>
              <button type="button" onClick={() => onDismiss(i.id)} className="-mr-2 flex h-10 items-center px-2 text-[13px] font-medium text-fg-muted active:opacity-60">
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
