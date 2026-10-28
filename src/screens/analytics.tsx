import * as React from "react";
import { useChrome } from "@/components/ledger/chrome";
import { ChevronLeft, ChevronRight } from "@/components/ledger/icons";
import { AiCard, AiEyebrow, Cta, Delta, Eyebrow, PageTitle, Screen, Segmented } from "@/components/ledger/primitives";
import {
  analyticsHref,
  categoryRows,
  headline,
  incomeConsistency,
  incomeSources,
  isCurrent,
  movers,
  pctChange,
  periodBounds,
  periodLabel,
  readAnalyticsQuery,
  recurringBills,
  savingsRate,
  shiftPeriod,
  tickLabel,
  topMerchants,
  trendSeries,
  weekdayPattern,
  type Headline,
  type TrendPoint,
} from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { addDays, balance, compact, dayName, monthName, monthShort, peso, stamp } from "@/lib/format";
import { navigate, query } from "@/lib/router";
import { FIXED, byCategory, inRange, isIncome, isSpend, ledgerStart, monthBudget, type PeriodKind } from "@/lib/selectors";
import { useLedger } from "@/lib/store";
import { cloud } from "@/lib/supabase";
import type { Entry } from "@/lib/types";
import { LABEL, useInsights } from "@/screens/insights-inbox";
import { entriesHref, type EntryKind } from "@/screens/ledger-list";

/*
 * Analytics: one week, month or year at a time, against the period before
 * (like for like while it is still going) and the trailing average. Every
 * number says how many entries it came from and taps through to exactly
 * those entries in Money.
 */

const KIND_LABEL: Record<PeriodKind, "Week" | "Month" | "Year"> = { week: "Week", month: "Month", year: "Year" };
const UNIT: Record<PeriodKind, string> = { week: "week", month: "month", year: "year" };
const lastDay = (to: Date) => addDays(to, -1);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const entriesText = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

/** "Sep 1–29", "Sep 29–Oct 5", "Jan 1–Oct 29, 2025": an inclusive span of days. */
function spanText(from: Date, end: Date, withYear = false) {
  const y = withYear ? `, ${end.getFullYear()}` : "";
  if (from.getMonth() === end.getMonth() && from.getFullYear() === end.getFullYear()) return `${monthShort(from)} ${from.getDate()}–${end.getDate()}${y}`;
  return `${monthShort(from)} ${from.getDate()}–${monthShort(end)} ${end.getDate()}${y}`;
}

/** What the comparison reads against: a whole period ("Sep 2026") or its like-for-like stretch ("Sep 1–29"). */
function priorLabel(kind: PeriodKind, p: Headline["prior"]) {
  return p.partial ? spanText(p.from, lastDay(p.to), kind === "year") : periodLabel(kind, p.from);
}

/* ---------- shared bits ----------------------------------------------------- */

function SourceLink({ count, to, bare }: { count: number; to: string; bare?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 font-mono text-[10.5px] font-medium tracking-[0.05em] uppercase",
        bare ? "text-fg-subtle active:opacity-60" : "border-t border-line px-4 text-fg-subtle active:bg-surface",
      )}
    >
      <span>Based on {entriesText(count)}</span>
      <span className="flex items-center gap-1 text-fg">
        See entries <ChevronRight size={14} />
      </span>
    </button>
  );
}

/** A tappable row: label (and meta), amount, optional trailing bit. */
function Row({ label, meta, value, trail, onClick }: { label: React.ReactNode; meta?: React.ReactNode; value: React.ReactNode; trail?: React.ReactNode; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cn("flex min-h-12 w-full items-center gap-3 py-2 text-left", onClick && "active:opacity-60")}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px]">{label}</span>
        {meta ? <span className="mt-0.5 block truncate font-mono text-[10.5px] tracking-[0.04em] text-fg-subtle uppercase">{meta}</span> : null}
      </span>
      <span className="tnum text-[14.5px] font-medium whitespace-nowrap">{value}</span>
      {trail}
      {onClick ? <ChevronRight size={14} className="-mr-1 flex-none text-fg-subtle" /> : null}
    </Tag>
  );
}

