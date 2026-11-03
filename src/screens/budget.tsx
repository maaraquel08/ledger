import * as React from "react";
import { AmountInput, amountDigits, PickField } from "@/components/ledger/entry-draft";
import { ChevronLeft, ChevronRight } from "@/components/ledger/icons";
import { ActionButton, Cta, EntryRow, Eyebrow, PageTitle, Screen, Segmented, Sheet, StatGrid } from "@/components/ledger/primitives";
import { allocation, budgetRows, categoryBudgetPatch, planParts, type PlanPart, categoryHistory, lastDayOf, monthPace, parsePct, receivedBy, startOfMonth, type BudgetRow, type BudgetSetting } from "@/lib/budget";
import { categoryNameError, incomeCategories, spendCategories, SYSTEM_CATEGORIES, userCategories } from "@/lib/categories";
import { categoryColors, VIZ_OTHER } from "@/lib/chart-colors";
import { cn } from "@/lib/cn";
import { balance, monthName, peso } from "@/lib/format";
import { navigate, query } from "@/lib/router";
import { budgetBase, inRange, isIncome, isSpend, ledgerStart, monthBounds, pctOf, spendParts, verdict } from "@/lib/selectors";
import { useLedger } from "@/lib/store";
import { todayBudget } from "@/lib/today";
import type { Category, Entry } from "@/lib/types";
import { TotalSheet } from "@/screens/plan";
import { MathSheet } from "@/screens/today-sheets";

/*
 * Budget tab: how much can I still spend, and where. The month's left-to-spend, every spending
 * category against its budget (pace marker on the bar), income categories, category CRUD in
 * sheets, and goals. Past months read as they ended.
 */

const inputClass = "h-12 w-full rounded-md border border-line-strong bg-bg px-3.5 text-[16px] outline-none focus:border-accent";

/** "2026-10" <-> first of that month. Anything else, or a future month, falls back to this month. */
function readMonth(path: string, now: Date, start: Date) {
  const m = /^(\d{4})-(\d{2})$/.exec(query(path).get("m") ?? "");
  if (!m) return startOfMonth(now);
  const d = new Date(+m[1], +m[2] - 1, 1);
  return d > startOfMonth(now) || d < startOfMonth(start) ? startOfMonth(now) : d;
}
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shiftMonth = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/** A thin budget bar; the pace marker shows where today's share of the month falls. */
function Bar({ fraction, pace, danger, label }: { fraction: number; pace?: number | null; danger?: boolean; label: string }) {
  return (
    <div role="img" aria-label={label} className="relative h-1.5 rounded-full bg-fill">
      <div className={cn("h-full rounded-full", danger ? "bg-danger" : "bg-accent")} style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
      {pace != null && pace < 1 ? <div className="absolute -top-1 h-3.5 w-px bg-accent" style={{ left: `${pace * 100}%` }} aria-hidden /> : null}
    </div>
  );
}

const sectionHead = "flex items-center justify-between";
const textBtn = "flex h-11 min-w-11 items-center justify-center px-1 text-[13px] text-fg-muted active:opacity-60";

