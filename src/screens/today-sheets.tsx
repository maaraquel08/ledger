import * as React from "react";
import { AiSummaryText } from "@/components/ui/ai-summary/ai-summary";
import { AiMark, AiPanel, Cta, Eyebrow, Sheet } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { peso, signed } from "@/lib/format";
import { navigate } from "@/lib/router";
import { byCategory, FIXED, inRange, verdict } from "@/lib/selectors";
import { todayBudget } from "@/lib/today";
import type { Category } from "@/lib/types";
import { useLedger } from "@/lib/store";
import { cloud } from "@/lib/supabase";
import { CloudSettings } from "@/screens/settings";

const MATH_KEY = "ledger:math-seen";

export function flag(key: string) {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
export function setFlag(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

type V = ReturnType<typeof verdict>;

/** "Show the math": how today's number is worked out. */
export function MathSheet({
  open,
  onOpenChange,
  v,
  month,
  today,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  v: V;
  month: ReturnType<typeof inRange>;
  today: Date;
}) {
  const { state } = useLedger();
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open || flag(MATH_KEY)) return;
    setBusy(true);
    const t = setTimeout(() => {
      setFlag(MATH_KEY);
      setBusy(false);
    }, 600);
    return () => clearTimeout(t);
  }, [open]);

  const tb = todayBudget(state, today);
  const spent = new Map(byCategory(month));
  const frac = today.getDate() / v.daysInMonth;
  const lines = Object.entries(state.profile.categoryBudgets)
    .filter(([, b]) => (b ?? 0) > 0)
    .map(([c, b]) => ({ c, b: b as number, s: spent.get(c as never) ?? 0 }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="The math">
      {busy ? (
        <div className="py-6" aria-busy="true">
          {[100, 85, 92, 70, 60].map((w, i) => (
            <div key={i} className="skeleton mb-3.5 h-5 rounded-md" style={{ width: `${w}%` }} />
          ))}
          <p className="mt-2 font-mono text-[11px] text-fg-subtle">Reading {state.entries.length} transactions…</p>
        </div>
      ) : (
        <div className="pt-5">
          <AiPanel label="How I got the number">
            <div className="mt-3.5 flex flex-col gap-2.5 text-[14.5px]">
              {tb.hasBudget ? (
                <>
                  <MathRow label="Budget" value={peso(tb.budget)} />
                  <MathRow label="− Spent before today" value={peso(tb.spentBefore)} />
                  <MathRow
                    label={`÷ ${tb.daysLeft} days left`}
                    value={<AiMark>{peso(tb.allowance)} a day</AiMark>}
                    strong
                  />
                  <MathRow label="− Spent today on day-to-day" value={peso(tb.spentToday)} />
                  <MathRow
                    label="= Left today"
                    value={
                      tb.left < 0 ? (
                        <span className="text-danger">−{peso(-tb.left)} over today</span>
                      ) : (
                        `${peso(tb.left)} left today`
                      )
                    }
                    strong
                  />
                </>
              ) : null}
            </div>
            <AiSummaryText className="mt-4 text-[13.5px]/[1.65]">
              What was left of your monthly budget this morning, spread evenly over the {tb.hasBudget ? tb.daysLeft : v.daysLeft} days remaining including
              today, minus what you’ve spent today on day-to-day things. Rent, bills, groceries and household come out of the pool from tomorrow.
              Investments and transfers between your accounts don’t count as spending.
            </AiSummaryText>
          </AiPanel>
          {lines.length ? (
            <>
              <Eyebrow className="mt-6">MONTH PACE</Eyebrow>
              <ul className="mt-2 flex flex-col gap-1">
                {lines.map((l) => {
                  // bills are due in full on their date — compare them to the whole budget
                  const pace = FIXED.includes(l.c as Category) ? l.b : l.b * frac;
                  const diff = Math.round(l.s - pace);
                  return (
                    <li key={l.c} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                      <span className="min-w-0">
                        <span className="block truncate">{l.c}</span>
                        <span className="tnum block text-fg-subtle">{peso(l.s)} of {peso(l.b)}</span>
                      </span>
                      <span className={cn("tnum flex-none font-semibold", diff > 0 ? "text-danger" : "text-success")}>
                        {diff > 0 ? `${signed(-diff)} over pace` : `${peso(-diff)} under`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <Cta
            className="mt-5"
            onClick={() => {
              onOpenChange(false);
              navigate(`/chat?q=${encodeURIComponent("Show me how you worked out my daily budget")}`);
            }}
          >
            Ask a follow-up
          </Cta>
        </div>
      )}
    </Sheet>
  );
}

/** One line of the sum, on the AI painting (paper on ink). */
function MathRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between", strong && "border-t border-bg/15 pt-2.5")}>
      <span className="text-bg/86">{label}</span>
      <span className={cn("tnum text-bg/90", strong && "font-semibold")}>{value}</span>
    </div>
  );
}

export function ProfileSheet({ open, onOpenChange, name, onReset }: { open: boolean; onOpenChange: (o: boolean) => void; name: string; onReset: () => void }) {
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => {
    if (!open) setConfirm(false);
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Profile">
      <p className="pt-4 text-[18px] font-semibold">{name || "You"}</p>
      {cloud ? (
        <div className="mt-1">
          <CloudSettings onClose={() => onOpenChange(false)} />
        </div>
      ) : (
      <div className="mt-5">
        {confirm ? (
          <div role="alertdialog" aria-label="Confirm erase all data">
            <p className="text-[15px] font-semibold">Erase all data on this phone?</p>
            <p className="mt-1 text-[13.5px] text-fg-muted">This clears every account, entry and goal on this device. It can’t be undone.</p>
            <div className="mt-4 flex gap-2.5">
              <Cta variant="secondary" autoFocus onClick={() => setConfirm(false)}>
                Cancel
              </Cta>
              <Cta className="!bg-danger !text-accent-fg" aria-label="Erase all data" onClick={onReset}>
                Erase everything
              </Cta>
            </div>
          </div>
        ) : (
          <Cta variant="secondary" onClick={() => setConfirm(true)}>
            Erase all data
          </Cta>
        )}
      </div>
      )}
    </Sheet>
  );
}