function Section({ title, aside, children, ai }: { title: string; aside?: React.ReactNode; children: React.ReactNode; ai?: boolean }) {
  return (
    <section aria-label={title} className="px-6 pt-9">
      <div className="flex min-h-6 items-center justify-between gap-3">
        {ai ? <AiEyebrow>{title}</AiEyebrow> : <Eyebrow>{title}</Eyebrow>}
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ---------- headline -------------------------------------------------------- */

/** Change against an earlier figure: NEW when there was nothing, — when neither had anything, NO DATA before the ledger began. */
function Change({ label, cur, prev, invert, pts, money }: { label: string; cur: number | null; prev: number | null | undefined; invert?: boolean; pts?: boolean; money?: boolean }) {
  let chip: React.ReactNode;
  if (prev === undefined) chip = <span className="font-mono text-[10.5px] font-semibold text-fg-subtle">NO DATA</span>;
  else if (cur === null || prev === null) chip = <span className="font-mono text-[10.5px] font-semibold text-fg-subtle">—</span>;
  else if (pts) chip = <Delta value={cur - prev} invert={invert} unit=" PTS" />;
  else if (money) {
    // net can cross zero, where a percentage stops meaning anything: show the peso difference
    const d = Math.round(cur - prev);
    const bad = invert ? d < 0 : d > 0;
    chip = (
      <span className={cn("tnum border px-[5px] py-px font-mono text-[10.5px] font-semibold", d === 0 ? "border-line-strong text-fg-subtle" : bad ? "border-danger text-danger" : "border-success text-success")}>
        {d > 0 ? "+" : d < 0 ? "−" : ""}
        {compact(d)}
      </span>
    );
  }
  else if (prev === 0 && cur === 0) chip = <span className="font-mono text-[10.5px] font-semibold text-fg-subtle">—</span>;
  else chip = <Delta value={pctChange(cur, prev)} invert={invert} />;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-fg-subtle">{label}</span>
      {chip}
    </div>
  );
}

function Tile({ label, value, tone, className, children }: { label: string; value: string; tone?: "danger"; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 border-line px-3.5 py-3.5", className)}>
      <div className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-fg-subtle uppercase">{label}</div>
      <div className={cn("tnum mt-1.5 truncate text-[18px] font-semibold tracking-[-0.01em]", tone === "danger" && "text-danger")}>{value}</div>
      <div className="mt-2 flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function HeadlineGrid({ h }: { h: Headline }) {
  const { cur, prev, avg } = h;
  const rate = savingsRate(cur);
  // undefined: no earlier period in the ledger to compare with
  const p = (f: (t: NonNullable<Headline["prev"]>) => number | null) => (prev ? f(prev) : undefined);
  const a = (f: (t: NonNullable<Headline["avg"]>) => number | null) => (avg ? f(avg) : undefined);
  return (
    <div className="mt-3 grid grid-cols-2 rounded-md border border-line">
      <Tile label="Income" value={peso(cur.in)} className="border-r border-b">
        <Change label="VS PREV" cur={cur.in} prev={p((t) => t.in)} invert />
        <Change label="VS AVG" cur={cur.in} prev={a((t) => t.in)} invert />
      </Tile>
      <Tile label="Spending" value={peso(cur.out)} className="border-b">
        <Change label="VS PREV" cur={cur.out} prev={p((t) => t.out)} />
        <Change label="VS AVG" cur={cur.out} prev={a((t) => t.out)} />
      </Tile>
      <Tile label="Net saved" value={balance(cur.net)} tone={cur.net < 0 ? "danger" : undefined} className="border-r">
        <Change label="VS PREV" cur={cur.net} prev={p((t) => t.net)} invert money />
        <Change label="VS AVG" cur={cur.net} prev={a((t) => t.net)} invert money />
      </Tile>
      <Tile label="Savings rate" value={rate === null ? "—" : `${rate}%`} tone={rate !== null && rate < 0 ? "danger" : undefined}>
        <Change label="VS PREV" cur={rate} prev={p((t) => savingsRate(t))} invert pts />
        <Change label="VS AVG" cur={rate} prev={a((t) => t.rate)} invert pts />
      </Tile>
    </div>
  );
}

/* ---------- trend ----------------------------------------------------------- */

function TrendChart({ kind, points, onPick }: { kind: PeriodKind; points: TrendPoint[]; onPick: (from: Date) => void }) {
  const [table, setTable] = React.useState(false);
  const max = Math.max(...points.map((p) => Math.max(p.in, p.out)), 1);
  const sel = points.find((p) => p.selected) ?? points[points.length - 1];
  const title = points.length === 1 ? `ONE ${UNIT[kind].toUpperCase()}` : `LAST ${points.length} ${UNIT[kind].toUpperCase()}S`;
  const name = (p: TrendPoint) => `${periodLabel(kind, p.from)}${p.current ? " so far" : ""}`;
  const h = (v: number) => `${(v / max) * 100}%`;

  return (
    <Section
      title={`TREND · ${title}`}
      aside={
        <button type="button" aria-pressed={table} onClick={() => setTable((t) => !t)} className="-my-3 -mr-2 flex h-11 flex-none items-center px-2 text-[13px] whitespace-nowrap text-fg-muted active:opacity-60">
          {table ? "Show chart" : "Show table"}
        </button>
      }
    >
      <div className="mt-3 flex items-center gap-4 text-[12px] text-fg-muted" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-chart-in" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-chart-out" /> Spending
        </span>
      </div>

      {table ? (
        <table className="tnum mt-3 w-full text-[13px]">
          <caption className="sr-only">Income and spending per {UNIT[kind]}</caption>
          <thead>
            <tr className="border-b border-line text-left font-mono text-[9.5px] tracking-[0.1em] text-fg-subtle">
              <th scope="col" className="py-2 font-semibold">
                {UNIT[kind].toUpperCase()}
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                INCOME
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                SPENDING
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                NET
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...points].reverse().map((p) => (
              <tr key={p.from.toISOString()} className={cn(p.selected && "font-semibold")}>
                <th scope="row" className="py-2.5 text-left font-[inherit]">
                  <button type="button" onClick={() => onPick(p.from)} className="min-h-6 text-left underline-offset-4 active:opacity-60" aria-current={p.selected ? "true" : undefined}>
                    {name(p)}
                  </button>
                </th>
                <td className="py-2.5 text-right">{peso(p.in)}</td>
                <td className="py-2.5 text-right">{peso(p.out)}</td>
                <td className={cn("py-2.5 text-right", p.net < 0 && "text-danger")}>{balance(p.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="relative mt-3">
            {/* hairline grid: top, middle, baseline; compact tick labels at the right */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[132px]" aria-hidden>
              {[0, 0.5].map((f) => (
                <div key={f} className="absolute inset-x-0 border-t border-line" style={{ top: `${f * 100}%` }}>
                  <span className="tnum absolute right-0 -top-[13px] bg-bg pl-1 font-mono text-[9.5px] text-fg-subtle">{compact(max * (1 - f)).replace("₱", "")}</span>
                </div>
              ))}
              <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" />
            </div>
            <div role="group" aria-label={`Income and spending per ${UNIT[kind]}. Tap a ${UNIT[kind]} to open it.`} className="relative grid" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
              {points.map((p) => (
                <button
                  key={p.from.toISOString()}
                  type="button"
                  aria-current={p.selected ? "true" : undefined}
                  aria-label={`${name(p)}: income ${peso(p.in)}, spending ${peso(p.out)}`}
                  onClick={() => onPick(p.from)}
                  className="group flex min-w-0 flex-col items-stretch active:opacity-60"
                >
                  <span className={cn("mx-[1px] flex h-[132px] items-end justify-center gap-[2px] rounded-t-[4px] px-[2px]", p.selected && "bg-surface")}>
                    <span className="w-full max-w-3 rounded-t-[4px] bg-chart-in" style={{ height: h(p.in) }} />
                    <span className="w-full max-w-3 rounded-t-[4px] bg-chart-out" style={{ height: h(p.out) }} />
                  </span>
                  <span className={cn("truncate pt-1.5 text-center font-mono text-[10px]", p.selected ? "font-semibold text-fg" : "text-fg-subtle")}>
                    {kind === "month" ? tickLabel(kind, p.from)[0] : tickLabel(kind, p.from)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]" aria-live="polite">
            <span className="font-medium">{name(sel)}</span>
            <span className="flex items-center gap-1.5 text-fg-muted">
              <span className="h-0.5 w-3 rounded-full bg-chart-in" aria-hidden />
              In <span className="tnum font-medium text-fg">{peso(sel.in)}</span>
            </span>
            <span className="flex items-center gap-1.5 text-fg-muted">
              <span className="h-0.5 w-3 rounded-full bg-chart-out" aria-hidden />
              Out <span className="tnum font-medium text-fg">{peso(sel.out)}</span>
            </span>
          </div>
        </>
      )}
      {points.length === 1 ? <p className="mt-2 text-[13px] text-fg-muted">This is the first {UNIT[kind]} in your ledger. The trend fills in as you log.</p> : null}
    </Section>
  );
}

/* ---------- findings -------------------------------------------------------- */

interface Finding {
  key: string;
  eyebrow: string;
  number: string;
  tone?: "danger" | "success";
  text: string;
  entries: Entry[];
  label: string;
  filter?: { type?: EntryKind; from?: Date; to?: Date };
}

function FindingCard({ f, all }: { f: Finding; all: Entry[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line">
      <div className="p-4">
        <Eyebrow>{f.eyebrow}</Eyebrow>
        <div className={cn("tnum mt-2 text-[26px] leading-none font-semibold tracking-[-0.03em]", f.tone === "danger" && "text-danger", f.tone === "success" && "text-success")}>{f.number}</div>
        <p className="mt-2 text-[14px] leading-[1.5] text-pretty text-fg-muted">{f.text}</p>
      </div>
      <SourceLink count={f.entries.length} to={entriesHref(all, f.entries, f.label, f.filter)} />
    </section>
  );
}

const THRESHOLD: Record<PeriodKind, number> = { week: 500, month: 1000, year: 5000 };

/** Three to five plain conclusions, each a fixed template over the selectors. */
function findings(o: {
  kind: PeriodKind;
  from: Date;
  to: Date;
  now: Date;
  label: string;
  h: Headline;
  list: Entry[];
  prevList: Entry[];
  all: Entry[];
  budget: { budget: number; current: boolean };
}): Finding[] {
  const { kind, from, to, now, label, h, list, prevList, all } = o;
  const out: Finding[] = [];
  const spends = list.filter(isSpend);
  const prevLabel = priorLabel(kind, h.prior);

  // 1. what moved spending most against the previous stretch
  if (h.prev && (h.cur.out > 0 || h.prev.out > 0)) {
    const diff = h.cur.out - h.prev.out;
    const m = movers(list, prevList);
    const top = diff > 0 ? m.up : m.down;
    if (top && Math.round(diff) !== 0) {
      out.push({
        key: "driver",
        eyebrow: "BIGGEST DRIVER",
        number: `${diff > 0 ? "+" : "−"}${peso(diff)}`,
        tone: diff > 0 ? "danger" : "success",
        text: `Spending is ${peso(diff)} ${diff > 0 ? "higher" : "lower"} than ${prevLabel}. ${top.cat} moved most: ${peso(top.diff)} ${top.diff > 0 ? "more" : "less"}.`,
        entries: top.entries,
        label: `${top.cat} · ${label} and ${prevLabel}`,
      });
    }
  }

  // 2. savings rate against the trailing average
  const rate = savingsRate(h.cur);
  if (rate !== null) {
    const avg = h.avg?.rate ?? null;
    const n = h.avg?.n ?? 0;
    const vs =
      avg === null ? "" : ` ${rate > avg ? "Above" : rate < avg ? "Below" : "In line with"} the ${avg}% you average over the ${n === 1 ? `${UNIT[kind]}` : `${n} ${UNIT[kind]}s`} before.`;
    out.push({
      key: "rate",
      eyebrow: "SAVINGS RATE",
      number: `${rate}%`,
      tone: rate < 0 ? "danger" : undefined,
      text: `You kept ${rate}% of the ${peso(h.cur.in)} that came in.${vs}`,
      entries: list.filter((e) => isSpend(e) || isIncome(e)),
      label: `Income and spending · ${label}`,
    });
  }

  // 3. a category well above its usual, else the biggest one
  const rows = categoryRows(list, prevList);
  let unusual: { cat: string; amount: number; avg: number; entries: Entry[] } | null = null;
  if (h.avg)
    for (const r of rows) {
      const a = h.avg.byCat.get(r.cat) ?? 0;
      if (a > 0 && r.amount >= a * 1.5 && r.amount - a >= THRESHOLD[kind] && (!unusual || r.amount / a > unusual.amount / unusual.avg))
        unusual = { cat: r.cat, amount: r.amount, avg: a, entries: r.entries };
    }
  if (unusual)
    out.push({
      key: "unusual",
      eyebrow: "UNUSUAL",
      number: `${(unusual.amount / unusual.avg).toFixed(1)}×`,
      tone: "danger",
      text: `${unusual.cat} is ${(unusual.amount / unusual.avg).toFixed(1)}× its usual: ${peso(unusual.amount)} against an average of ${peso(unusual.avg)}.`,
      entries: unusual.entries,
      label: `${unusual.cat} · ${label}`,
    });
  else if (rows[0])
    out.push({
      key: "top",
      eyebrow: "BIGGEST CATEGORY",
      number: peso(rows[0].amount),
      text: `${rows[0].cat} took ${rows[0].share}% of your spending.`,
      entries: rows[0].entries,
      label: `${rows[0].cat} · ${label}`,
    });

  // 4. month: pace against the budget · week: priciest day · year: biggest month
  if (kind === "month" && o.budget.budget > 0) {
    const b = o.budget.budget;
    const spent = h.cur.out;
    if (o.budget.current) {
      // bills are due in full on their date; only the rest is paced (as in Budgets)
      const fixed = byCategory(list)
        .filter(([c]) => FIXED.includes(c))
        .reduce((s, [, v]) => s + v, 0);
      const days = Math.round((to.getTime() - from.getTime()) / 86400000);
      const pace = Math.min(1, now.getDate() / days);
      const allowed = fixed + (b - fixed) * pace;
      const projected = fixed + (spent - fixed) / pace;
      const diff = allowed - spent;
      out.push({
        key: "pace",
        eyebrow: "PACE",
        number: peso(diff),
        tone: diff < 0 ? "danger" : "success",
        text: `${peso(diff)} ${diff >= 0 ? "under" : "over"} pace for your ${peso(b)} budget. At this rate ${monthName(from)} ends ${peso(b - projected)} ${projected <= b ? "under" : "over"} budget.`,
        entries: spends,
        label: `Spending · ${label}`,
        filter: { type: "expense", from, to: lastDay(to) },
      });
    } else {
      const diff = b - spent;
      out.push({
        key: "budget",
        eyebrow: "BUDGET",
        number: peso(diff),
        tone: diff < 0 ? "danger" : "success",
        text: `${peso(diff)} ${diff >= 0 ? "under" : "over"} your ${peso(b)} budget for ${monthName(from)}.`,
        entries: spends,
        label: `Spending · ${label}`,
        filter: { type: "expense", from, to: lastDay(to) },
      });
    }
  } else if (kind === "week" && spends.length) {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      const es = inRange(spends, d, addDays(d, 1));
      return { d, es, v: es.reduce((s, e) => s - e.amount, 0) };
    });
    const top = days.reduce((a, b) => (b.v > a.v ? b : a));
    out.push({
      key: "day",
      eyebrow: "PRICIEST DAY",
      number: peso(top.v),
      text: `${dayName(top.d)} cost the most, ${h.cur.out > 0 ? Math.round((top.v / h.cur.out) * 100) : 0}% of the week’s spending.`,
      entries: top.es,
      label: `${dayName(top.d)} ${top.d.getDate()} ${monthShort(top.d)}`,
      filter: { type: "expense", from: top.d, to: top.d },
    });
  } else if (kind === "year" && spends.length) {
    const months = Array.from({ length: 12 }, (_, m) => {
      const a = new Date(from.getFullYear(), m, 1);
      const es = inRange(spends, a, new Date(from.getFullYear(), m + 1, 1));
      return { a, es, v: es.reduce((s, e) => s - e.amount, 0) };
    });
    const top = months.reduce((a, b) => (b.v > a.v ? b : a));
    out.push({
      key: "month",
      eyebrow: "BIGGEST MONTH",
      number: peso(top.v),
      text: `${monthName(top.a)} was your biggest spending month of ${from.getFullYear()}.`,
      entries: top.es,
      label: `Spending · ${monthName(top.a)} ${top.a.getFullYear()}`,
    });
  }

  // 5. recurring bills inside the period
  const rec = recurringBills(all, new Date(Math.min(to.getTime(), addDays(now, 1).getTime())));
  const ids = new Set(rec.flatMap((r) => r.entries.map((e) => e.id)));
  const recIn = spends.filter((e) => ids.has(e.id));
  const recSum = recIn.reduce((s, e) => s - e.amount, 0);
  if (recSum > 0 && h.cur.out > 0)
    out.push({
      key: "recurring",
      eyebrow: "RECURRING BILLS",
      number: peso(recSum),
      text: `Bills that come back every month took ${Math.round((recSum / h.cur.out) * 100)}% of your spending: ${rec
        .filter((r) => r.entries.some((e) => recIn.includes(e)))
        .slice(0, 3)
        .map((r) => r.name)
        .join(", ")}.`,
      entries: recIn,
      label: `Recurring bills · ${label}`,
    });

  return out;
}

/* ---------- habits ---------------------------------------------------------- */

const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

function Habits({ kind, from, to, now, start, label, h, list, prevList, all }: { kind: PeriodKind; from: Date; to: Date; now: Date; start: Date; label: string; h: Headline; list: Entry[]; prevList: Entry[]; all: Entry[] }) {
  const [allCats, setAllCats] = React.useState(false);
  const go = (es: Entry[], l: string, f?: Parameters<typeof entriesHref>[3]) => navigate(entriesHref(all, es, l, f));
  const range = { from, to: lastDay(to) };
  const rows = categoryRows(list, prevList);
  const shown = allCats ? rows : rows.slice(0, 6);
  const mv = h.prev ? movers(list, prevList) : null;
  const prevLabel = priorLabel(kind, h.prior);
  const merchants = topMerchants(list);
  const week = weekdayPattern(all, from, to, now, start);
  const maxAvg = Math.max(...week.map((d) => d.avg), 1);
  const peak = week.reduce((a, b) => (b.avg > a.avg ? b : a));
  const recurring = recurringBills(all, new Date(Math.min(to.getTime(), addDays(now, 1).getTime())));

  return (
    <>
      <Section title="WHERE IT WENT" aside={<span className="tnum text-[13px] text-fg-muted">{peso(h.cur.out)}</span>}>
        <div className="mt-1 divide-y divide-line">
          {shown.map((r) => (
            <Row
              key={r.cat}
              label={r.cat}
              meta={`${r.share}% of spending · ${entriesText(r.entries.length)}`}
              value={peso(r.amount)}
              trail={
                <span className="flex w-[58px] flex-none justify-end">
                  {h.prev ? <Delta value={r.change} /> : null}
                </span>
              }
              onClick={() => go(r.entries, `${r.cat} · ${label}`, r.cat === "Unfiled" ? undefined : { type: "expense", cat: r.cat, ...range })}
            />
          ))}
        </div>
        {rows.length > 6 ? (
          <button type="button" onClick={() => setAllCats((v) => !v)} className="mt-1 flex h-11 items-center text-[13px] font-medium text-fg-muted active:opacity-60">
            {allCats ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        ) : null}
        {h.prev ? <p className="mt-1 font-mono text-[10.5px] tracking-[0.04em] text-fg-subtle uppercase">Change vs. {prevLabel}</p> : null}
      </Section>

      {mv && (mv.up || mv.down) ? (
        <Section title={`MOVERS · VS. ${prevLabel.toUpperCase()}`}>
          <div className="mt-1 divide-y divide-line">
            {mv.up ? (
              <Row label={`Up: ${mv.up.cat}`} meta="Spent more" value={`+${peso(mv.up.diff)}`} onClick={() => go(mv.up!.entries, `${mv.up!.cat} · ${label} and ${prevLabel}`)} />
            ) : null}
            {mv.down ? (
              <Row label={`Down: ${mv.down.cat}`} meta="Spent less" value={`−${peso(mv.down.diff)}`} onClick={() => go(mv.down!.entries, `${mv.down!.cat} · ${label} and ${prevLabel}`)} />
            ) : null}
          </div>
        </Section>
      ) : null}

      {merchants.length ? (
        <Section title="TOP MERCHANTS">
          <div className="mt-1 divide-y divide-line">
            {merchants.map((m) => (
              <Row key={m.key} label={m.name} meta={`${m.entries.length}×`} value={peso(m.amount)} onClick={() => go(m.entries, `${m.name} · ${label}`)} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="BY DAY OF THE WEEK">
        <p className="mt-2 text-[13px] leading-[1.45] text-fg-muted">
          {peak.avg > 0
            ? `${DOW[peak.dow]}s cost the most: ${peso(peak.avg)} a day on average. Rent, bills and subscriptions left out.`
            : "No day-to-day spending yet. Rent, bills and subscriptions are left out."}
        </p>
        <div className="mt-3 grid grid-cols-7 gap-1.5" role="group" aria-label="Average spending a day, by day of the week">
          {week.map((d) => (
            <button
              key={d.dow}
              type="button"
              disabled={!d.entries.length}
              aria-label={`${DOW[d.dow]}: ${peso(d.avg)} a day on average, ${entriesText(d.entries.length)}`}
              onClick={() => go(d.entries, `${DOW[d.dow]}s · ${label}`)}
              className="flex min-w-0 flex-col items-center gap-1.5 active:opacity-60"
            >
              <span className="tnum h-3 font-mono text-[9.5px] text-fg-muted">{d === peak && d.avg > 0 ? compact(d.avg).replace("₱", "") : ""}</span>
              <span className="flex h-[64px] w-full items-end justify-center">
                <span className={cn("w-full max-w-6 rounded-t-[4px]", d === peak && d.avg > 0 ? "bg-chart-out" : "bg-fill")} style={{ height: `${(d.avg / maxAvg) * 100}%` }} />
              </span>
              <span className={cn("font-mono text-[10px]", d === peak && d.avg > 0 ? "font-semibold text-fg" : "text-fg-subtle")}>{DOW[d.dow][0]}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="RECURRING BILLS" aside={recurring.length ? <span className="tnum text-[13px] text-fg-muted">≈ {peso(recurring.reduce((s, r) => s + r.amount, 0))} a month</span> : null}>
        {recurring.length ? (
          <div className="mt-1 divide-y divide-line">
            {recurring.map((r) => (
              <Row
                key={r.name}
                label={r.name}
                meta={`Monthly · around the ${ordinal(r.day)} · ${plural(r.months, "month")}`}
                value={peso(r.amount)}
                onClick={() => go(r.entries, `${r.name} · last 6 months`)}
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13.5px] leading-[1.45] text-fg-muted">None found yet. A bill shows here once the same merchant is charged about monthly for three months.</p>
        )}
      </Section>
    </>
  );
}

/* ---------- income ---------------------------------------------------------- */

const VERDICT = { steady: "Steady", varies: "Varies a little", irregular: "Irregular" } as const;

function Income({ from, to, label, h, list, prevList, all, now, start }: { from: Date; to: Date; label: string; h: Headline; list: Entry[]; prevList: Entry[]; all: Entry[]; now: Date; start: Date }) {
  const sources = incomeSources(list, prevList);
  const c = incomeConsistency(all, now, start);
  const go = (es: Entry[], l: string) => navigate(entriesHref(all, es, l, { type: "income", from, to: lastDay(to) }));
  return (
    <>
      <Section title="INCOME SOURCES" aside={<span className="tnum text-[13px] text-fg-muted">{peso(h.cur.in)}</span>}>
        {sources.length ? (
          <div className="mt-1 divide-y divide-line">
            {sources.map((s) => (
              <Row
                key={s.key}
                label={s.name}
                meta={`${s.category ?? "Income"} · ${entriesText(s.entries.length)}`}
                value={peso(s.amount)}
                trail={<span className="flex w-[58px] flex-none justify-end">{h.prev ? <Delta value={s.change} invert /> : null}</span>}
                onClick={() => go(s.entries, `${s.name} · ${label}`)}
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13.5px] text-fg-muted">No income logged in {label}.</p>
        )}
      </Section>
      <Section title="INCOME CONSISTENCY · LAST 6 MONTHS">
        {c ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-line">
            <div className="p-4">
              <div className="text-[19px] leading-[1.3] font-semibold tracking-[-0.01em]">{VERDICT[c.verdict]}</div>
              <p className="tnum mt-1.5 text-[14px] leading-[1.5] text-fg-muted">
                {peso(c.min)}–{peso(c.max)} a month over the last {c.months.length} finished months, {peso(c.avg)} on average.
              </p>
            </div>
            <SourceLink
              count={c.months.reduce((n, m) => n + m.entries.length, 0)}
              to={entriesHref(
                all,
                c.months.flatMap((m) => m.entries),
                "Income · last 6 months",
              )}
            />
          </div>
        ) : (
          <p className="mt-2 text-[13.5px] leading-[1.45] text-fg-muted">Needs two finished months of entries.</p>
        )}
      </Section>
    </>
  );
}

/* ---------- cloud: M8's stored review for this period ------------------------ */

function StoredReview({ kind, from, to }: { kind: PeriodKind; from: Date; to: Date }) {
  const { all } = useInsights({ markRead: false });
  if (kind === "year") return null;
  const want = kind === "week" ? "weekly" : "monthly";
  const hit = all.find((i) => i.kind === want && i.period_start && new Date(i.period_start) >= from && new Date(i.period_start) < to);
  if (!hit) return null;
  return (
    <div className="px-6 pt-5">
      <AiCard label={`${LABEL[hit.kind]}${hit.stale ? " · OUT OF DATE" : ""}`}>
        <span className={hit.stale ? "opacity-70" : undefined}>{hit.narrative}</span>
      </AiCard>
      <div className="mt-1 font-mono text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle">
        {hit.stale ? "YOUR ENTRIES CHANGED SINCE · " : ""}
        {stamp(hit.created_at).toUpperCase()}
      </div>
    </div>
  );
}

/* ---------- screen ---------------------------------------------------------- */

export function Analytics({ path }: { path: string }) {
  const { state } = useLedger();
  const { openAdd } = useChrome();
  const now = new Date();
  const { kind, from } = readAnalyticsQuery(query(path), now);
  const [, to] = periodBounds(kind, from);
  const all = state.entries;
  const start = ledgerStart(state, now);
  const current = isCurrent(kind, from, now);
  const label = periodLabel(kind, from);

  const go = (k: PeriodKind, f: Date) => navigate(analyticsHref(k, f), { replace: true });
  const pick = (k: PeriodKind) => go(k, periodBounds(k, current ? now : from)[0]);
  const canPrev = shiftPeriod(kind, from, -1).getTime() >= periodBounds(kind, start)[0].getTime();

  if (all.length === 0) {
    return (
      <Screen tabbed>
        <PageTitle>Analytics</PageTitle>
        <div className="flex flex-col items-center px-8 pt-16 text-center">
          <h2 className="text-[19px] leading-[1.25] font-semibold tracking-[-0.01em] text-balance">Nothing to analyse yet</h2>
          <p className="mt-2.5 max-w-[280px] text-[14px] leading-[1.5] text-fg-muted">Log what you spend and earn. “grab gcash 248” is enough. Your weeks, months and years show here.</p>
          <Cta className="mt-7 max-w-[280px]" onClick={() => openAdd()}>
            Add an entry
          </Cta>
        </div>
      </Screen>
    );
  }

  const h = headline(all, kind, from, to, now, start);
  const list = inRange(all, from, to);
  const prevList = inRange(all, h.prior.from, h.prior.to);
  const points = trendSeries(all, kind, from, now, start);
  const mb = kind === "month" ? monthBudget(state, current ? now : lastDay(to)).budget : 0;
  const cards = findings({ kind, from, to, now, label, h, list, prevList, all, budget: { budget: mb, current } });
  const empty = !list.some((e) => isSpend(e) || isIncome(e));
  const prevLabel = priorLabel(kind, h.prior);

  const btn = "flex size-11 items-center justify-center rounded-md active:opacity-60 disabled:opacity-25";
  return (
    <Screen tabbed>
      <PageTitle>Analytics</PageTitle>
      <div className="px-6 pt-4">
        <Segmented value={KIND_LABEL[kind]} options={["Week", "Month", "Year"]} onChange={(v) => pick(v.toLowerCase() as PeriodKind)} />
      </div>
      <div className="flex items-center justify-between px-3 pt-2">
        <button type="button" aria-label={`Previous ${UNIT[kind]}`} className={btn} disabled={!canPrev} onClick={() => go(kind, shiftPeriod(kind, from, -1))}>
          <ChevronLeft size={18} />
        </button>
        <h2 className="tnum text-[15px] font-semibold" aria-live="polite">
          {label}
          {current ? <span className="font-normal text-fg-muted"> · so far</span> : null}
        </h2>
        <button type="button" aria-label={`Next ${UNIT[kind]}`} className={btn} disabled={current} onClick={() => go(kind, shiftPeriod(kind, from, 1))}>
          <ChevronRight size={18} />
        </button>
      </div>

      {cloud ? <StoredReview kind={kind} from={from} to={to} /> : null}

      <section aria-label="Headline" className="px-6 pt-4">
        <Eyebrow>
          {h.prev ? `VS. ${prevLabel.toUpperCase()}${h.prior.partial ? " (SAME DAYS)" : ""}` : "NO EARLIER DATA TO COMPARE"}
          {h.avg ? ` · AVG OF ${h.avg.n} ${UNIT[kind].toUpperCase()}${h.avg.n === 1 ? "" : "S"}` : ""}
        </Eyebrow>
        <HeadlineGrid h={h} />
        <SourceLink bare count={list.filter((e) => isSpend(e) || isIncome(e)).length} to={entriesHref(all, list.filter((e) => isSpend(e) || isIncome(e)), `Income and spending · ${label}`)} />
      </section>

      <TrendChart kind={kind} points={points} onPick={(f) => go(kind, f)} />

      {empty ? (
        <p className="px-6 pt-9 text-[14px] text-fg-muted">Nothing logged in {label}. Step back to an earlier {UNIT[kind]}, or tap a bar.</p>
      ) : (
        <>
          <Section title="WHAT THIS MEANS" ai>
            <div className="mt-3 flex flex-col gap-3">
              {cards.map((f) => (
                <FindingCard key={f.key} f={f} all={all} />
              ))}
            </div>
          </Section>
          <Habits kind={kind} from={from} to={to} now={now} start={start} label={label} h={h} list={list} prevList={prevList} all={all} />
          <Income from={from} to={to} label={label} h={h} list={list} prevList={prevList} all={all} now={now} start={start} />
        </>
      )}
    </Screen>
  );
}