export function Budget({ path }: { path: string }) {
  const { state, dispatch } = useLedger();
  const now = new Date();
  const start = ledgerStart(state, now);
  const at = readMonth(path, now, start);
  const current = monthKey(at) === monthKey(now);
  const asOf = current ? now : lastDayOf(at);
  const go = (d: Date) => navigate(monthKey(d) === monthKey(now) ? "/budget" : `/budget?m=${monthKey(d)}`, { replace: true });
  const canPrev = shiftMonth(at, -1) >= startOfMonth(start);

  const spendCats = spendCategories(state);
  const incomeCats = incomeCategories(state);
  const rows = budgetRows(state, spendCats, at, now);
  const alloc = allocation(state, spendCats);
  const plan = planParts(state, spendCats);
  const color = categoryColors(state);
  // budgeted first (biggest budget first), then the rest in the Owner's order
  const budgeted = rows.filter((r) => r.status !== "none").sort((a, b) => b.budget - a.budget);
  const unbudgeted = rows.filter((r) => r.status === "none");
  const pace = monthPace(state, at, now);
  const received = receivedBy(state.entries, at);

  const v = verdict(state, asOf);
  const tb = todayBudget(state, now);
  const [mf, mt] = monthBounds(at);
  const hasBudget = v.budget > 0;
  const overPace = current && !!hasBudget && v.left >= 0 && v.spent > v.budget * pace;

  const [mathOpen, setMathOpen] = React.useState(false);
  const [totalOpen, setTotalOpen] = React.useState(false);
  const [sheet, setSheet] = React.useState<{ cat: Category; kind: "expense" | "income" } | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);

  const btn = "flex size-11 items-center justify-center rounded-md active:opacity-60 disabled:opacity-25";
  const month = monthName(at).toUpperCase();

  return (
    <Screen tabbed>
      <PageTitle>Budget</PageTitle>
      <div className="flex items-center justify-between px-3 pt-2">
        <button type="button" aria-label="Previous month" className={btn} disabled={!canPrev} onClick={() => go(shiftMonth(at, -1))}>
          <ChevronLeft size={18} />
        </button>
        <h2 className="tnum text-[15px] font-semibold" aria-live="polite">
          {monthName(at)} {at.getFullYear()}
          {current ? <span className="font-normal text-fg-muted"> · so far</span> : null}
        </h2>
        <button type="button" aria-label="Next month" className={btn} disabled={current} onClick={() => go(shiftMonth(at, 1))}>
          <ChevronRight size={18} />
        </button>
      </div>

      <section aria-label="Left to spend" className="px-6 pt-5">
        <div className={sectionHead}>
          <Eyebrow>{current ? (v.left < 0 ? `OVER BUDGET · ${month}` : `LEFT TO SPEND · ${month}`) : `BUDGET · ${month}`}</Eyebrow>
          {current ? (
            <button type="button" onClick={() => setTotalOpen(true)} className={textBtn}>
              Adjust
            </button>
          ) : null}
        </div>
        {current ? (
          <div className={cn("tnum mt-1 text-[40px] leading-none font-semibold tracking-[-0.04em]", v.left < 0 && "text-danger", !hasBudget && "text-fg-subtle")}>{hasBudget ? balance(v.left) : "₱—"}</div>
        ) : (
          <div className={cn("tnum mt-1 text-[22px] leading-tight font-semibold tracking-[-0.02em]", v.left < 0 && "text-danger", !hasBudget && "text-fg-subtle")}>
            {hasBudget ? `Ended ${peso(Math.abs(v.left))} ${v.left < 0 ? "over" : "under"} budget` : "No budget set"}
          </div>
        )}
        {hasBudget ? (
          <>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <span className="tnum text-[14.5px]">
                <span className={cn("font-semibold", v.left < 0 ? "text-danger" : "text-fg")}>{peso(v.spent)}</span>
                <span className="text-fg-muted"> of {peso(v.budget)}</span>
              </span>
              {current ? (
                <span className={cn("tnum text-[13px]", v.left < 0 || overPace ? "font-medium text-danger" : "text-fg-muted")}>
                  {v.left < 0 ? `${peso(-v.left)} over budget` : overPace ? "Spending over pace" : `${v.daysLeft} day${v.daysLeft === 1 ? "" : "s"} left`}
                </span>
              ) : null}
            </div>
            <div className="mt-2.5">
              <Bar fraction={v.budget > 0 ? v.spent / v.budget : 0} pace={current ? v.pace : null} danger={v.left < 0 || overPace} label={`${peso(v.spent)} of ${peso(v.budget)} spent${current ? `, ${Math.round(v.pace * 100)}% of the month gone` : ""}`} />
            </div>
            {v.proratedFrom ? <p className="tnum mt-2 text-[12px] text-fg-muted">First month: {peso(v.fullBudget)} prorated.</p> : null}
          </>
        ) : (
          <p className="mt-3 text-[14px] text-fg-muted">{current ? "Set a monthly budget to see what’s left." : "Nothing was budgeted this month."}</p>
        )}
        {current && tb.hasBudget ? (
          <button type="button" onClick={() => setMathOpen(true)} aria-label={`${balance(tb.left)} ${tb.left < 0 ? "over today" : "left today"}. Show the math`} className="mt-1 flex min-h-11 flex-wrap items-baseline gap-x-2 text-left active:opacity-60">
            <span className={cn("tnum text-[18px] font-semibold tracking-[-0.01em]", tb.left < 0 ? "text-danger" : "text-fg")}>{balance(tb.left)}</span>
            <span className="text-[14px] text-fg-subtle">{tb.left < 0 ? "over today" : "left today"}</span>
            <span className="text-[13px] text-fg-muted underline underline-offset-4">Show the math</span>
          </button>
        ) : null}
      </section>

      <PlanCard plan={plan} color={color} onOpen={(c) => setSheet({ cat: c, kind: "expense" })} />

      <Card label="Budgeted categories">
        <Eyebrow>BUDGETED · {budgeted.length}</Eyebrow>
        {budgeted.length === 0 ? (
          <p className="pt-2 pb-1 text-[14px] text-fg-muted">No category budgets yet. Pick one below and give it a share of the month.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {budgeted.map((r) => (
              <CategoryRow key={r.category} r={r} color={color(r.category)} pct={state.profile.categoryBudgetPct?.[r.category]} pace={current ? pace : null} onOpen={() => setSheet({ cat: r.category, kind: "expense" })} />
            ))}
          </ul>
        )}
      </Card>

      {unbudgeted.length ? (
        <Card label="Categories with no budget">
          <Eyebrow>NO BUDGET YET · {unbudgeted.length}</Eyebrow>
          <ul className="mt-1 divide-y divide-line">
            {unbudgeted.map((r) => (
              <li key={r.category}>
                <button
                  type="button"
                  onClick={() => setSheet({ cat: r.category, kind: "expense" })}
                  aria-label={`${r.category}: ${peso(r.spent)} spent, no budget. Set budget`}
                  className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left active:opacity-60"
                >
                  <span className="min-w-0 truncate text-[14.5px]">{r.category}</span>
                  <span className="flex flex-none items-baseline gap-3">
                    <span className="tnum text-[13px] text-fg-muted">{r.spent > 0 ? `${peso(r.spent)} spent` : "—"}</span>
                    <span className="text-[13px] font-medium underline underline-offset-4">Set budget</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card label="Income categories">
        <Eyebrow>INCOME CATEGORIES</Eyebrow>
        {incomeCats.length === 0 ? (
          <p className="py-3 text-[14px] text-fg-muted">No income categories. Add one with New category.</p>
        ) : (
          <ul className="divide-y divide-line">
            {incomeCats.map((c) => {
              const got = Math.round(received.get(c) ?? 0);
              return (
                <li key={c}>
                  <button type="button" aria-label={`${c}: ${got > 0 ? `${peso(got)} received` : "none this month"}`} onClick={() => setSheet({ cat: c, kind: "income" })} className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left active:opacity-60">
                    <span className="text-[14.5px]">{c}</span>
                    <span className={cn("tnum text-[13px]", got > 0 ? "font-semibold text-success" : "text-fg-subtle")}>{got > 0 ? `${peso(got)} received` : "None this month"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* the one action on this tab: fixed right above the tab bar, where the floating + would be; Screen tabbed leaves room for it */}
      <div className="fixed inset-x-0 bottom-[calc(66px+env(safe-area-inset-bottom))] z-20 mx-auto w-full max-w-[430px] bg-bg/95 px-6 pt-3 pb-3 backdrop-blur-sm">
        <Cta onClick={() => setNewOpen(true)}>+ New category</Cta>
      </div>

      {sheet ? <CategorySheet key={`${sheet.kind}-${sheet.cat}`} cat={sheet.cat} kind={sheet.kind} at={at} onClose={() => setSheet(null)} /> : null}
      <NewCategorySheet open={newOpen} onClose={() => setNewOpen(false)} />
      <TotalSheet
        open={totalOpen}
        value={v.fullBudget}
        catTotal={alloc.allocated}
        onClose={() => setTotalOpen(false)}
        onSave={(n) => {
          dispatch({ type: "update-profile", patch: { monthlyBudget: n } });
          setTotalOpen(false);
        }}
      />
      {current ? <MathSheet open={mathOpen} onOpenChange={setMathOpen} v={v} month={inRange(state.entries, mf, mt)} today={now} /> : null}
    </Screen>
  );
}

function CategoryRow({ r, color, pct, pace, onOpen }: { r: BudgetRow; color: string; pct?: number; pace: number | null; onOpen: () => void }) {
  const over = r.status === "over";
  const right = r.status === "none" ? "Set budget" : over ? `${peso(r.spent - r.budget)} over` : `${peso(r.left)} left`;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${r.category}: ${peso(r.spent)} spent, ${r.status === "none" ? "no budget" : `${peso(r.budget)} budget, ${right}`}`}
        className="block w-full py-3.5 text-left active:opacity-60"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="size-2.5 flex-none rounded-full" style={{ background: color }} />
            <span className="truncate text-[14.5px] font-medium">{r.category}</span>
            <span className="flex-none rounded-sm border border-line px-1.5 py-px font-mono text-[10px] tracking-[0.04em] text-fg-subtle uppercase">{pct ? `${pct}%` : "Fixed"}</span>
          </span>
          <span className={cn("tnum flex-none text-[13px]", over ? "font-semibold text-danger" : r.status === "none" ? "text-fg-muted underline underline-offset-4" : "font-semibold text-fg")}>{right}</span>
        </div>
        <div className="tnum mt-1 text-[12.5px] text-fg-muted">
          <span className={cn(over && "text-danger")}>{peso(r.spent)}</span> spent of {peso(r.budget)}
        </div>
        {r.status !== "none" ? (
          <div className="mt-2.5">
            <Bar fraction={r.fraction} pace={r.paced ? pace : null} danger={over || r.status === "ahead"} label={`${r.category} ${Math.round(r.fraction * 100)}% of budget used`} />
          </div>
        ) : null}
      </button>
    </li>
  );
}

/** Entries that count toward a category in a month (a split receipt counts per part). */
function entriesIn(entries: Entry[], cat: Category, kind: "expense" | "income", at: Date) {
  const [from, to] = monthBounds(at);
  return inRange(entries, from, to)
    .filter((e) => (kind === "expense" ? isSpend(e) && spendParts(e).some((p) => p.category === cat) : isIncome(e) && e.category === cat))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Every entry anywhere that mentions the category: what a delete has to move. */
const touching = (e: Entry, cat: Category) => e.category === cat || !!e.split?.some((s) => s.category === cat) || !!e.receipt?.items.some((i) => i.category === cat);

function CategorySheet({ cat, kind, at, onClose }: { cat: Category; kind: "expense" | "income"; at: Date; onClose: () => void }) {
  const { state, dispatch } = useLedger();
  const [open, setOpen] = React.useState(true);
  const [mode, setMode] = React.useState<"main" | "rename" | "delete">("main");
  const current = state.profile.categoryBudgets[cat] ?? 0;
  const currentPct = state.profile.categoryBudgetPct?.[cat];
  const [budget, setBudget] = React.useState<BudgetDraft>(() => (currentPct ? { kind: "pct", text: String(currentPct) } : { kind: "amount", text: current > 0 ? String(current) : "" }));
  const [name, setName] = React.useState(cat);
  const [moveTo, setMoveTo] = React.useState(() => (kind === "expense" ? "Other" : (incomeCategories(state).find((c) => c !== cat) ?? "")));
  const system = SYSTEM_CATEGORIES.includes(cat);
  const defs = userCategories(state);
  const hist = categoryHistory(state.entries, cat, at);
  const list = entriesIn(state.entries, cat, kind, at);
  const count = state.entries.filter((e) => touching(e, cat)).length;
  const close = () => {
    setOpen(false);
    onClose();
  };
  const setting = draftSetting(budget);
  const unchanged = setting.kind === "pct" ? setting.value === (currentPct ?? 0) : !currentPct && setting.value === current;
  const saveBudget = () => {
    if (setting.value < 0) return;
    dispatch({ type: "update-profile", patch: categoryBudgetPatch(state.profile, cat, setting) });
    close();
  };
  const nameError = name.trim() === cat ? null : categoryNameError(name, defs, cat);
  // entries move to a category of the same kind; spending can always fall back to "Other"
  const moveOptions = (kind === "expense" ? spendCategories(state) : incomeCategories(state))
    .filter((c) => c !== cat)
    .filter((c, i, a) => a.indexOf(c) === i)
    .map((c) => ({ value: c, label: c }));

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()} title={mode === "rename" ? `Rename ${cat}` : mode === "delete" ? `Delete ${cat}` : cat}>
      {mode === "main" ? (
        <div className="mt-5 flex flex-col gap-5">
          {kind === "expense" ? (
            <div>
              <BudgetField draft={budget} onChange={setBudget} base={budgetBase(state)} onEnter={saveBudget} />
              <div className="mt-4 flex flex-col gap-2.5">
                <Cta onClick={saveBudget} disabled={unchanged || setting.value < 0}>
                  {setting.value === 0 && (current > 0 || !!currentPct) ? "Remove budget" : "Save budget"}
                </Cta>
              </div>
            </div>
          ) : null}
          <StatGrid
            items={[
              { label: kind === "expense" ? "This month" : "Received", value: peso(hist.thisMonth) },
              { label: "Last month", value: peso(hist.lastMonth) },
              { label: "3-mo avg", value: peso(hist.avg3) },
            ]}
          />
          <div>
            <Eyebrow className="mb-1">THIS MONTH · {list.length} {list.length === 1 ? "ENTRY" : "ENTRIES"}</Eyebrow>
            {list.length === 0 ? (
              <p className="py-2 text-[14px] text-fg-muted">Nothing {kind === "expense" ? "spent" : "received"} in {monthName(at)}.</p>
            ) : (
              <ul className="flex flex-col gap-3.5 py-2">
                {list.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <EntryRow entry={e} account={state.accounts.find((a) => a.id === e.accountId)} onClick={() => navigate(`/activity/${e.id}`)} />
                  </li>
                ))}
                {list.length > 8 ? (
                  <li>
                    <button type="button" onClick={() => navigate(`/activity?cat=${encodeURIComponent(cat)}`)} className="min-h-11 text-[13px] text-fg-muted underline underline-offset-4 active:opacity-60">
                      {list.length - 8} more in Money
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
          {system ? null : (
            <div className="flex gap-2.5">
              <Cta variant="secondary" onClick={() => setMode("rename")}>
                Rename
              </Cta>
              <Cta variant="secondary" onClick={() => setMode("delete")}>
                Delete
              </Cta>
            </div>
          )}
        </div>
      ) : null}

      {mode === "rename" ? (
        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameError || !name.trim() || name.trim() === cat) return;
            dispatch({ type: "rename-category", from: cat, to: name.trim() });
            close();
          }}
        >
          <label className="block">
            <Eyebrow className="mb-2">NAME</Eyebrow>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus enterKeyHint="done" aria-invalid={!!nameError} className={inputClass} />
            {nameError ? (
              <p role="alert" className="mt-1.5 text-[12.5px] text-danger">
                {nameError}
              </p>
            ) : null}
          </label>
          <p className="text-[13px] leading-[1.45] text-fg-muted">Its entries, receipt items and budget move to the new name.</p>
          <Cta type="submit" disabled={!!nameError || !name.trim() || name.trim() === cat}>
            Save name
          </Cta>
          <Cta type="button" variant="secondary" onClick={() => setMode("main")}>
            Cancel
          </Cta>
        </form>
      ) : null}

      {mode === "delete" ? (
        <div className="mt-5 flex flex-col gap-4">
          <p className="text-[13.5px] leading-[1.45]">
            {count > 0 ? (
              <>
                <span className="tnum font-semibold">{count}</span> {count === 1 ? "entry uses" : "entries use"} {cat}. They move to the category you pick.
              </>
            ) : (
              <>No entries use {cat}.</>
            )}
            {kind === "expense" && current > 0 ? " Its budget is removed." : ""}
          </p>
          {moveOptions.length ? (
            count > 0 ? <PickField label="Move its entries to" value={moveTo} onChange={setMoveTo} options={moveOptions} /> : null
          ) : (
            <p className="text-[13px] text-fg-muted">Add another income category first: its entries need somewhere to go.</p>
          )}
          <div className="rounded-lg border border-danger/50 p-3.5">
            <div className="flex gap-2.5">
              <ActionButton variant="secondary" className="min-h-11 flex-1" autoFocus onClick={() => setMode("main")}>
                Cancel
              </ActionButton>
              <ActionButton
                className="min-h-11 flex-1 !bg-danger"
                disabled={!moveTo}
                onClick={() => {
                  dispatch({ type: "delete-category", name: cat, moveTo });
                  close();
                }}
              >
                Delete category
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

function NewCategorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useLedger();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<"Spending" | "Income">("Spending");
  const [budget, setBudget] = React.useState<BudgetDraft>({ kind: "amount", text: "" });
  const [touched, setTouched] = React.useState(false);
  const error = categoryNameError(name, userCategories(state));
  const reset = () => {
    setName("");
    setBudget({ kind: "amount", text: "" });
    setKind("Spending");
    setTouched(false);
  };
  const close = () => {
    reset();
    onClose();
  };
  const create = () => {
    setTouched(true);
    if (error) return;
    const n = name.trim();
    dispatch({ type: "add-category", def: { name: n, kind: kind === "Spending" ? "expense" : "income" } });
    const b = draftSetting(budget);
    if (kind === "Spending" && b.value > 0) dispatch({ type: "update-profile", patch: categoryBudgetPatch(state.profile, n, b) });
    close();
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()} title="New category">
      <form
        className="mt-5 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="block">
          <Eyebrow className="mb-2">NAME</Eyebrow>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus enterKeyHint="done" placeholder="Pets" aria-invalid={touched && !!error} className={inputClass} />
          {touched && error ? (
            <p role="alert" className="mt-1.5 text-[12.5px] text-danger">
              {error}
            </p>
          ) : null}
        </label>
        <div>
          <Eyebrow className="mb-2">KIND</Eyebrow>
          <Segmented value={kind} options={["Spending", "Income"]} onChange={setKind} />
        </div>
        {kind === "Spending" ? (
          <div>
            <Eyebrow className="mb-2">MONTHLY BUDGET · OPTIONAL</Eyebrow>
            <BudgetField draft={budget} onChange={setBudget} base={budgetBase(state)} onEnter={create} />
          </div>
        ) : null}
        <Cta type="submit" disabled={!name.trim()}>
          Add category
        </Cta>
      </form>
    </Sheet>
  );
}

/* ---------- a budget in pesos or as a share of the monthly budget ------------ */

type BudgetDraft = { kind: "amount" | "pct"; text: string };

/** The draft as a setting; an unreadable % reads as -1 so Save stays off. */
function draftSetting(d: BudgetDraft): BudgetSetting {
  if (d.kind === "amount") return { kind: "amount", value: Number(d.text) || 0 };
  if (!d.text.trim()) return { kind: "pct", value: 0 };
  return { kind: "pct", value: parsePct(d.text) ?? -1 };
}

const UNITS = ["₱ Amount", "% of budget"] as const;

/**
 * Budget entry with a ₱ / % switch. Switching converts what's typed, so 12,600 of a 63,000
 * budget becomes 20% and back. A % stays a % when the monthly budget changes.
 */
function BudgetField({ draft, onChange, base, onEnter }: { draft: BudgetDraft; onChange: (d: BudgetDraft) => void; base: number; onEnter: () => void }) {
  const setting = draftSetting(draft);
  const switchTo = (u: (typeof UNITS)[number]) => {
    const kind = u === UNITS[0] ? "amount" : "pct";
    if (kind === draft.kind) return;
    if (kind === "pct") {
      const pct = base > 0 && setting.value > 0 ? Math.min(100, Math.round((setting.value / base) * 1000) / 10) : 0;
      onChange({ kind, text: pct ? String(pct) : "" });
    } else onChange({ kind, text: setting.value > 0 ? String(pctOf(setting.value, base)) : "" });
  };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Eyebrow>MONTHLY BUDGET</Eyebrow>
      </div>
      <Segmented value={draft.kind === "amount" ? UNITS[0] : UNITS[1]} options={[...UNITS]} onChange={switchTo} />
      <div className="mt-4">
        {draft.kind === "amount" ? (
          <AmountInput value={draft.text} onChange={(v) => onChange({ kind: "amount", text: amountDigits(v).digits })} onEnter={onEnter} sign="" autoFocus={false} />
        ) : (
          <label className="flex items-baseline gap-1.5 border-b border-line-strong pb-2 focus-within:border-accent">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              aria-label="Share of the monthly budget, in percent"
              aria-invalid={setting.value < 0}
              placeholder="0"
              value={draft.text}
              onChange={(e) => onChange({ kind: "pct", text: e.target.value.replace(/[^\d.]/g, "").slice(0, 5) })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onEnter();
                }
              }}
              style={{ width: `${Math.max(1, draft.text.length) + 0.3}ch` }}
              className="tnum min-w-0 bg-transparent text-[40px] leading-none font-semibold tracking-[-0.02em] outline-none placeholder:text-mute"
            />
            <span aria-hidden className={cn("text-[30px] font-semibold", draft.text ? "text-fg" : "text-mute")}>
              %
            </span>
          </label>
        )}
        <p role="status" className={cn("tnum mt-1.5 text-[12.5px]", setting.value < 0 ? "text-danger" : "text-fg-muted")}>
          {setting.value < 0
            ? "Up to 100%, one decimal at most."
            : base <= 0
              ? "Set a monthly budget first; a % is a share of it."
              : draft.kind === "pct"
                ? setting.value > 0
                  ? `${peso(pctOf(setting.value, base))} of your ${peso(base)} monthly budget. It changes when the budget does.`
                  : `A share of your ${peso(base)} monthly budget.`
                : setting.value > 0
                  ? `${Math.round((setting.value / base) * 1000) / 10}% of your ${peso(base)} monthly budget`
                  : `Your monthly budget is ${peso(base)}.`}
        </p>
      </div>
    </div>
  );
}

/** A bordered card, like Analytics: each block of the plan reads as one answer. */
function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="mx-6 mt-4 rounded-xl border border-line px-4 pt-4 pb-2">
      {children}
    </section>
  );
}

/**
 * The monthly budget as one 100% bar: a segment per budgeted category (largest first, its color
 * from the shared mapping) and what's unallocated, then the same parts as a legend you can tap.
 */
function PlanCard({ plan, color, onOpen }: { plan: { parts: PlanPart[]; total: number; over: number }; color: (c: string) => string; onOpen: (c: Category) => void }) {
  const allocated = plan.parts.filter((p) => p.category !== "Unallocated");
  const allocPct = Math.round(allocated.reduce((n, p) => n + p.pct, 0));
  if (plan.total <= 0 && !allocated.length) return null;
  const fill = (p: PlanPart) => (p.category === "Unallocated" ? "var(--color-fill)" : color(p.category) === VIZ_OTHER ? "var(--color-viz-other)" : color(p.category));
  return (
    <Card label="Monthly plan">
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>MONTHLY PLAN</Eyebrow>
        <span className="tnum text-[13px] font-semibold">{peso(plan.total)}</span>
      </div>
      <div className="mt-3 flex h-4 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${allocPct}% of the monthly budget is allocated to categories`}>
        {plan.parts.map((p) => (
          <span key={p.category} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${p.pct}%`, background: fill(p) }} />
        ))}
      </div>
      <p role="status" className={cn("tnum mt-2 text-[12.5px]", plan.over > 0 ? "text-danger" : "text-fg-muted")}>
        {plan.over > 0 ? `Over-planned by ${peso(plan.over)}: category budgets add up to more than the month.` : `${allocPct}% planned · ${100 - allocPct}% unallocated`}
      </p>
      <ul className="mt-2 divide-y divide-line">
        {plan.parts.map((p) => {
          const un = p.category === "Unallocated";
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className={cn("size-2.5 flex-none rounded-full", un && "border border-line-strong")} style={{ background: fill(p) }} />
                <span className={cn("truncate text-[14px]", un && "text-fg-muted")}>{p.category}</span>
                {un ? null : <span className="flex-none font-mono text-[10px] tracking-[0.04em] text-fg-subtle uppercase">{p.byPct ? "% of budget" : "fixed"}</span>}
              </span>
              <span className="tnum flex flex-none items-baseline gap-3 text-[13px]">
                <span className="w-[42px] text-right text-fg-muted">{Math.round(p.pct)}%</span>
                <span className="w-[76px] text-right font-semibold">{peso(p.amount)}</span>
              </span>
            </>
          );
          return (
            <li key={p.category}>
              {un ? (
                <div className="flex min-h-11 items-center justify-between gap-3">{body}</div>
              ) : (
                <button type="button" onClick={() => onOpen(p.category)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left active:opacity-60">
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
