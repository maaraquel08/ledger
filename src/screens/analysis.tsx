import * as React from "react";
import { useChrome } from "@/components/ledger/chrome";
import { ChevronLeft, ChevronRight } from "@/components/ledger/icons";
import { AiCard, AiMark, Cta, Delta, Eyebrow, Segmented } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { addDays, dayHeading, dayName, kilo, monthName, monthShort, peso, sameDay, signed, startOfDay } from "@/lib/format";
import { navigate } from "@/lib/router";
import { byCategory, daysLogged, entriesOnDay, FIXED, inRange, isSpend, monthBounds, totals, weekBounds } from "@/lib/selectors";
import { useLedger } from "@/lib/store";
import type { Category, Entry } from "@/lib/types";
import { ledgerHref } from "@/screens/ledger-list";

/*
 * Today's week / month / year analysis. Every card is one statement, one
 * number, how many entries it was worked out from, and a way through to
 * exactly those entries in the ledger.
 */

const PERIODS = ["Week", "Month", "Year"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_KEY = "ledger:today-period";

function readPeriod(): Period {
  try {
    const v = sessionStorage.getItem(PERIOD_KEY);
    if (v && (PERIODS as readonly string[]).includes(v)) return v as Period;
  } catch {
    /* storage unavailable */
  }
  return "Week";
}

const spendOf = (entries: Entry[]) => totals(entries).out;
const lastDay = (to: Date) => addDays(to, -1);

/* ---------- the card ------------------------------------------------------ */

function SourceLink({ count, to, bare }: { count: number; to: string; bare?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 font-mono text-[10.5px] font-medium tracking-[0.05em] uppercase",
        bare ? "px-1 text-fg-subtle active:opacity-60" : "border-t border-line px-4 text-fg-subtle active:bg-surface",
      )}
    >
      <span>
        Based on {count} {count === 1 ? "entry" : "entries"}
      </span>
      <span className="flex items-center gap-1 text-fg">
        See entries <ChevronRight size={14} />
      </span>
    </button>
  );
}

