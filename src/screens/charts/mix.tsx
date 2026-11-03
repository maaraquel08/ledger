import * as React from "react";
import { Eyebrow } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { billsSeries, flexiblePct, mixSeries } from "@/lib/charts/mix";
import { categoryColors, EVERYTHING_ELSE, VIZ_OTHER } from "@/lib/chart-colors";
import { periodLabel } from "@/lib/analytics";
import { compact, monthShort, peso } from "@/lib/format";
import type { PeriodKind } from "@/lib/selectors";
import type { LedgerState } from "@/lib/types";
import { FLOW } from "@/lib/charts/composition";

export interface MixChartProps {
  kind: PeriodKind;
  /** start of the selected period */
  from: Date;
  state: LedgerState;
  now: Date;
}

const BILLS = FLOW.bills;
const EVERYDAY = FLOW.everyday;
const H = 132;

const LAST: Record<PeriodKind, string> = { week: "8 WEEKS", month: "6 MONTHS", year: "5 YEARS" };
const tick = (kind: PeriodKind, d: Date) => (kind === "year" ? `${d.getFullYear()}` : kind === "month" ? monthShort(d) : `${monthShort(d)} ${d.getDate()}`);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="px-6 pt-9">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <Eyebrow>{title}</Eyebrow>
      </div>
      {children}
    </section>
  );
}

interface Seg {
  key: string;
  amount: number;
  color: string;
}

/** One stacked bar: segments bottom to top, 2px surface gaps, 4px rounded top only. Heights are proportional to amount. */
function Stack({ segs, height, dim }: { segs: Seg[]; height: string; dim: boolean }) {
  return (
    <div className={cn("flex w-full max-w-7 flex-col-reverse gap-[2px] transition-opacity duration-fast", dim && "opacity-50")} style={{ height }}>
      {segs.map((s, i) => (
        <span key={s.key} style={{ flex: `${s.amount} 1 0`, minHeight: 2, background: s.color, borderRadius: i === segs.length - 1 ? "4px 4px 0 0" : 0 }} />
      ))}
    </div>
  );
}

