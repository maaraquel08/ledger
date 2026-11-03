import * as React from "react";
import { ChevronLeft, ChevronRight } from "@/components/ledger/icons";
import { PageTitle, Screen } from "@/components/ledger/primitives";
import { addDays, localDay, monthName, sameDay } from "@/lib/format";
import { navigate, query } from "@/lib/router";
import { monthBounds, ledgerStart } from "@/lib/selectors";
import { useLedger } from "@/lib/store";
import { SpendCalendar } from "@/screens/charts/spend-calendar";
import { LedgerList } from "@/screens/ledger-list";

const dayOf = (k: string) => new Date(`${k}T00:00:00`);
const NAV = "flex size-11 items-center justify-center rounded-full text-fg active:bg-surface disabled:text-fg-subtle disabled:opacity-40 disabled:active:bg-transparent";

/**
 * Activity: the month's spend calendar on top, the ledger beneath. The ledger's own
 * from/to params are the source of truth, so the month switcher, a tapped day and the
 * ledger's time filter always agree; the calendar shows the month `from` falls in.
 */
export function ActivityTab({ path }: { path: string }) {
  const { state } = useLedger();
  const params = query(path);
  const from = params.get("from");
  const to = params.get("to");
  const pinned = params.has("ids");
  const now = React.useMemo(() => new Date(), []);
  const first = React.useMemo(() => ledgerStart(state, now), [state, now]);

  const setRange = (a: Date, b: Date) => {
    const next = new URLSearchParams(path.split("?")[1] ?? "");
    next.set("from", localDay(a));
    next.set("to", localDay(b));
    navigate(`/activity?${next}`, { replace: true });
  };
  const setMonth = (m: Date) => {
    const [a, b] = monthBounds(m);
    setRange(a, addDays(b, -1));
  };

  // opening the tab bare lands on this month; the ledger's "All time" later clears the range on purpose
  React.useEffect(() => {
    // a bare /activity opens on this month; a link that carries its own filters (an old
    // /money?q=… link, a category from Budget) keeps showing all time
    const filtered = ["q", "type", "acct", "cat", "label"].some((k) => params.has(k));
    if (!from && !to && !pinned && !filtered) setMonth(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = from ? dayOf(from) : now;
  const [month] = monthBounds(shown);
  const isCurrent = month.getTime() === monthBounds(now)[0].getTime();
  const isFirst = month.getTime() <= monthBounds(first)[0].getTime();
  const day = from && to && from === to ? dayOf(from) : null;

  const pick = (d: Date) => {
    if (day && sameDay(day, d)) setMonth(month);
    else setRange(d, d);
  };

  return (
    <Screen tabbed>
      <PageTitle>Activity</PageTitle>
      <div className="flex items-center justify-between px-6 pt-2">
        <button type="button" aria-label="Previous month" disabled={isFirst} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className={`-ml-3 ${NAV}`}>
          <ChevronLeft />
        </button>
        <div aria-live="polite" className="text-[15px] font-medium">
          {monthName(month)} {month.getFullYear()}
        </div>
        <button type="button" aria-label="Next month" disabled={isCurrent} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className={`-mr-3 ${NAV}`}>
          <ChevronRight />
        </button>
      </div>
      <SpendCalendar from={month} now={now} selectedDay={day} onPickDay={pick} />
      <div className="mt-6 border-t border-line pt-4">
        <LedgerList path={path} base="/activity" />
      </div>
      <div className="h-16" aria-hidden />
    </Screen>
  );
}
