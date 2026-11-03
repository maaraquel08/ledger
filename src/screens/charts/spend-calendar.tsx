import * as React from "react";
import { EntryRow, Eyebrow, Sheet } from "@/components/ledger/primitives";
import { spendCalendar, type SpendDay } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { addDays, dayName, monthName, peso, sameDay } from "@/lib/format";
import { navigate } from "@/lib/router";
import { useLedger } from "@/lib/store";

/* Level fills: one hue (danger, money out) mixed into the page colour, so light and dark both work. */
const LEVEL_MIX = [0, 12, 26, 42, 60, 82];
const levelFill = (l: number) => `color-mix(in oklab, var(--color-danger) ${LEVEL_MIX[l]}%, var(--color-bg))`;

function dayTitle(d: Date, now: Date) {
  const date = `${d.getDate()} ${monthName(d)}`.toUpperCase();
  const lead = sameDay(d, now) ? "TODAY" : sameDay(d, addDays(now, -1)) ? "YESTERDAY" : dayName(d).slice(0, 3).toUpperCase();
  return `${lead} · ${date}`;
}

/** Month view: a Monday-first heat-map of each day's spend; tap a day for what made it. */
export function SpendCalendar({ from, now, selectedDay, onPickDay }: { from: Date; now: Date; selectedDay?: Date | null; onPickDay?: (d: Date) => void }) {
  const { state } = useLedger();
  const [open, setOpen] = React.useState<SpendDay | null>(null);
  const days = React.useMemo(() => spendCalendar(state.entries, from, now), [state.entries, from, now]);
  const lead = (from.getDay() + 6) % 7;
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  return (
    <section aria-label="Spend calendar" className={cn("px-6", onPickDay ? "pt-5" : "pt-9")}>
      <Eyebrow>SPEND CALENDAR</Eyebrow>
      <div className="mt-3 grid grid-cols-7 gap-1" role="group" aria-label={`Spend by day, ${monthName(from)} ${from.getFullYear()}`}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} aria-hidden className="pb-1 text-center font-mono text-[10.5px] text-fg-subtle">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`pad${i}`} aria-hidden />
        ))}
        {days.map((d) => {
          const label = `${d.day} ${monthName(d.date)}, ${d.future ? "no spending yet" : `spent ${peso(d.spent)}`}`;
          const picked = !!selectedDay && sameDay(selectedDay, d.date);
          return (
            <button
              key={d.day}
              type="button"
              aria-label={label}
              disabled={d.future}
              onClick={() => (onPickDay ? onPickDay(d.date) : setOpen(d))}
              aria-pressed={onPickDay ? picked : undefined}
              style={d.level ? { backgroundColor: levelFill(d.level) } : undefined}
              className={cn(
                picked && "ring-2 ring-accent ring-offset-1 ring-offset-bg",
                "flex aspect-square items-start justify-start rounded-md border p-1.5 font-mono text-[10.5px] leading-none tnum active:opacity-60",
                d.level ? "border-transparent" : d.future ? "border-dashed border-line text-fg-subtle" : "border-line bg-surface text-fg-muted",
                d.level === 5 ? "text-danger-fg" : d.level ? "text-fg" : null,
              )}
            >
              {d.day}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 font-mono text-[10.5px] tracking-[0.05em] text-fg-subtle" aria-hidden>
        LOW
        {[1, 2, 3, 4, 5].map((l) => (
          <span key={l} className="size-3.5 rounded-[4px]" style={{ backgroundColor: levelFill(l) }} />
        ))}
        HIGH
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open ? dayTitle(open.date, now) : undefined}>
        {open ? (
          <div className="pt-4 pb-2">
            <Eyebrow>SPENT</Eyebrow>
            <div className="tnum mt-1 text-[32px] leading-[1.1] font-semibold tracking-[-0.02em]">{peso(open.spent)}</div>
            {open.entries.length ? (
              <div className="mt-5 flex flex-col gap-4">
                {open.entries.map((e) => (
                  <EntryRow key={e.id} entry={e} account={e.accountId ? accounts.get(e.accountId) : undefined} onClick={() => navigate(`/activity/${e.id}`)} />
                ))}
              </div>
            ) : (
              <p className="mt-4 text-[14px] text-fg-muted">Nothing spent this day.</p>
            )}
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}
