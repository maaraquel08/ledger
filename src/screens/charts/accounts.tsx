import * as React from "react";
import { Eyebrow, ProviderMark } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { balance, compact, monthShort, peso } from "@/lib/format";
import { isCurrent, periodLabel } from "@/lib/analytics";
import { netWorthSeries, spendByAccount } from "@/lib/charts/accounts";
import { accountLabel, type PeriodKind } from "@/lib/selectors";
import type { Entry, LedgerState } from "@/lib/types";

const shell = (title: string, children: React.ReactNode) => (
  <section aria-label={title} className="px-6 pt-9">
    <div className="flex min-h-6 items-center">
      <Eyebrow>{title}</Eyebrow>
    </div>
    {children}
  </section>
);

/** Where the period's spending came from: one bar per account, biggest first. One series, so one ink. */
export function SpendingByAccount({ list, state, label }: { list: Entry[]; state: Pick<LedgerState, "accounts">; label: string }) {
  const rows = spendByAccount(list, state.accounts);
  if (!rows.length) return null;
  const max = rows[0].amount;
  return shell(
    "SPENT FROM",
    <ul aria-label={`Spending by account, ${label}`} className="mt-2 divide-y divide-line">
      {rows.map((r) => (
        <li key={r.accountId ?? "none"} className="flex min-h-14 items-center gap-3 py-2.5">
          <ProviderMark provider={r.account?.provider ?? null} size={26} radius={7} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[14.5px]">{r.account ? r.account.name || accountLabel(r.account) : "No account"}</span>
              <span className="tnum flex-none text-[14.5px] font-medium whitespace-nowrap">
                {peso(r.amount)} <span className="font-mono text-[10.5px] font-normal text-fg-subtle">{Math.round(r.share)}%</span>
              </span>
            </div>
            <span aria-hidden className="mt-1.5 block h-1.5 rounded-full bg-fill">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(1.5, (r.amount / max) * 100)}%` }} />
            </span>
          </div>
        </li>
      ))}
    </ul>,
  );
}

const axisNum = (n: number) => `${n < 0 ? "−" : ""}${compact(n).replace("₱", "")}`;

function tick(kind: PeriodKind, d: Date) {
  if (kind === "year") return `${d.getFullYear()}`;
  if (kind === "month") return monthShort(d);
  return `${monthShort(d)} ${d.getDate()}`;
}

/** Net worth at the end of each of the last periods: one ink line. Tap a point for cash, invested and owed. */
export function NetWorthTrend({ kind, from, state, now }: { kind: PeriodKind; from: Date; state: Pick<LedgerState, "accounts" | "entries">; now: Date }) {
  const [table, setTable] = React.useState(false);
  const [picked, setPicked] = React.useState<number | null>(null);
  const pts = React.useMemo(() => netWorthSeries(state, kind, from, now), [state, kind, from, now]);
  if (!pts.length) return null;
  const sel = picked != null && picked < pts.length ? picked : pts.length - 1;
  const at = pts[sel];
  const name = (i: number) => (isCurrent(kind, pts[i].from, now) ? "Now" : periodLabel(kind, pts[i].from));

  const vals = pts.map((p) => p.total);
  const hi0 = Math.max(...vals);
  const lo0 = Math.min(...vals);
  const pad = (hi0 - lo0) * 0.12 || Math.max(Math.abs(hi0) * 0.1, 1);
  const hi = hi0 + pad;
  const lo = lo0 - pad;
  const x = (i: number) => ((i + 0.5) / pts.length) * 100;
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 92 - 4;
  const everyOther = kind === "week" && pts.length > 5;

  return shell(
    "NET WORTH",
    <>
      <div className="mt-1 flex justify-end">
        <button type="button" aria-pressed={table} onClick={() => setTable((t) => !t)} className="-mt-7 -mr-2 flex h-11 items-center px-2 text-[13px] whitespace-nowrap text-fg-muted active:opacity-60">
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <table className="tnum mt-1 w-full text-[13px]">
          <caption className="sr-only">Net worth at the end of each {kind}</caption>
          <thead>
            <tr className="border-b border-line text-right font-mono text-[9.5px] tracking-[0.1em] text-fg-subtle">
              <th scope="col" className="py-2 text-left font-semibold">{kind.toUpperCase()}</th>
              <th scope="col" className="py-2 font-semibold">NET WORTH</th>
              <th scope="col" className="py-2 font-semibold">CASH</th>
              <th scope="col" className="py-2 font-semibold">INVESTED</th>
              <th scope="col" className="py-2 font-semibold">OWED</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...pts].reverse().map((p) => (
              <tr key={p.from.toISOString()} className="text-right">
                <th scope="row" className="py-2.5 text-left font-normal">{name(pts.indexOf(p))}</th>
                <td className="py-2.5">{balance(p.total)}</td>
                <td className="py-2.5">{balance(p.cash)}</td>
                <td className="py-2.5">{peso(p.invested)}</td>
                <td className="py-2.5">{peso(p.owed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="relative mt-2 pl-10">
            <div className="relative h-[132px]">
              <div className="pointer-events-none absolute inset-0" aria-hidden>
                {[hi0, lo0].map((v, i) => (
                  <div key={i} className="absolute inset-x-0 border-t border-dashed border-line" style={{ top: `${y(v)}%` }}>
                    <span className="tnum absolute right-full -top-[7px] pr-1.5 font-mono text-[9.5px] text-fg-subtle">{axisNum(v)}</span>
                  </div>
                ))}
                <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" />
              </div>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${x(sel)}%` }} aria-hidden />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
                <polyline
                  points={pts.map((p, i) => `${x(i)},${y(p.total)}`).join(" ")}
                  fill="none"
                  stroke="var(--color-fg)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {pts.map((p, i) => (
                <span
                  key={p.from.toISOString()}
                  aria-hidden
                  className={cn("pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg", i === sel ? "size-3 border-2 border-bg" : "size-1.5")}
                  style={{ left: `${x(i)}%`, top: `${y(p.total)}%` }}
                />
              ))}
            </div>
            <div role="group" aria-label={`Net worth at the end of each ${kind}. Tap one for its figures.`} className="absolute inset-y-0 right-0 left-10 grid" style={{ gridTemplateColumns: `repeat(${pts.length}, minmax(0, 1fr))` }}>
              {pts.map((p, i) => (
                <button
                  key={p.from.toISOString()}
                  type="button"
                  aria-current={i === sel ? "true" : undefined}
                  aria-label={`${name(i)}: net worth ${balance(p.total)}`}
                  onClick={() => setPicked(i)}
                  className="flex min-w-0 flex-col justify-end"
                >
                  <span className={cn("translate-y-full overflow-visible pt-1.5 text-center font-mono text-[10px] whitespace-nowrap", i === sel ? "font-semibold text-fg" : "text-fg-subtle")}>
                    {everyOther && i % 2 !== pts.length % 2 ? "" : tick(kind, p.from)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-9" aria-live="polite">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[10.5px] tracking-[0.04em] text-fg-subtle uppercase">{name(sel)}</span>
              <span className="tnum text-[18px] font-semibold">{balance(at.total)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-3 text-[13px]">
              {[
                ["Cash", at.cash],
                ["Invested", at.invested],
                ["Owed", at.owed],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-fg-muted">{k}</dt>
                  <dd className="tnum font-medium">{balance(v as number)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </>,
  );
}