/** Bars side by side with tick labels under them and an overlaid row of tap targets. */
function Bars<T extends { from: Date }>({ kind, periods, picked, onPick, gutter, label, bar }: {
  kind: PeriodKind;
  periods: T[];
  picked: number;
  onPick: (i: number) => void;
  gutter?: React.ReactNode;
  label: (p: T) => string;
  bar: (p: T, dim: boolean) => React.ReactNode;
}) {
  return (
    <div className={cn("relative mt-4", gutter ? "pl-8" : "")}>
      <div className="relative" style={{ height: H }}>
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {gutter}
          <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" />
        </div>
        <div role="group" aria-label={`Last ${periods.length} ${kind}s. Tap one for its breakdown.`} className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0, 1fr))` }}>
          {periods.map((p, i) => (
            <button
              key={p.from.getTime()}
              type="button"
              aria-pressed={i === picked}
              aria-label={label(p)}
              onClick={() => onPick(i)}
              className="relative flex min-w-0 flex-col items-center justify-end active:opacity-60"
            >
              {bar(p, i !== picked)}
              <span className={cn("absolute top-full pt-1.5 font-mono text-[10px] whitespace-nowrap", i === picked ? "font-semibold text-fg" : "text-fg-subtle")} aria-hidden>
                {tick(kind, p.from)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="h-6" aria-hidden />
    </div>
  );
}

const outline = (height: string) => <div className="w-full max-w-7 rounded-t-[4px] border border-dashed border-line-strong" style={{ height }} aria-hidden />;

/* ---------- Category mix ---------------------------------------------------- */

export function CategoryMix({ kind, from, state, now }: MixChartProps) {
  const series = React.useMemo(() => mixSeries(state, kind, from, now), [state.entries, kind, from, now]);
  const color = categoryColors(state);
  const [pickedRaw, setPicked] = React.useState<number | null>(null);
  const picked = pickedRaw != null && pickedRaw < series.periods.length ? pickedRaw : series.selected;
  const at = series.periods[picked];
  const colorOf = (n: string) => (n === EVERYTHING_ELSE ? VIZ_OTHER : color(n));

  return (
    <Section title={`CATEGORY MIX · LAST ${LAST[kind]}`}>
      <Bars
        kind={kind}
        periods={series.periods}
        picked={picked}
        onPick={setPicked}
        label={(p) => (p.total ? `${periodLabel(kind, p.from)}: ${p.parts.slice(0, 3).map((x) => `${x.name} ${Math.round(x.share * 100)}%`).join(", ")}` : `${periodLabel(kind, p.from)}: no spending`)}
        bar={(p, dim) =>
          p.total ? <Stack height="100%" dim={dim} segs={p.parts.map((x) => ({ key: x.name, amount: x.amount, color: colorOf(x.name) }))} /> : outline("100%")
        }
      />
      {series.present.length ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-fg-muted" aria-label="Legend">
          {series.present.map((n) => (
            <li key={n} className="flex items-center gap-1.5">
              <span className="size-2 flex-none rounded-full" style={{ background: colorOf(n) }} aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-5" aria-live="polite">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="font-medium">{periodLabel(kind, at.from)}</span>
          <span className="tnum text-fg-muted">{at.total ? peso(at.total) : "No spending"}</span>
        </div>
        {at.total ? (
          <ul className="mt-2 divide-y divide-line text-[13px]">
            {[...at.parts].sort((a, b) => b.amount - a.amount).slice(0, 5).map((x) => (
              <li key={x.name} className="tnum flex items-center gap-2 py-2">
                <span className="size-2 flex-none rounded-full" style={{ background: colorOf(x.name) }} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-sans">{x.name}</span>
                <span className="text-fg-muted">{Math.round(x.share * 100)}%</span>
                <span className="w-20 text-right font-medium">{peso(x.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>Share of spending by category, last {series.periods.length} {kind}s</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.present.map((n) => (
              <th key={n} scope="col">{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.periods.map((p) => (
            <tr key={p.from.getTime()}>
              <th scope="row">{periodLabel(kind, p.from)}</th>
              {series.present.map((n) => {
                const x = p.parts.find((q) => q.name === n);
                return <td key={n}>{x ? `${Math.round(x.share * 100)}% (${peso(x.amount)})` : "0%"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/* ---------- Bills vs Everyday ----------------------------------------------- */

export function BillsVsEveryday({ kind, from, state, now }: MixChartProps) {
  const series = React.useMemo(() => billsSeries(state, kind, from, now), [state.entries, state.categories, kind, from, now]);
  const [pickedRaw, setPicked] = React.useState<number | null>(null);
  const picked = pickedRaw != null && pickedRaw < series.periods.length ? pickedRaw : series.selected;
  const at = series.periods[picked];
  const max = Math.max(series.max, 1);
  const flex = flexiblePct(at);

  return (
    <Section title="BILLS VS EVERYDAY">
      <Bars
        kind={kind}
        periods={series.periods}
        picked={picked}
        onPick={setPicked}
        label={(p) => `${periodLabel(kind, p.from)}: bills ${peso(p.bills)}, everyday ${peso(p.everyday)}`}
        gutter={[0.08, 0.54].map((f) => (
          <div key={f} className="absolute inset-x-0 border-t border-dashed border-line" style={{ top: `${f * 100}%` }}>
            <span className="tnum absolute right-full -top-[7px] pr-1.5 font-mono text-[9.5px] text-fg-subtle">{compact(f === 0.08 ? max : max / 2).replace("₱", "")}</span>
          </div>
        ))}
        bar={(p, dim) =>
          p.total ? (
            <Stack
              height={`${(p.total / max) * 92}%`}
              dim={dim}
              segs={[
                { key: "bills", amount: p.bills, color: BILLS },
                { key: "everyday", amount: p.everyday, color: EVERYDAY },
              ].filter((s) => s.amount > 0)}
            />
          ) : (
            outline("4px")
          )
        }
      />
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-fg-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="size-2 flex-none rounded-full" style={{ background: BILLS }} aria-hidden />
          Bills
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 flex-none rounded-full" style={{ background: EVERYDAY }} aria-hidden />
          Everyday
        </li>
      </ul>
      <p className="tnum mt-5 text-[13px] text-fg-muted" aria-live="polite">
        <span className="font-medium text-fg">{periodLabel(kind, at.from)}</span>
        {" · "}
        {at.total ? (
          <>
            Bills <span className="font-medium text-fg">{peso(at.bills)}</span> · Everyday <span className="font-medium text-fg">{peso(at.everyday)}</span> ({flex}% of spending is flexible)
          </>
        ) : (
          "No spending"
        )}
      </p>
      <table className="sr-only">
        <caption>Bills and everyday spending, last {series.periods.length} {kind}s</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Bills</th>
            <th scope="col">Everyday</th>
          </tr>
        </thead>
        <tbody>
          {series.periods.map((p) => (
            <tr key={p.from.getTime()}>
              <th scope="row">{periodLabel(kind, p.from)}</th>
              <td>{peso(p.bills)}</td>
              <td>{peso(p.everyday)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
