import * as React from "react";
import { ActionButton, Cta, Eyebrow, Sheet } from "@/components/ledger/primitives";
import { goalLabel, MAX_AMOUNT, peso } from "@/lib/format";
import { addToGoal, goalProgress } from "@/lib/selectors";
import { newId, useLedger } from "@/lib/store";
import type { Goal } from "@/lib/types";

/* Savings goals and the total-budget sheet, shown on the Budget tab. Edits open in sheets. */

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

export const num = (s: string) => {
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Savings goals: list, New, edit, Add money. Lives on the Budget tab. */
export function Goals() {
  const { state, dispatch } = useLedger();
  const { profile } = state;
  const [goalSheet, setGoalSheet] = React.useState<{ goal: Goal | null } | null>(null);
  const [addTo, setAddTo] = React.useState<Goal | null>(null);

  return (
    <section id="goals" aria-label="Goals" className="scroll-mt-4">
      <div className="px-6 pt-8">
        <div className="flex items-center justify-between">
          <Eyebrow>GOALS</Eyebrow>
          <button type="button" onClick={() => setGoalSheet({ goal: null })} className="flex h-11 min-w-11 items-center justify-center px-1 text-[13px] font-medium active:opacity-60">
            New
          </button>
        </div>
        {profile.goals.length === 0 ? (
          <p className="py-3 text-[14px] text-fg-muted">No goals yet. Name something you’re saving for.</p>
        ) : (
          <ul>
            {profile.goals.map((g) => {
              const { pct: p, toGo } = goalProgress(g);
              return (
                <li key={g.id} className="py-1.5">
                  <button type="button" aria-label={`Edit ${g.name}: ${p >= 100 ? "reached" : `${p}%`}, ${peso(toGo)} to go`} onClick={() => setGoalSheet({ goal: g })} className="block w-full py-2 text-left active:opacity-60">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14.5px] font-medium">{g.name}</span>
                      {/* saving past the target is fine; say it's reached rather than "133%" */}
                      <span className="tnum text-[14px] font-semibold text-info">{p >= 100 ? "Reached" : `${p}%`}</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${g.name} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, p)}
                      className="mt-2.5 h-2 rounded-full bg-fill"
                    >
                      <div className="h-full rounded-full bg-info" style={{ width: `${Math.min(100, p)}%` }} />
                    </div>
                    <div className="tnum mt-2 text-[12px] text-fg-muted">
                      {peso(g.saved)} of {peso(g.target)} · {goalLabel(g.by)}
                    </div>
                  </button>
                  <div className="flex items-center justify-between gap-3">
                    <span className="tnum text-[13px] font-medium">{toGo > 0 ? `${peso(toGo)} to go` : "Goal reached"}</span>
                    <button
                      type="button"
                      aria-label={`Add money to ${g.name}`}
                      onClick={() => setAddTo(g)}
                      className="flex h-11 min-w-11 items-center justify-center rounded-md border border-line-strong px-3.5 text-[13px] font-medium active:bg-surface"
                    >
                      Add money
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AddMoneySheet
        key={`add-${addTo?.id ?? "none"}`}
        goal={addTo}
        onClose={() => setAddTo(null)}
        onAdd={(g, amount) => {
          dispatch({ type: "update-profile", patch: { goals: profile.goals.map((x) => (x.id === g.id ? addToGoal(x, amount) : x)) } });
          setAddTo(null);
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

export function TotalSheet({ open, value, catTotal, onClose, onSave }: { open: boolean; value: number; catTotal: number; onClose: () => void; onSave: (n: number) => void }) {
  const [amt, setAmt] = React.useState(String(value));
  React.useEffect(() => {
    if (open) setAmt(String(value));
  }, [open, value]);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Total monthly budget">
      <Field label="MONTHLY BUDGET" prefix="₱" value={amt} onChange={setAmt} inputMode="numeric" />
      {num(amt) > 0 && num(amt) < catTotal ? (
        <p role="status" className="tnum mt-2 text-[13px] leading-[1.45] text-gold-ink">
          Your category budgets add up to {peso(catTotal)}, {peso(catTotal - num(amt))} more than this.
        </p>
      ) : null}
      <Cta className="mt-5" disabled={num(amt) <= 0} onClick={() => onSave(num(amt))}>
        Save budget
      </Cta>
    </Sheet>
  );
}

function AddMoneySheet({ goal, onClose, onAdd }: { goal: Goal | null; onClose: () => void; onAdd: (g: Goal, amount: number) => void }) {
  const [amt, setAmt] = React.useState("");
  const n = Math.min(MAX_AMOUNT, Math.round(num(amt)));
  const after = goal ? addToGoal(goal, n) : null;
  const left = goal && after ? goalProgress(after).toGo : 0;
  return (
    <Sheet open={!!goal} onOpenChange={(o) => !o && onClose()} title={goal ? `Add to ${goal.name}` : "Add money"}>
      <Field label="AMOUNT" prefix="₱" value={amt} onChange={setAmt} inputMode="numeric" placeholder="0" />
      {goal && after ? (
        <p role="status" className="tnum mt-2 text-[13px] leading-[1.45] text-fg-muted">
          {n > 0 ? `${peso(goal.saved)} becomes ${peso(after.saved)}. ` : `${peso(goal.saved)} saved so far. `}
          {left > 0 ? `${peso(left)} to go.` : "That reaches your goal."} Your money stays in your accounts.
        </p>
      ) : null}
      <Cta className="mt-5" disabled={n <= 0} onClick={() => goal && onAdd(goal, n)}>
        {n > 0 ? `Add ${peso(n)}` : "Add money"}
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
        <div className="flex items-center justify-between">
          <Eyebrow>BY</Eyebrow>
          {by && (
            <button type="button" onClick={() => setBy("")} className="-my-3 py-3 text-[13px] font-medium text-fg-muted active:opacity-60">
              No date
            </button>
          )}
        </div>
        <input
          type="month"
          value={by}
          onChange={(e) => setBy(e.target.value)}
          className="mt-2 block h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-fg outline-none focus:border-accent"
        />
        {!by && <p className="mt-1.5 text-[12px] text-fg-muted">No date — saving at your own pace.</p>}
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
