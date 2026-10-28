import * as React from "react";
import { ArrowUpIcon, ChevronRight, Sparkle } from "@/components/ledger/icons";
import { AiCard, AiMark, Eyebrow, Screen } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { balance, dayName, monthName, peso } from "@/lib/format";
import { navigate, query } from "@/lib/router";
import { analyticsHref } from "@/lib/analytics";
import { inRange, monthBounds, verdict } from "@/lib/selectors";
import { useLedger, useOnline } from "@/lib/store";
import { todayBudget } from "@/lib/today";
import { MathSheet, ProfileSheet } from "@/screens/today-sheets";
import { Plan } from "@/screens/plan";
import { InsightsInbox, useInsights } from "@/screens/insights-inbox";
import { needsReview } from "@/screens/ledger-list";
import { cloud } from "@/lib/supabase";
import { clearChatHistory } from "@/lib/chat-history";

/*
 * Today: one M8 sentence and the month's number, today's number beside it,
 * a one-line "this month so far" into Analytics and the Review count, then
 * budgets and goals. Logging is the global Add; questions go to M8 in Chat;
 * the week / month / year analysis lives in Analytics (D-0017).
 */

type V = ReturnType<typeof verdict>;
type TB = ReturnType<typeof todayBudget>;

/** M8's line for the day: a fixed template over the verdict, one marked phrase. */
function sentence(v: V, tb: TB, month: string): React.ReactNode {
  if (!tb.hasBudget) return "Tell me what you earn and I’ll work out what you can spend each day.";
  if (v.left < 0)
    return (
      <>
        You’re <AiMark>{peso(v.left)} over</AiMark> {month}’s budget with {v.daysLeft} day{v.daysLeft === 1 ? "" : "s"} to go.
      </>
    );
  if (v.worst && v.worst.delta > 0)
    return (
      <>
        You’re inside your budget, but <AiMark>{v.worst.category.toLowerCase()} is {peso(v.worst.delta)} over pace</AiMark>.
      </>
    );
  return (
    <>
      Keep to <AiMark>{peso(tb.allowance)} a day</AiMark> and {month} ends on budget.
    </>
  );
}

