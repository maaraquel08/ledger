import * as React from "react";
import { useChrome } from "@/components/ledger/chrome";
import { NetWorthTrend, SpendingByAccount } from "@/screens/charts/accounts";
import { CategoryDonut, IncomeSplit } from "@/screens/charts/composition";
import { BillsVsEveryday, CategoryMix } from "@/screens/charts/mix";
import { categoryColors } from "@/lib/chart-colors";
import { AiSummaryText } from "@/components/ui/ai-summary/ai-summary";
import { ChevronLeft, ChevronRight } from "@/components/ledger/icons";
import { AiEyebrow, AiMark, AiPanel, Cta, Delta, Eyebrow, PageTitle, Screen, Segmented } from "@/components/ledger/primitives";
import {
  analyticsHref,
  categoryRows,
  headline,
  isCurrent,
  movers,
  pctChange,
  periodBounds,
  periodLabel,
  readAnalyticsQuery,
  recurringBills,
  savingsRate,
  shiftPeriod,
  periodSteps,
  type Headline,
  type StepPoint,
} from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { addDays, balance, compact, dayName, monthName, monthShort, peso } from "@/lib/format";
import { navigate, query } from "@/lib/router";
import { FIXED, budgetPace, byCategory, inRange, isIncome, isSpend, ledgerStart, monthBudget, type PeriodKind } from "@/lib/selectors";
import { fixedCategories } from "@/lib/categories";
import { useLedger } from "@/lib/store";
import { clearChatHistory } from "@/lib/chat-history";
import { ProfileSheet } from "@/screens/today-sheets";
import { useGaps } from "@/screens/activity";
import type { Entry, LedgerState } from "@/lib/types";
import { entriesHref, needsReview, type EntryKind } from "@/screens/ledger-list";

/*
 * Analytics: one week, month or year at a time, against the period before
 * (like for like while it is still going) and the trailing average. Every
 * number says how many entries it came from and taps through to exactly
 * those entries in Money.
 */

const KIND_LABEL: Record<PeriodKind, "Week" | "Month" | "Year"> = { week: "Week", month: "Month", year: "Year" };
const UNIT: Record<PeriodKind, string> = { week: "week", month: "month", year: "year" };
const lastDay = (to: Date) => addDays(to, -1);
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
function Row({ label, meta, value, trail, onClick, bar }: { label: React.ReactNode; meta?: React.ReactNode; value: React.ReactNode; trail?: React.ReactNode; onClick?: () => void; bar?: { fraction: number; muted?: boolean } }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cn("flex min-h-12 w-full items-center gap-3 py-2 text-left", onClick && "active:opacity-60")}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px]">{label}</span>
        {meta ? <span className="mt-0.5 block truncate font-mono text-[10.5px] tracking-[0.04em] text-fg-subtle uppercase">{meta}</span> : null}
        {/* length = share of the period's spending; the meta line says the same in words */}
        {bar ? (
          <span aria-hidden className="mt-1.5 block h-1.5 rounded-full bg-fill">
            <span className={cn("block h-full rounded-full", bar.muted ? "bg-fg-subtle" : "bg-accent")} style={{ width: `${Math.max(1.5, Math.min(100, bar.fraction * 100))}%` }} />
          </span>
        ) : null}
      </span>
      {/* a fixed width when barred, so every track ends at the same x */}
      <span className={cn("tnum text-[14.5px] font-medium whitespace-nowrap", bar && "w-[88px] flex-none text-right")}>{value}</span>
      {trail}
      {onClick ? <ChevronRight size={14} className="-mr-1 flex-none text-fg-subtle" /> : null}
    </Tag>
  );
}

/**
 * One chart per bordered card, so the page scans as a stack of answers. The chart's own
 * section padding is dropped inside; a chart with nothing to show leaves no empty card.
 */
