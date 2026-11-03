import * as React from "react";
import { Eyebrow } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { peso } from "@/lib/format";
import { donutSegments, incomeSplit } from "@/lib/charts/composition";
import { categoryColors } from "@/lib/chart-colors";
import type { Entry, LedgerState } from "@/lib/types";

/** Same colour every chart uses for a category; use it for list-row dots. */
export function useCategoryColor(state: Pick<LedgerState, "entries" | "profile">) {
  return React.useMemo(() => categoryColors(state), [state.entries, state.profile]); // eslint-disable-line react-hooks/exhaustive-deps
}

const SIZE = 180;
const THICK = 17;
const R = (SIZE - THICK) / 2;
const C = 2 * Math.PI * R;
const GAP = 2;

const pctText = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);

export function CategoryDonut({ list, state, label }: { list: Entry[]; all?: Entry[]; state: LedgerState; label: string }) {
  const segs = React.useMemo(() => donutSegments(list, state), [list, state]);
  const [sel, setSel] = React.useState<string | null>(null);
  if (!segs.length) return null;
  const total = segs.reduce((a, s) => a + s.amount, 0);
  const active = segs.find((s) => s.key === sel) ?? null;
  const top = segs.slice().sort((a, b) => b.amount - a.amount).slice(0, 3);
  const summary = `Spending in ${label}: ${peso(total)}. ${top.map((s) => `${s.label} ${peso(s.amount)}, ${pctText(s.pct)}`).join("; ")}.`;

  let offset = 0;
  return (
    <div className="mt-4 flex justify-center">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={summary} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-line)" strokeWidth={THICK} opacity={0.5} />
          {segs.map((s) => {
            const len = (s.amount / total) * C;
            const dash = segs.length > 1 ? Math.max(len - GAP, 0.5) : len;
            const el = (
              <circle
                key={s.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={THICK}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
                opacity={sel && sel !== s.key ? 0.3 : 1}
                style={{ transition: "opacity 150ms ease-out" }}
              />
            );
            offset += len;
            return el;
          })}
          {/* wide invisible hit targets so thin arcs are tappable */}
          {(() => {
            let o = 0;
            return segs.map((s) => {
              const len = (s.amount / total) * C;
              const el = (
                <circle
                  key={`hit-${s.key}`}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={THICK + 16}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-o}
                  style={{ cursor: "pointer", pointerEvents: "stroke" }}
                  onClick={() => setSel((v) => (v === s.key ? null : s.key))}
                >
                  <title>{`${s.label}: ${peso(s.amount)} (${pctText(s.pct)})`}</title>
                </circle>
              );
              o += len;
              return el;
            });
          })()}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center" aria-live="polite">
          <Eyebrow>{active ? active.label : "SPENT"}</Eyebrow>
          <span className="tnum mt-1 text-[26px] leading-none font-semibold text-fg">{peso(active ? active.amount : total)}</span>
          {active ? <span className="tnum mt-1 font-mono text-[10.5px] text-fg-muted">{pctText(active.pct)} OF SPENDING</span> : null}
        </div>
      </div>
      <table className="sr-only">
        <caption>Spending by category in {label}</caption>
        <thead>
          <tr><th>Category</th><th>Amount</th><th>Share</th></tr>
        </thead>
        <tbody>
          {segs.map((s) => (
            <tr key={s.key}><td>{s.label}</td><td>{peso(s.amount)}</td><td>{pctText(s.pct)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IncomeSplit({ list, state, label }: { list: Entry[]; state: LedgerState; label: string }) {
  const r = React.useMemo(() => incomeSplit(list, state), [list, state]);
  const [sel, setSel] = React.useState<string | null>(null);
  return (
    <section aria-label="Where your income went" className="px-6 pt-9">
      <Eyebrow>WHERE YOUR INCOME WENT</Eyebrow>
      {r.income <= 0 ? (
        <p className="mt-3 text-[14px] text-fg-muted">No income logged in {label}.</p>
      ) : (
        <>
          <p className="tnum mt-2 text-[13px] text-fg-muted">
            {peso(r.income)} in{r.overspent ? ` · overspent ${peso(-r.saved)}` : ""}
          </p>
          <div className="mt-3 flex h-4 gap-[2px]" role="img" aria-label={`Of ${peso(r.income)} income in ${label}: ${r.parts.map((p) => `${p.label} ${peso(p.amount)}`).join(", ")}.`}>
            {r.parts.filter((p) => p.fraction > 0).map((p, i, bar) => (
              <button
                key={p.key}
                type="button"
                aria-label={`${p.label} ${peso(p.amount)}, ${Math.round(p.pct)}% of income`}
                aria-pressed={sel === p.key}
                onClick={() => setSel((v) => (v === p.key ? null : p.key))}
                className={cn("h-full min-w-[3px] transition-opacity duration-150", i === 0 && "rounded-l-[4px]", i === bar.length - 1 && "rounded-r-[4px]")}
                style={{ flexGrow: p.fraction, flexBasis: 0, background: p.color, opacity: sel && sel !== p.key ? 0.3 : 1 }}
              />
            ))}
          </div>
          <ul className="mt-3 divide-y divide-line">
            {r.parts.map((p) => (
              <li key={p.key} className={cn("flex min-h-10 items-center gap-3 py-2 transition-opacity", sel && sel !== p.key && "opacity-50")}>
                <span aria-hidden className="size-2.5 flex-none rounded-full" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 text-[14px] text-fg">{p.label}</span>
                <span className="tnum text-[14px] font-medium text-fg">{peso(p.amount)}</span>
                <span className="tnum w-11 text-right font-mono text-[10.5px] text-fg-muted">{pctText(p.pct)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