export function Today({ path }: { path: string }) {
  const { state, dispatch } = useLedger();
  const online = useOnline();
  const [mathOpen, setMathOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const insights = useInsights(); // cloud only; empty in local mode

  const now = new Date();
  const v = verdict(state, now);
  const tb = todayBudget(state, now);
  const [mf, mt] = monthBounds(now);
  const month = monthName(now);
  const reviewCount = state.entries.filter(needsReview).length;

  // /budgets lands here: bring the plan section into view
  const toPlan = query(path).get("plan") === "1";
  React.useEffect(() => {
    if (toPlan) document.getElementById("plan")?.scrollIntoView({ block: "start" });
  }, [toPlan]);

  // When the connection drops, today's number freezes at "as of <time>".
  const [offlineSince, setOfflineSince] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setOfflineSince(online ? null : new Date());
  }, [online]);

  let todayValue = "₱—";
  let todaySub = "no budget yet";
  let todayTone = "text-fg-subtle";
  if (tb.hasBudget) {
    todayValue = balance(tb.left);
    todayTone = tb.left < 0 ? "text-danger" : "text-fg";
    todaySub = tb.left < 0 ? "over today" : offlineSince ? `left today, as of ${offlineSince.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : "left today";
  }

  return (
    <Screen tabbed>
      {!online ? (
        <div role="status" className="border-b border-danger/15 bg-[color-mix(in_oklab,var(--color-danger)_5%,var(--color-bg))] px-6 py-2.5 text-[12px] text-danger">
          {cloud ? "Offline. Entries are saved on this phone and sync when you’re back." : "Offline. Entries save on your phone."}
        </div>
      ) : null}

      <div className="flex items-center justify-between px-6 pt-4">
        <span className="eyebrow">
          {dayName(now)} {now.getDate()} {monthName(now).slice(0, 3)}
        </span>
        <button type="button" aria-label="Profile" onClick={() => setProfileOpen(true)} className="-mr-[7px] flex size-11 items-center justify-center">
          <span className="flex size-[30px] items-center justify-center rounded-full border border-line-strong font-mono text-[10px] font-semibold">{state.profile.initials || "?"}</span>
        </button>
      </div>

      <AiCard label="M8 · Today" className="mx-6 mt-3">
        {insights.daily ? insights.daily.narrative : sentence(v, tb, month)}
      </AiCard>

      <div className="px-6 pt-6">
        <Eyebrow>{v.left < 0 ? `OVER BUDGET · ${month.toUpperCase()}` : `LEFT TO SPEND · ${month.toUpperCase()}`}</Eyebrow>
        <div className={cn("tnum mt-2 text-[40px] leading-none font-semibold tracking-[-0.04em]", v.left < 0 && "text-danger", !tb.hasBudget && "text-fg-subtle")}>
          {tb.hasBudget ? balance(v.left) : "₱—"}
        </div>
        <button
          type="button"
          onClick={() => tb.hasBudget && setMathOpen(true)}
          aria-label={`${todayValue} ${todaySub}. Show the math`}
          className="mt-3 flex min-h-11 flex-wrap items-baseline gap-x-2 text-left active:opacity-60"
        >
          <span className={cn("tnum text-[18px] font-semibold tracking-[-0.01em]", todayTone)}>{todayValue}</span>
          <span className="text-[14px] text-fg-subtle">{todaySub}</span>
          {tb.hasBudget ? <span className="text-[13px] text-fg-muted underline underline-offset-4">Show the math</span> : null}
        </button>
      </div>

      <div className="px-6 pt-4">
        <button
          type="button"
          onClick={() => navigate("/chat")}
          className="flex h-[50px] w-full items-center gap-2.5 rounded-[26px] border border-line-strong pr-1.5 pl-[18px] text-left active:bg-surface"
        >
          <Sparkle size={13} className="flex-none text-gold-ink" />
          <span className="min-w-0 flex-1 truncate text-[15px] text-fg-subtle">Ask M8 about your money</span>
          <span className="flex size-[38px] flex-none items-center justify-center rounded-full bg-accent text-accent-fg" aria-hidden>
            <ArrowUpIcon size={16} />
          </span>
        </button>
      </div>

      <div className="px-6 pt-7">
        <div className="divide-y divide-line rounded-lg border border-line">
          <button type="button" onClick={() => navigate(analyticsHref("month", mf))} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-surface">
            <span className="min-w-0 flex-1">
              <span className="eyebrow block">THIS MONTH SO FAR · ANALYTICS</span>
              <span className="tnum mt-1.5 block text-[14px] text-fg-muted">
                In <span className="font-semibold text-fg">{peso(v.totals.in)}</span> · Out <span className="font-semibold text-fg">{peso(v.totals.out)}</span>
                {v.totals.in > 0 ? (
                  <>
                    {" "}
                    · Saved <span className="font-semibold text-fg">{v.savedRate}%</span>
                  </>
                ) : null}
              </span>
            </span>
            <ChevronRight size={14} className="flex-none text-fg-subtle" />
          </button>
          {reviewCount > 0 ? (
            <button type="button" onClick={() => navigate("/review")} className="flex min-h-12 w-full items-center gap-3 px-4 text-left active:bg-surface">
              <span className="min-w-0 flex-1 text-[14px]">
                <span className="tnum font-semibold">{reviewCount}</span> {reviewCount === 1 ? "entry" : "entries"} to review
              </span>
              <ChevronRight size={14} className="flex-none text-fg-subtle" />
            </button>
          ) : null}
        </div>
      </div>

      <InsightsInbox items={insights.inbox} onDismiss={insights.dismiss} />
      <Plan />

      <MathSheet open={mathOpen} onOpenChange={setMathOpen} v={v} month={inRange(state.entries, mf, mt)} today={now} />
      <ProfileSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        name={state.profile.name}
        onReset={() => {
          dispatch({ type: "reset" });
          clearChatHistory();
          navigate("/");
        }}
      />
    </Screen>
  );
}