function AnalysisCard({
  eyebrow,
  number,
  tone,
  statement,
  count,
  to,
  children,
}: {
  eyebrow: string;
  number: React.ReactNode;
  tone?: "danger" | "success";
  statement: React.ReactNode;
  count: number;
  to: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line">
      <div className="px-4 pt-4 pb-4">
        <Eyebrow>{eyebrow}</Eyebrow>
        <div className={cn("tnum mt-2 text-[26px] leading-none font-semibold tracking-[-0.03em]", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{number}</div>
        <p className="mt-2 text-[14px] leading-[1.5] text-pretty text-fg-muted">{statement}</p>
        {children ? <div className="pt-4">{children}</div> : null}
      </div>
      <SourceLink count={count} to={to} />
    </section>
  );
}

function AiAnalysis({ label, count, to, children }: { label: string; count: number; to: string; children: React.ReactNode }) {
  return (
    <div>
      <AiCard label={label}>{children}</AiCard>
      <SourceLink count={count} to={to} bare />
    </div>
  );
}

/** A tappable list row inside a card: label, amount, optional trailing bit. */
function CardRow({ label, value, trail, onClick }: { label: string; value: string; trail?: React.ReactNode; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cn("flex min-h-11 w-full items-center justify-between gap-3 text-left text-[14.5px]", onClick && "active:opacity-60")}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="tnum font-medium">{value}</span>
      {trail}
    </Tag>
  );
}

function Stepper({ label, onPrev, onNext, canNext }: { label: string; onPrev: () => void; onNext: () => void; canNext: boolean }) {
  const btn = "flex size-11 items-center justify-center rounded-md active:opacity-60 disabled:opacity-25";
  return (
    <div className="flex items-center justify-between px-3 pt-2">
      <button type="button" aria-label="Previous period" className={btn} onClick={onPrev}>
        <ChevronLeft size={18} />
      </button>
      <span className="tnum text-[13px] font-medium">{label}</span>
      <button type="button" aria-label="Next period" className={btn} onClick={onNext} disabled={!canNext}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

/* ---------- week ---------------------------------------------------------- */

function Weekly({ off }: { off: number }) {
  const { state } = useLedger();
  const now = new Date();
  const [from, to] = weekBounds(addDays(now, -7 * off));
  const week = inRange(state.entries, from, to);
  const spends = week.filter(isSpend);
  const total = spendOf(week);
  const prevTotal = spendOf(inRange(state.entries, addDays(from, -7), from));
  const vs = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  const href = (o: { from?: Date; to?: Date; cat?: Category } = {}) =>
    ledgerHref({ type: "expense", from: o.from ?? from, to: o.to ?? lastDay(to), cat: o.cat });

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(from, i);
    return { d, v: spendOf(entriesOnDay(week, d)), future: startOfDay(d) > startOfDay(now) };
  });
  const max = Math.max(...days.map((x) => x.v), 1);
  const elapsed = off === 0 ? ((now.getDay() + 6) % 7) + 1 : 7;
  const avg = total / elapsed;
  const peak = days.reduce((a, b) => (b.v > a.v ? b : a), days[0]);

  const cats = byCategory(week);
  const top = cats.slice(0, 3);
  const rest = cats.slice(3).reduce((s, [, v]) => s + v, 0);
  const unfiled = spends.filter((e) => !e.split?.length && e.category == null).reduce((n, e) => n - e.amount, 0);

  // Weekday pattern over the 4 weeks ending with this one; fixed bills land on a date, not a habit.
  const spanFrom = addDays(to, -28);
  const span = inRange(state.entries, spanFrom, to).filter((e) => isSpend(e) && !FIXED.includes(e.category ?? "Other"));
  const byDow = new Map<number, number>();
  for (const e of span) {
    const k = new Date(e.date).getDay();
    byDow.set(k, (byDow.get(k) ?? 0) - e.amount);
  }
  const worst = [...byDow.entries()].sort((a, b) => b[1] - a[1])[0];
  let insight: React.ReactNode = "Log a few more days and I’ll spot your pricey weekdays.";
  if (worst) {
    const dowName = dayName(new Date(2024, 0, 7 + worst[0])); // 7 Jan 2024 was a Sunday
    const topCat = byCategory(span.filter((e) => new Date(e.date).getDay() === worst[0]))[0];
    insight = (
      <>
        <AiMark>
          {dowName}s cost you {peso(worst[1])}
        </AiMark>{" "}
        over the last four weeks{topCat ? `, mostly ${topCat[0].toLowerCase()}` : ""}. Moving one of those outings in would cover a week of coffee.
      </>
    );
  }

  const that = off === 0 ? "this week" : "that week";
  return (
    <div className="flex flex-col gap-4 px-6 pt-3">
      <AnalysisCard
        eyebrow={off === 0 ? "SPENT THIS WEEK" : "SPENT THAT WEEK"}
        number={peso(total)}
        statement={
          <>
            {vs === null ? `Daily average ${peso(avg)}.` : `${Math.abs(vs)}% ${vs <= 0 ? "less" : "more"} than the week before, ${peso(avg)} a day.`}
            {peak.v > 0 && avg > 0 ? ` ${dayName(peak.d)} was ${(peak.v / avg).toFixed(1)}× your average.` : ""}
          </>
        }
        count={spends.length}
        to={href()}
      >
        <div className="grid grid-cols-7 gap-2">
          {days.map(({ d, v, future }) => {
            const isMax = v > 0 && v === max;
            return (
              <button
                key={d.toISOString()}
                type="button"
                disabled={future}
                aria-label={`${dayHeading(d)}, ${future ? "still to come" : peso(v)}`}
                onClick={() => navigate(href({ from: d, to: d }))}
                className="flex h-[120px] min-w-0 flex-col items-center justify-end gap-1.5 rounded-sm active:opacity-60"
              >
                <span className="tnum font-mono text-[10px] text-fg-muted">{future ? "" : kilo(v)}</span>
                <div className="flex h-[76px] w-full items-end">
                  <div
                    className={cn("w-full rounded-t-[3px] motion-safe:transition-[height] motion-safe:duration-300", isMax ? "bg-accent" : "bg-fill")}
                    style={{ height: `${Math.max(v > 0 ? (v / max) * 100 : 0, future ? 0 : 2)}%` }}
                  />
                </div>
                <span className={cn("font-mono text-[10px]", sameDay(d, now) ? "font-semibold text-fg" : "text-fg-subtle")}>{"MTWTFSS"[(d.getDay() + 6) % 7]}</span>
              </button>
            );
          })}
        </div>
      </AnalysisCard>

      <AnalysisCard
        eyebrow="WHERE IT WENT"
        number={top[0] ? peso(top[0][1]) : peso(0)}
        statement={top[0] && total > 0 ? `${top[0][0]} took ${Math.round((top[0][1] / total) * 100)}% of what you spent ${that}.` : `No spending ${that}.`}
        count={spends.length}
        to={href()}
      >
        {top.length ? (
          <div className="-my-1 divide-y divide-line">
            {top.map(([c, v]) => (
              <CardRow key={c} label={c} value={peso(v)} onClick={() => navigate(href({ cat: c }))} />
            ))}
            {rest > 0 ? <CardRow label="Everything else" value={peso(rest)} /> : null}
            {unfiled > 0 ? <CardRow label="Unfiled" value={`${peso(unfiled)} · ${Math.round((unfiled / total) * 100)}%`} /> : null}
          </div>
        ) : null}
      </AnalysisCard>

      <AiAnalysis label={off === 0 ? "This week" : "That week"} count={span.length} to={ledgerHref({ type: "expense", from: spanFrom, to: lastDay(to) })}>
        {insight}
      </AiAnalysis>
    </div>
  );
}

/* ---------- month --------------------------------------------------------- */

const HEAT = [
  "color-mix(in oklab, var(--color-danger) 10%, var(--color-bg))",
  "color-mix(in oklab, var(--color-danger) 22%, var(--color-bg))",
  "color-mix(in oklab, var(--color-danger) 42%, var(--color-bg))",
  "color-mix(in oklab, var(--color-danger) 70%, var(--color-bg))",
  "var(--color-danger)",
  "color-mix(in oklab, var(--color-danger) 70%, var(--color-accent))",
];

function heatLevel(v: number, max: number) {
  if (v <= 0) return -1;
  const r = v / max;
  if (r >= 1) return 5;
  return r < 0.15 ? 0 : r < 0.35 ? 1 : r < 0.6 ? 2 : r < 0.85 ? 3 : 4;
}

function Monthly({ off }: { off: number }) {
  const { state } = useLedger();
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() - off, 1);
  const [from, to] = monthBounds(ref);
  const [pf, pt] = monthBounds(new Date(ref.getFullYear(), ref.getMonth() - 1, 1));
  const month = inRange(state.entries, from, to);
  const t = totals(month);
  const budget = state.profile.monthlyBudget;
  const diff = budget - t.out;
  const rate = t.in > 0 ? Math.round((t.net / t.in) * 100) : 0;
  const range = { from, to: lastDay(to) };

  const count = Math.round((to.getTime() - from.getTime()) / 86400000);
  const cells = Array.from({ length: count }, (_, i) => {
    const d = addDays(from, i);
    return { d, v: spendOf(entriesOnDay(month, d)), future: startOfDay(d) > startOfDay(now) };
  });
  const max = Math.max(...cells.map((c) => c.v), 1);
  const lead = (from.getDay() + 6) % 7;

  const cur = byCategory(month);
  const prevMap = new Map(byCategory(inRange(state.entries, pf, pt)));
  const change = (c: string, v: number) => {
    const p = prevMap.get(c as never) ?? 0;
    return p > 0 ? Math.round(((v - p) / p) * 100) : 0;
  };
  const mover = cur.slice(0, 6).reduce<{ c: string; d: number } | null>((best, [c, v]) => {
    const d = change(c, v);
    return !best || Math.abs(d) > Math.abs(best.d) ? { c, d } : best;
  }, null);
  const spendCount = month.filter(isSpend).length;
  const name = monthName(ref);

  return (
    <div className="flex flex-col gap-4 px-6 pt-3">
      <AnalysisCard
        eyebrow="SAVED"
        number={t.net < 0 ? signed(t.net) : peso(t.net)}
        tone={t.net < 0 ? "danger" : undefined}
        statement={t.in > 0 ? `You kept ${rate}% of the ${peso(t.in)} that came in during ${name}.` : `No income logged in ${name} yet.`}
        count={month.length}
        to={ledgerHref(range)}
      />

      <AnalysisCard
        eyebrow="SPENT"
        number={peso(t.out)}
        statement={budget ? `${peso(diff)} ${diff >= 0 ? "under" : "over"} your ${peso(budget)} budget. Tap a day to see it.` : "No budget set. Tap a day to see it."}
        count={spendCount}
        to={ledgerHref({ type: "expense", ...range })}
      >
        <div className="grid grid-cols-7 gap-1">
          {"MTWTFSS".split("").map((l, i) => (
            <span key={i} className="text-center font-mono text-[9.5px] text-fg-subtle">
              {l}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {cells.map(({ d, v, future }) => {
            const lvl = heatLevel(v, max);
            return (
              <button
                key={d.getDate()}
                type="button"
                disabled={future}
                aria-label={`${dayHeading(d)}, ${future ? "still to come" : peso(v)}`}
                onClick={() => navigate(ledgerHref({ type: "expense", from: d, to: d }))}
                style={lvl >= 0 ? { background: HEAT[lvl] } : undefined}
                className={cn(
                  "flex aspect-square min-h-9 items-start justify-start rounded-[4px] p-1 font-mono text-[9.5px] active:opacity-60",
                  future ? "border border-dashed border-line-strong text-fg-subtle" : lvl < 0 ? "bg-surface text-fg-muted" : lvl >= 4 ? "text-danger-fg" : "text-fg",
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </AnalysisCard>

      <AnalysisCard
        eyebrow="VS. LAST MONTH"
        number={mover ? `${mover.d > 0 ? "+" : mover.d < 0 ? "−" : ""}${Math.abs(mover.d)}%` : "—"}
        tone={mover && mover.d > 0 ? "danger" : mover && mover.d < 0 ? "success" : undefined}
        statement={mover ? `${mover.c} moved most against ${monthName(pf)}.` : `No spending in ${name}.`}
        count={spendCount}
        to={ledgerHref({ type: "expense", ...range })}
      >
        {cur.length ? (
          <div className="-my-1 divide-y divide-line">
            {cur.slice(0, 6).map(([c, v]) => (
              <CardRow
                key={c}
                label={c}
                value={peso(v)}
                trail={
                  <span className="flex w-[58px] justify-end">
                    <Delta value={change(c, v)} />
                  </span>
                }
                onClick={() => navigate(ledgerHref({ type: "expense", cat: c, ...range }))}
              />
            ))}
          </div>
        ) : null}
      </AnalysisCard>
    </div>
  );
}

/* ---------- year ---------------------------------------------------------- */

function Yearly({ year }: { year: number }) {
  const { state } = useLedger();
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, m) => {
    const [a, b] = monthBounds(new Date(year, m, 1));
    const t = totals(inRange(state.entries, a, b));
    return { m, inn: t.in, out: t.out, future: a > now };
  });
  const yearEntries = inRange(state.entries, new Date(year, 0, 1), new Date(year + 1, 0, 1));
  const inn = months.reduce((s, x) => s + x.inn, 0);
  const out = months.reduce((s, x) => s + x.out, 0);
  const net = inn - out;
  const rate = inn > 0 ? Math.round((net / inn) * 100) : 0;
  const max = Math.max(...months.map((x) => Math.max(x.inn, x.out)), 1);
  const elapsed = Math.max(1, months.filter((x) => !x.future).length);
  const biggest = months.reduce((a, b) => (b.out > a.out ? b : a), months[0]);
  const avgOut = out / elapsed;
  const saved = avgOut > 0 ? net / avgOut : 0;
  const projected = (net / elapsed) * 12;
  const range = { from: new Date(year, 0, 1), to: new Date(year, 11, 31) };
  const [bf, bt] = monthBounds(new Date(year, biggest.m, 1));
  const seg = (v: number) => ({ height: `${(v / max) * 100}%` });

  const line: React.ReactNode =
    inn === 0 ? (
      "Nothing logged for this year yet."
    ) : (
      <>
        You saved <AiMark>{saved.toFixed(1)} months of expenses</AiMark> in {elapsed} month{elapsed > 1 ? "s" : ""}.
        {elapsed < 12 ? ` At this pace ${year} closes at ${signed(projected).replace("+", "")} saved.` : null}
      </>
    );

  return (
    <div className="flex flex-col gap-4 px-6 pt-3">
      <AnalysisCard
        eyebrow={`NET SAVED IN ${year}`}
        number={net < 0 ? signed(net) : peso(net)}
        tone={net < 0 ? "danger" : undefined}
        statement={`${rate}% savings rate: ${peso(inn)} in, ${peso(out)} out.`}
        count={yearEntries.length}
        to={ledgerHref(range)}
      >
        <Eyebrow>INCOME ▲ / SPEND ▼</Eyebrow>
        <div className="mt-3 grid grid-cols-12 gap-1.5">
          {months.map((x) => (
            <div key={x.m} className="flex min-w-0 flex-col" role="img" aria-label={`${monthShort(new Date(year, x.m, 1))}: income ${peso(x.inn)}, spend ${peso(x.out)}`}>
              <div className="flex h-[60px] items-end">
                <div className="w-full rounded-t-[2px] bg-success" style={seg(x.inn)} />
              </div>
              <div className="h-px bg-line-strong" />
              <div className="flex h-[60px] items-start">
                <div className="w-full rounded-b-[2px] bg-danger" style={seg(x.out)} />
              </div>
              <span className="pt-1.5 text-center font-mono text-[10px] text-fg-subtle">{monthShort(new Date(year, x.m, 1))[0]}</span>
            </div>
          ))}
        </div>
      </AnalysisCard>

      {biggest.out > 0 ? (
        <AnalysisCard
          eyebrow="BIGGEST MONTH"
          number={peso(biggest.out)}
          statement={`${monthName(bf)} was your biggest spending month of ${year}.`}
          count={inRange(state.entries, bf, bt).filter(isSpend).length}
          to={ledgerHref({ type: "expense", from: bf, to: lastDay(bt) })}
        />
      ) : null}

      <AiAnalysis label="Year in one line" count={yearEntries.length} to={ledgerHref(range)}>
        {line}
      </AiAnalysis>
    </div>
  );
}

/* ---------- not enough data ----------------------------------------------- */

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

function NotEnough() {
  const { state } = useLedger();
  const { openAdd } = useChrome();
  const n = daysLogged(state.entries);
  const left = 7 - n;
  return (
    <div className="px-6 pt-6">
      <Eyebrow>{n} OF 7 DAYS LOGGED</Eyebrow>
      <h2 className="mt-3 text-[19px] leading-[1.3] font-semibold tracking-[-0.01em]">
        {left > 0 ? `${WORDS[left]} more day${left === 1 ? "" : "s"} and I can tell you something useful.` : "Almost there."}
      </h2>
      <p className="mt-2 text-[14px] leading-[1.5] text-fg-muted">The analysis needs a week of entries. {n === 0 ? "Nothing logged yet." : `You’re on day ${n}.`}</p>
      <Cta className="mt-6" onClick={() => openAdd()}>
        Log today
      </Cta>
    </div>
  );
}

/* ---------- the switch ---------------------------------------------------- */

function periodLabel(period: Period, off: number) {
  const now = new Date();
  if (period === "Week") {
    const [from] = weekBounds(addDays(now, -7 * off));
    const end = addDays(from, 6);
    return from.getMonth() === end.getMonth()
      ? `${from.getDate()} – ${end.getDate()} ${monthName(end)} ${end.getFullYear()}`
      : `${from.getDate()} ${monthShort(from)} – ${end.getDate()} ${monthShort(end)} ${end.getFullYear()}`;
  }
  if (period === "Month") {
    const d = new Date(now.getFullYear(), now.getMonth() - off, 1);
    return `${monthName(d)} ${d.getFullYear()}`;
  }
  const y = now.getFullYear() - off;
  return off === 0 ? `${y} · year to date` : `${y}`;
}

export function Analysis() {
  const { state } = useLedger();
  const [period, setPeriod] = React.useState<Period>(readPeriod);
  const [off, setOff] = React.useState(0);

  const pick = (p: Period) => {
    setPeriod(p);
    setOff(0);
    try {
      sessionStorage.setItem(PERIOD_KEY, p);
    } catch {
      /* ignore */
    }
  };

  return (
    <section aria-label="Analysis">
      <div className="px-6 pt-8">
        <Segmented value={period} options={[...PERIODS]} onChange={pick} />
      </div>
      {daysLogged(state.entries) < 7 ? (
        <NotEnough />
      ) : (
        <>
          <Stepper label={periodLabel(period, off)} onPrev={() => setOff((o) => o + 1)} onNext={() => setOff((o) => Math.max(0, o - 1))} canNext={off > 0} />
          {period === "Week" ? <Weekly off={off} /> : period === "Month" ? <Monthly off={off} /> : <Yearly year={new Date().getFullYear() - off} />}
        </>
      )}
    </section>
  );
}