function ChartCard({ children }: { children: React.ReactNode }) {
  return <div className="mx-6 mt-4 rounded-xl border border-line px-4 pt-4 pb-3 empty:hidden [&>section]:px-0 [&>section]:pt-0">{children}</div>;
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

type Series = "in" | "out";
const SERIES: { key: Series; label: string; dot: string; stroke: string }[] = [
  { key: "in", label: "Income", dot: "bg-chart-in", stroke: "var(--color-chart-in)" },
  { key: "out", label: "Spending", dot: "bg-chart-out", stroke: "var(--color-chart-out)" },
];
const WEEKDAY_TICKS = ["M", "T", "W", "T", "F", "S", "S"];
const STEP: Record<PeriodKind, string> = { week: "day", month: "day", year: "month" };

/** "Tue 3 Nov" for a day, "Oct" for a month. */
const stepName = (kind: PeriodKind, d: Date) => (kind === "year" ? monthName(d) : `${dayName(d).slice(0, 3)} ${d.getDate()} ${monthShort(d)}`);
/** Under the axis: weekday letters, every fifth day of a month, month letters. */
function stepTick(kind: PeriodKind, d: Date, i: number) {
  if (kind === "week") return WEEKDAY_TICKS[i];
  if (kind === "year") return monthShort(d)[0];
  const n = d.getDate();
  return n === 1 || n % 5 === 0 ? `${n}` : "";
}

/**
 * Income and spending through the selected week, month or year, as two running-total lines.
 * The legend filters: tap Income or Spending to show only that line; tap it again for both.
 * Tapping a step shows its figures.
 */
function TrendChart({ kind, steps, label }: { kind: PeriodKind; steps: StepPoint[]; label: string }) {
  const [table, setTable] = React.useState(false);
  const [only, setOnly] = React.useState<Series | null>(null);
  const done = steps.filter((p) => !p.future);
  const [picked, setPicked] = React.useState<number | null>(null);
  const sel = picked != null && picked < done.length ? picked : done.length - 1;
  const visible = SERIES.filter((x) => !only || x.key === only);
  const soFar = (p: StepPoint, k: Series) => (k === "in" ? p.inSoFar : p.outSoFar);
  const max = Math.max(...done.flatMap((p) => visible.map((x) => soFar(p, x.key))), 1);
  const x = (i: number) => ((i + 0.5) / steps.length) * 100;
  const y = (v: number) => 100 - (v / max) * 92;
  const at = done[sel];

  return (
    <Section
      title={`TREND · ${label.toUpperCase()} BY ${STEP[kind].toUpperCase()}`}
      aside={
        <button type="button" aria-pressed={table} onClick={() => setTable((t) => !t)} className="-my-3 -mr-2 flex h-11 flex-none items-center px-2 text-[13px] whitespace-nowrap text-fg-muted active:opacity-60">
          {table ? "Show chart" : "Show table"}
        </button>
      }
    >
      <div role="group" aria-label="Show only" className="mt-3 flex items-center gap-2">
        {SERIES.map((sr) => (
          <button
            key={sr.key}
            type="button"
            aria-pressed={only === sr.key}
            onClick={() => setOnly((o) => (o === sr.key ? null : sr.key))}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors duration-fast",
              only === sr.key ? "border-accent bg-accent font-semibold text-accent-fg" : "border-line-strong text-fg active:bg-surface",
            )}
          >
            <span className={cn("size-2 rounded-full", sr.dot)} />
            {sr.label}
          </button>
        ))}
      </div>

      {table ? (
        <table className="tnum mt-3 w-full text-[13px]">
          <caption className="sr-only">Income and spending per {STEP[kind]} in {label}</caption>
          <thead>
            <tr className="border-b border-line text-left font-mono text-[9.5px] tracking-[0.1em] text-fg-subtle">
              <th scope="col" className="py-2 font-semibold">
                {STEP[kind].toUpperCase()}
              </th>
              {visible.map((sr) => (
                <th key={sr.key} scope="col" className="py-2 text-right font-semibold">
                  {sr.label.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...done].reverse().filter((p) => p.in || p.out).map((p) => (
              <tr key={p.from.toISOString()}>
                <th scope="row" className="py-2.5 text-left font-normal">
                  {stepName(kind, p.from)}
                </th>
                {visible.map((sr) => (
                  <td key={sr.key} className="py-2.5 text-right">
                    {peso(p[sr.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="relative mt-4 pl-8">
            <div className="relative h-[132px]">
              {/* hairline grid: top, middle, baseline; compact tick labels in the left gutter */}
              <div className="pointer-events-none absolute inset-0" aria-hidden>
                {[0.08, 0.54].map((f) => (
                  <div key={f} className="absolute inset-x-0 border-t border-dashed border-line" style={{ top: `${f * 100}%` }}>
                    <span className="tnum absolute right-full -top-[7px] pr-1.5 font-mono text-[9.5px] text-fg-subtle">{compact(max * (f === 0.08 ? 1 : 0.5)).replace("₱", "")}</span>
                  </div>
                ))}
                <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" />
              </div>
              {at ? <div className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${x(sel)}%` }} aria-hidden /> : null}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
                {visible.map((sr) => (
                  <polyline
                    key={sr.key}
                    points={done.map((p, i) => `${x(i)},${y(soFar(p, sr.key))}`).join(" ")}
                    fill="none"
                    stroke={sr.stroke}
                    strokeWidth={2.25}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {/* the picked step's dots, as HTML so they stay round on a stretched chart */}
              {at
                ? visible.map((sr) => (
                    <span
                      key={sr.key}
                      aria-hidden
                      className={cn("pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg", sr.dot)}
                      style={{ left: `${x(sel)}%`, top: `${y(soFar(at, sr.key))}%` }}
                    />
                  ))
                : null}
            </div>
            <div role="group" aria-label={`Each ${STEP[kind]} of ${label}. Tap one for its figures.`} className="absolute inset-y-0 right-0 left-8 grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
              {steps.map((p, i) => (
                <button
                  key={p.from.toISOString()}
                  type="button"
                  disabled={p.future}
                  aria-current={i === sel ? "true" : undefined}
                  aria-label={`${stepName(kind, p.from)}: income ${peso(p.in)}, spending ${peso(p.out)}`}
                  onClick={() => setPicked(i)}
                  className="flex min-w-0 flex-col justify-end"
                >
                  <span className={cn("translate-y-full overflow-visible pt-1.5 text-center font-mono text-[10px] whitespace-nowrap", i === sel ? "font-semibold text-fg" : "text-fg-subtle")}>
                    {stepTick(kind, p.from, i)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {at ? (
            <div className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]" aria-live="polite">
              <span className="font-medium">{stepName(kind, at.from)}</span>
              {visible.map((sr) => (
                <span key={sr.key} className="flex items-center gap-1.5 text-fg-muted">
                  <span className={cn("size-2 rounded-full", sr.dot)} aria-hidden />
                  {sr.key === "in" ? "In" : "Out"} <span className="tnum font-medium text-fg">{peso(at[sr.key])}</span>
                  <span className="tnum text-fg-subtle">· {peso(soFar(at, sr.key))} so far</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-8 text-[13px] text-fg-muted">Nothing yet in {label}.</p>
          )}
        </>
      )}
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

/** A finding's sentence with its key figure marked, as M8 says it. */
function markFigure(f: Finding): React.ReactNode {
  const figure = f.number.replace(/^[+−-]/, "");
  const i = f.text.indexOf(figure);
  if (!figure || i < 0) return f.text;
  return (
    <>
      {f.text.slice(0, i)}
      <AiMark>{figure}</AiMark>
      {f.text.slice(i + figure.length)}
    </>
  );
}

/**
 * The period read out by M8 in one card: each finding a sentence with its figure marked.
 * Tapping a sentence opens the entries behind it.
 */
function Overview({ cards, all, label }: { cards: Finding[]; all: Entry[]; label: string }) {
  return (
    <AiPanel label={`M8 · ${label}`} className="mx-6 mt-6">
      {cards.map((f) => (
        <a
          key={f.key}
          href={`#${entriesHref(all, f.entries, f.label, f.filter)}`}
          aria-label={`${f.text} See the ${entriesText(f.entries.length)} behind it.`}
          className="group block active:opacity-70"
        >
          <AiSummaryText className="mt-2.5 text-[14.5px]/[1.65]">
            {markFigure(f)}
            <span aria-hidden className="ml-1 inline-block text-bg/50 transition-transform group-hover:translate-x-0.5">
              ›
            </span>
          </AiSummaryText>
        </a>
      ))}
    </AiPanel>
  );
}

const THRESHOLD: Record<PeriodKind, number> = { week: 500, month: 1000, year: 5000 };

/** Three to five plain conclusions, each a fixed template over the selectors. */
export function findings(o: {
  kind: PeriodKind;
  from: Date;
  to: Date;
  now: Date;
  label: string;
  h: Headline;
  list: Entry[];
  prevList: Entry[];
  all: Entry[];
  /** pace: share of the budget period gone (selectors.budgetPace; prorated in the first month) */
  budget: { budget: number; current: boolean; pace: number; /** fixed bills (categories.fixedCategories); defaults to the built-ins */ fixed?: string[] };
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
        .filter(([c]) => (o.budget.fixed ?? FIXED).includes(c))
        .reduce((s, [, v]) => s + v, 0);
      const pace = o.budget.pace;
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

/* ---------- where it went ---------------------------------------------------------- */


function WhereItWent({ kind, from, to, label, h, list, prevList, all, state }: { kind: PeriodKind; from: Date; to: Date; label: string; h: Headline; list: Entry[]; prevList: Entry[]; all: Entry[]; state: LedgerState }) {
  const color = categoryColors(state);
  const [allCats, setAllCats] = React.useState(false);
  const go = (es: Entry[], l: string, f?: Parameters<typeof entriesHref>[3]) => navigate(entriesHref(all, es, l, f));
  const range = { from, to: lastDay(to) };
  const rows = categoryRows(list, prevList);
  const shown = allCats ? rows : rows.slice(0, 6);
  const prevLabel = priorLabel(kind, h.prior);

  return (
    <>
      <Section title="WHERE IT WENT" aside={<span className="tnum text-[13px] text-fg-muted">{peso(h.cur.out)}</span>}>
        {/* the donut's legend is the list under it: each row carries its slice's color */}
        <CategoryDonut list={list} state={state} label={label} />
        <div className="mt-1 divide-y divide-line">
          {shown.map((r) => (
            <Row
              key={r.cat}
              label={
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 flex-none rounded-full" style={{ background: color(r.cat) }} />
                  {r.cat}
                </span>
              }
              meta={`${r.share}% · ${entriesText(r.entries.length)}`}
              value={peso(r.amount)}
              bar={{ fraction: r.fraction, muted: r.cat === "Unfiled" }}
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

    </>
  );
}


/* ---------- screen ---------------------------------------------------------- */

/** Profile avatar: opens the profile / settings sheet (it lived on Today). */
function ProfileButton() {
  const { state, dispatch } = useLedger();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" aria-label="Profile" onClick={() => setOpen(true)} className="-mr-[7px] flex size-11 items-center justify-center">
        <span className="flex size-[30px] items-center justify-center rounded-full border border-line-strong font-mono text-[10px] font-semibold">{state.profile.initials || "?"}</span>
      </button>
      <ProfileSheet
        open={open}
        onOpenChange={setOpen}
        name={state.profile.name}
        onReset={() => {
          dispatch({ type: "reset" });
          clearChatHistory();
          navigate("/");
        }}
      />
    </>
  );
}

/** "N things to review": Review has no tab (D-0018), so this row is its door; balance gaps count too. */
function ReviewRow() {
  const { state } = useLedger();
  const gaps = useGaps();
  const n = state.entries.filter(needsReview).length + gaps.list.length;
  if (n === 0) return null;
  return (
    <div className="px-6 pt-4">
      <button type="button" onClick={() => navigate("/review")} className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-line px-4 text-left active:bg-surface">
        <span className="min-w-0 flex-1 text-[14px]">
          <span className="tnum font-semibold">{n}</span> {n === 1 ? "thing" : "things"} to review
        </span>
        <ChevronRight size={14} className="flex-none text-fg-subtle" />
      </button>
    </div>
  );
}

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
        <PageTitle right={<ProfileButton />}>Analytics</PageTitle>
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
  const steps = periodSteps(all, kind, from, now);
  const mb = kind === "month" ? monthBudget(state, current ? now : lastDay(to)) : null;
  const budget = { budget: mb?.budget ?? 0, current, pace: mb && current ? budgetPace(mb, now) : 1, fixed: fixedCategories(state) };
  const cards = findings({ kind, from, to, now, label, h, list, prevList, all, budget });
  const empty = !list.some((e) => isSpend(e) || isIncome(e));
  const prevLabel = priorLabel(kind, h.prior);

  const btn = "flex size-11 items-center justify-center rounded-md active:opacity-60 disabled:opacity-25";
  return (
    <Screen tabbed>
      <PageTitle right={<ProfileButton />}>Analytics</PageTitle>
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

      <section aria-label="Headline" className="px-6 pt-4">
        <Eyebrow>
          {h.prev ? `VS. ${prevLabel.toUpperCase()}${h.prior.partial ? " (SAME DAYS)" : ""}` : "NO EARLIER DATA TO COMPARE"}
          {h.avg ? ` · AVG OF ${h.avg.n} ${UNIT[kind].toUpperCase()}${h.avg.n === 1 ? "" : "S"}` : ""}
        </Eyebrow>
        <HeadlineGrid h={h} />
        <SourceLink bare count={list.filter((e) => isSpend(e) || isIncome(e)).length} to={entriesHref(all, list.filter((e) => isSpend(e) || isIncome(e)), `Income and spending · ${label}`)} />
      </section>

      {kind === "month" ? <ReviewRow /> : null}

      {/* ordered by what you'd ask first: what happened, where it went, how it moved, then the deeper cuts */}
      {empty ? (
        <p className="px-6 pt-9 text-[14px] text-fg-muted">Nothing logged in {label}. Step back to an earlier {UNIT[kind]}.</p>
      ) : (
        <>
          {cards.length ? <Overview cards={cards} all={all} label={label} /> : null}
          <ChartCard>
            <WhereItWent kind={kind} from={from} to={to} label={label} h={h} list={list} prevList={prevList} all={all} state={state} />
          </ChartCard>
        </>
      )}
      <ChartCard>
        <TrendChart key={`${kind}${from.getTime()}`} kind={kind} steps={steps} label={label} />
      </ChartCard>
      {empty ? null : (
        <>
          <ChartCard>
            <IncomeSplit list={list} state={state} label={label} />
          </ChartCard>
          <ChartCard>
            <CategoryMix kind={kind} from={from} state={state} now={now} />
          </ChartCard>
          <ChartCard>
            <BillsVsEveryday kind={kind} from={from} state={state} now={now} />
          </ChartCard>
          <ChartCard>
            <SpendingByAccount list={list} state={state} label={label} />
          </ChartCard>
        </>
      )}
      <ChartCard>
        <NetWorthTrend kind={kind} from={from} state={state} now={now} />
      </ChartCard>
    </Screen>
  );
}
