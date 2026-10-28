import * as React from "react";
import { ActionButton, Cta, Eyebrow, Pill, Sheet } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { goalLabel, monthName, peso } from "@/lib/format";
import { byCategory, FIXED, inRange, monthBounds, verdict } from "@/lib/selectors";
import { newId, useLedger } from "@/lib/store";
import type { Category, Goal } from "@/lib/types";

/*
 * Budgets and goals, as a section of Today: the month's budget against
 * pace, category budgets and savings goals. Edits open in sheets.
 */

function Field({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "numeric" | "decimal" | "text";
  placeholder?: string;
  prefix?: string;
}) {
  return (
    <label className="mt-4 block">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2 flex h-12 items-center rounded-md border border-line-strong bg-bg px-3 focus-within:border-accent">
        {prefix ? <span className="mr-1.5 text-fg-muted">{prefix}</span> : null}
        <input
          value={value}
          inputMode={inputMode}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="tnum h-full min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
    </label>
  );
}

const num = (s: string) => {
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const BUDGET_CATS: Category[] = ["Food & drink", "Groceries", "Transport", "Shopping", "Rent & bills", "Subscriptions", "Gifts", "Health", "Other"];

export function Plan() {
  const { state, dispatch } = useLedger();
  const { profile } = state;
  const now = new Date();
  const v = verdict(state, now);
  const [from, to] = monthBounds(now);
  const spentBy = new Map(byCategory(inRange(state.entries, from, to)));
  const pace = now.getDate() / v.daysInMonth;
  // bills are due in full on their date; only the discretionary rest is paced
  const fixedSpent = FIXED.reduce((sum, c) => sum + (spentBy.get(c) ?? 0), 0);
  const overPace = v.left < 0 || v.spent - fixedSpent > (v.budget - fixedSpent) * pace;
  const budgets = BUDGET_CATS.filter((c) => (profile.categoryBudgets[c] ?? 0) > 0);

  const [catSheet, setCatSheet] = React.useState<{ cat: Category | null } | null>(null);
  const [totalOpen, setTotalOpen] = React.useState(false);
  const [goalSheet, setGoalSheet] = React.useState<{ goal: Goal | null } | null>(null);

  return (
    <section id="plan" aria-label="Budgets and goals" className="scroll-mt-4">
      <div className="px-6 pt-10">
        <div className="flex items-center justify-between">
          <Eyebrow>BUDGET · {monthName(now).toUpperCase()}</Eyebrow>
          <button type="button" onClick={() => setTotalOpen(true)} className="flex h-10 items-center px-1 text-[13px] text-fg-muted active:opacity-60">
            Adjust
          </button>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="tnum text-[14.5px]">
            <span className={cn("font-semibold", v.left < 0 ? "text-danger" : "text-fg")}>{peso(v.spent)}</span>
            <span className="text-fg-muted"> of {peso(v.budget)}</span>
          </span>
          <span className={cn("tnum text-[13px]", overPace ? "font-medium text-danger" : "text-fg-muted")}>
            {overPace ? "Ahead of pace" : `${v.daysLeft} day${v.daysLeft === 1 ? "" : "s"} left`}
          </span>
        </div>
        <div className="relative mt-2.5 h-1.5 rounded-full bg-fill">
          <div className={cn("h-full rounded-full", overPace ? "bg-danger" : "bg-accent")} style={{ width: `${v.budget > 0 ? Math.min(100, (v.spent / v.budget) * 100) : 0}%` }} />
          <div className="absolute -top-1 h-3.5 w-px bg-accent" style={{ left: `${pace * 100}%` }} aria-hidden />
        </div>
      </div>

      <div className="px-6 pt-8">
        <div className="flex items-center justify-between">
          <Eyebrow>CATEGORY BUDGETS</Eyebrow>
          <button type="button" onClick={() => setCatSheet({ cat: null })} className="flex h-10 items-center px-1 text-[13px] text-fg-muted active:opacity-60">
            Add
          </button>
        </div>
        {budgets.length === 0 ? (
          <p className="py-3 text-[14px] text-fg-muted">No category budgets yet. Add one to see how you’re pacing.</p>
        ) : (
          <ul>
            {budgets.map((c) => {
              const cap = profile.categoryBudgets[c] ?? 0;
              const spent = spentBy.get(c) ?? 0;
              const over = spent > cap;
              return (
                <li key={c}>
                  <button type="button" onClick={() => setCatSheet({ cat: c })} className="block w-full py-3.5 text-left active:opacity-60">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14.5px]">{c}</span>
                      <span className="tnum text-[13px] text-fg-muted">
                        <span className={cn("font-semibold", over ? "text-danger" : "text-fg")}>{peso(spent)}</span> / {Math.round(cap).toLocaleString("en-PH")}
                      </span>
                    </div>
                    <div className="relative mt-2.5 h-1.5 rounded-full bg-fill">
                      <div className={cn("h-full rounded-full", over ? "bg-danger" : "bg-accent")} style={{ width: `${Math.min(100, (spent / cap) * 100)}%` }} />
                      <div className="absolute -top-1 h-3.5 w-px bg-accent" style={{ left: `${pace * 100}%` }} aria-hidden />
                    </div>
                    {over && <div className="tnum mt-1.5 text-[12px] font-medium text-danger">{peso(spent - cap)} over</div>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="px-6 pt-8">
        <div className="flex items-center justify-between">
          <Eyebrow>GOALS</Eyebrow>
          <button type="button" onClick={() => setGoalSheet({ goal: null })} className="flex h-10 items-center px-1 text-[13px] font-medium active:opacity-60">
            New
          </button>
        </div>
        {profile.goals.length === 0 ? (
          <p className="py-3 text-[14px] text-fg-muted">No goals yet. Name something you’re saving for.</p>
        ) : (
          <ul>
            {profile.goals.map((g) => {
              const p = g.target > 0 ? Math.round((g.saved / g.target) * 100) : 0;
              return (
                <li key={g.id}>
                  <button type="button" onClick={() => setGoalSheet({ goal: g })} className="block w-full py-3.5 text-left active:opacity-60">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14.5px] font-medium">{g.name}</span>
                      <span className="tnum text-[14px] font-semibold text-info">{p}%</span>
                    </div>
                    <div className="mt-2.5 h-1.5 rounded-full bg-fill">
                      <div className="h-full rounded-full bg-info" style={{ width: `${Math.min(100, p)}%` }} />
                    </div>
                    <div className="tnum mt-2 text-[12px] text-fg-muted">
                      {peso(g.saved)} of {peso(g.target)} · {goalLabel(g.by)}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CategorySheet
        key={`cat-${catSheet?.cat ?? "new"}`}
        state={catSheet}
        taken={budgets}
        onClose={() => setCatSheet(null)}
        onSave={(cat, amount) => {
          const next = { ...profile.categoryBudgets };
          if (amount > 0) next[cat] = amount;
          else delete next[cat];
          dispatch({ type: "update-profile", patch: { categoryBudgets: next } });
          setCatSheet(null);
        }}
        current={(c) => profile.categoryBudgets[c] ?? 0}
      />
      <TotalSheet
        open={totalOpen}
        value={v.budget}
        onClose={() => setTotalOpen(false)}
        onSave={(n) => {
          dispatch({ type: "update-profile", patch: { monthlyBudget: n } });
          setTotalOpen(false);
        }}
      />
      <GoalSheet
        key={`goal-${goalSheet?.goal?.id ?? "new"}`}
        state={goalSheet}
        onClose={() => setGoalSheet(null)}
        onSave={(g) => {
          const exists = profile.goals.some((x) => x.id === g.id);
          dispatch({ type: "update-profile", patch: { goals: exists ? profile.goals.map((x) => (x.id === g.id ? g : x)) : [...profile.goals, g] } });
          setGoalSheet(null);
        }}
        onDelete={(id) => {
          dispatch({ type: "update-profile", patch: { goals: profile.goals.filter((x) => x.id !== id) } });
          setGoalSheet(null);
        }}
      />
    </section>
  );
}

function CategorySheet({
  state,
  taken,
  current,
  onClose,
  onSave,
}: {
  state: { cat: Category | null } | null;
  taken: Category[];
  current: (c: Category) => number;
  onClose: () => void;
  onSave: (c: Category, amount: number) => void;
}) {
  const [cat, setCat] = React.useState<Category | null>(state?.cat ?? null);
  const [amt, setAmt] = React.useState(state?.cat ? String(current(state.cat)) : "");
  const editing = !!state?.cat;
  const [confirm, setConfirm] = React.useState(false);
  return (
    <Sheet open={!!state} onOpenChange={(o) => { if (!o) { setConfirm(false); onClose(); } }} title={editing ? `${state!.cat} budget` : "New category budget"}>
      {!editing && (
        <div className="mt-4 flex flex-wrap gap-2">
          {BUDGET_CATS.filter((c) => !taken.includes(c)).map((c) => (
            <Pill key={c} active={cat === c} className="min-h-10" onClick={() => setCat(c)}>
              {c}
            </Pill>
          ))}
        </div>
      )}
      <Field label="MONTHLY BUDGET" prefix="₱" value={amt} onChange={setAmt} inputMode="numeric" placeholder="0" />
      <div className="mt-5 flex flex-col gap-2.5">
        <Cta disabled={!cat || num(amt) <= 0} onClick={() => cat && onSave(cat, num(amt))}>
          Save budget
        </Cta>
        {editing &&
          (confirm ? (
            <div className="rounded-lg border border-danger/50 p-3.5">
              <p className="text-[13.5px] leading-[1.45]">Remove the {state!.cat} budget? Your spending in this category stays in Money.</p>
              <div className="mt-3 flex gap-2.5">
                <ActionButton variant="secondary" className="min-h-11 flex-1" autoFocus onClick={() => setConfirm(false)}>
                  Cancel
                </ActionButton>
                <ActionButton className="min-h-11 flex-1 !bg-danger" onClick={() => onSave(state!.cat!, 0)}>
                  Remove budget
                </ActionButton>
              </div>
            </div>
          ) : (
            <Cta variant="secondary" onClick={() => setConfirm(true)}>
              Remove budget
            </Cta>
          ))}
      </div>
    </Sheet>
  );
}

function TotalSheet({ open, value, onClose, onSave }: { open: boolean; value: number; onClose: () => void; onSave: (n: number) => void }) {
  const [amt, setAmt] = React.useState(String(value));
  React.useEffect(() => {
    if (open) setAmt(String(value));
  }, [open, value]);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Total monthly budget">
      <Field label="MONTHLY BUDGET" prefix="₱" value={amt} onChange={setAmt} inputMode="numeric" />
      <Cta className="mt-5" disabled={num(amt) <= 0} onClick={() => onSave(num(amt))}>
        Save budget
      </Cta>
    </Sheet>
  );
}

function GoalSheet({
  state,
  onClose,
  onSave,
  onDelete,
}: {
  state: { goal: Goal | null } | null;
  onClose: () => void;
  onSave: (g: Goal) => void;
  onDelete: (id: string) => void;
}) {
  const g = state?.goal ?? null;
  const [name, setName] = React.useState(g?.name ?? "");
  const [target, setTarget] = React.useState(g ? String(g.target) : "");
  const [saved, setSaved] = React.useState(g ? String(g.saved) : "");
  const [by, setBy] = React.useState(g?.by ?? "");
  const [confirm, setConfirm] = React.useState(false);
  return (
    <Sheet open={!!state} onOpenChange={(o) => { if (!o) { setConfirm(false); onClose(); } }} title={g ? "Edit goal" : "New goal"}>
      <Field label="NAME" value={name} onChange={setName} placeholder="Emergency fund" />
      <Field label="TARGET" prefix="₱" value={target} onChange={setTarget} inputMode="numeric" placeholder="0" />
      {g && <Field label="SAVED SO FAR" prefix="₱" value={saved} onChange={setSaved} inputMode="numeric" />}
      <label className="mt-4 block">
        <Eyebrow>BY</Eyebrow>
        <input
          type="month"
          value={by}
          onChange={(e) => setBy(e.target.value)}
          className="mt-2 block h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-fg outline-none focus:border-accent"
        />
      </label>
      <div className="mt-5 flex flex-col gap-2.5">
        <Cta
          disabled={!name.trim() || num(target) <= 0}
          onClick={() => onSave({ id: g?.id ?? newId("g"), name: name.trim(), target: num(target), saved: g ? num(saved) : 0, by })}
        >
          {g ? "Save goal" : "Create goal"}
        </Cta>
        {g &&
          (confirm ? (
            <div className="rounded-lg border border-danger/50 p-3.5">
              <p className="text-[13.5px] leading-[1.45]">
                <span className="font-semibold">Delete ‘{g.name}’?</span> This removes the goal ({goalLabel(g.by)}) and its {peso(g.saved)} of {peso(g.target)} progress. Your money stays in your accounts.
              </p>
              <div className="mt-3 flex gap-2.5">
                <ActionButton variant="secondary" className="min-h-11 flex-1" autoFocus onClick={() => setConfirm(false)}>
                  Cancel
                </ActionButton>
                <ActionButton className="min-h-11 flex-1 !bg-danger" onClick={() => onDelete(g.id)}>
                  Delete goal
                </ActionButton>
              </div>
            </div>
          ) : (
            <Cta variant="secondary" onClick={() => setConfirm(true)}>
              Delete goal
            </Cta>
          ))}
      </div>
    </Sheet>
  );
}
