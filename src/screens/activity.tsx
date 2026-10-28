import * as React from "react";
import { Sparkle } from "@/components/ledger/icons";
import {
  ActionButton,
  AiCard,
  AiMark,
  Amount,
  BackBar,
  CategoryChip,
  Cta,
  Eyebrow,
  EntryRow,
  PageTitle,
  Pill,
  ProviderMark,
  Screen,
  Sheet,
} from "@/components/ledger/primitives";
import { UndoToast, type UndoNote } from "@/components/ledger/undo-toast";
import { cn } from "@/lib/cn";
import { inputDateTime, monthName, parseWholePesos, peso, signed, stamp, wholePesos } from "@/lib/format";
import { canRefund, categoriesFor, fixedCategory } from "@/lib/entry-rules";
import { SPEND_CATEGORIES, suggestCategory } from "@/lib/providers";
import { splitOf } from "@/lib/receipt";
import { back, navigate } from "@/lib/router";
import { accountLabel, byCategory, canSpendFrom, inRange, isSpend, monthBounds } from "@/lib/selectors";
import { needsReview } from "@/screens/ledger-list";
import { newId, useLedger } from "@/lib/store";
import { cloud } from "@/lib/supabase";
import { loadGaps, type Gap } from "@/lib/cloud/api";
import { useCloud } from "@/lib/cloud/provider";
import type { Account, Category, Entry } from "@/lib/types";

const FIELD =
  "h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent";
/** Text buttons in a bar: at least 44×44 to hit. */
const EDIT_HIT = "flex h-11 min-w-11 items-center justify-center px-1 text-[15px] active:opacity-60";

/* ====================================================================== */
/*  Entry detail                                                           */
/* ====================================================================== */

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export function ActivityDetail({ id }: { id: string }) {
  const { state, dispatch } = useLedger();
  const entry = state.entries.find((e) => e.id === id);
  const [editing, setEditing] = React.useState(false);
  const [photo, setPhoto] = React.useState(false);
  const [splitting, setSplitting] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  if (!entry) {
    return (
      <Screen>
        <BackBar label="Money" onBack={() => back("/money")} />
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
          <h2 className="text-[19px] leading-[1.25] font-semibold text-balance">Entry not found</h2>
          <p className="mt-2.5 text-[14px] text-fg-muted">It may have been deleted.</p>
          <Cta className="mt-7 max-w-[240px]" onClick={() => navigate("/money", { replace: true })}>
            Back to Money
          </Cta>
        </div>
      </Screen>
    );
  }

  const account = entry.accountId ? state.accounts.find((a) => a.id === entry.accountId) : undefined;
  const entryDate = new Date(entry.date);
  const [mf, mt] = monthBounds(entryDate);
  const monthEntries = inRange(state.entries, mf, mt);

  const other = entry.linkId ? state.entries.find((e) => e.id !== entry.id && e.linkId === entry.linkId) : undefined;
  const nameOf = (e: Entry) => state.accounts.find((a) => a.id === e.accountId)?.name ?? "no account";
  const [outLeg, inLeg] = other ? (entry.amount < 0 ? [entry, other] : [other, entry]) : [];
  const move = entry.category === "Transfer" || entry.category === "Investments";

  // budget status for this entry's category in its month
  let budgetLine = "No budget for this";
  if (entry.category === "Adjustment") budgetLine = "Not spending or income";
  else if (move) budgetLine = entry.category === "Investments" ? "Investing · not spending" : "Transfer · not spending";
  else if (entry.category) {
    const budget = state.profile.categoryBudgets[entry.category];
    if (budget) {
      const spent = byCategory(monthEntries).find(([c]) => c === entry.category)?.[1] ?? 0;
      const diff = spent - budget;
      budgetLine = `${entry.category} · ${peso(Math.abs(diff))} ${diff > 0 ? "over" : "left"}`;
    } else if (entry.amount > 0) budgetLine = "Income";
  }

  // AI note
  const key = entry.desc.trim().toLowerCase();
  const sameYear = state.entries.filter((e) => e.desc.trim().toLowerCase() === key && new Date(e.date).getFullYear() === entryDate.getFullYear());
  const rank = sameYear.filter((e) => e.date <= entry.date).length;
  let note: React.ReactNode;
  if (entry.refunded) {
    note = (
      <>
        Refunded. <AiMark>{peso(entry.amount)}</AiMark> is out of your {monthName(entryDate)} spending{account ? ` and back in ${account.name}` : ""}.
      </>
    );
  } else if (entry.category === "Adjustment") {
    note = (
      <>
        An adjustment you confirmed so {account?.name ?? "this account"} matches the balance you reported. It isn’t <AiMark>spending or income</AiMark>.
      </>
    );
  } else if (outLeg && inLeg) {
    note = <MoveNote out={outLeg} into={inLeg} accounts={state.accounts} />;
  } else if (move) {
    note = (
      <>
        {entry.amount < 0 ? "Sent" : "Received"} <AiMark>{peso(entry.amount)}</AiMark>{entry.amount < 0 ? ` from ${account?.name ?? "your account"}` : ` into ${account?.name ?? "your account"}`}. Not counted as spending or income.
      </>
    );
  } else if (sameYear.length >= 5 && isSpend(entry)) {
    note = (
      <>
        Your <AiMark>{ordinal(rank)} {entry.desc}</AiMark> this year, {peso(sameYear.reduce((n, e) => n + Math.abs(e.amount), 0))} so far.
        This one is <AiMark>a habit, not a decision</AiMark>.
      </>
    );
  } else if (entry.amount > 0) {
    note =
      account?.type === "credit" ? (
        <>
          Money in. <AiMark>{peso(entry.amount)}</AiMark> off what you owe on {account.name}.
        </>
      ) : (
        <>
          Money in. <AiMark>{peso(entry.amount)}</AiMark> added to {account?.name ?? "your account"}.
        </>
      );
  } else if (entry.category) {
    const spent = byCategory(monthEntries).find(([c]) => c === entry.category)?.[1] ?? 0;
    const part = entry.split?.find((x) => x.category === entry.category)?.amount ?? Math.abs(entry.amount);
    const share = spent > 0 ? Math.round((part / spent) * 100) : 0;
    note = (
      <>
        This is <AiMark>{share}%</AiMark> of what you spent on {entry.category.toLowerCase()} in {monthName(entryDate)}.
      </>
    );
  } else {
    note = (
      <>
        This one has <AiMark>no category yet</AiMark>. File it so your insights stay accurate.
      </>
    );
  }

  const rows: [string, string][] = [
    ["Date", stamp(entry.date)],
    ...(entry.raw ? ([["Entered as", `“${entry.raw}”`]] as [string, string][]) : []),
    ...(entry.method ? ([["Method", entry.method]] as [string, string][]) : []),
    ["Budget", budgetLine],
    // D-0012: "Synced" only after the server acknowledged it
    ...(cloud ? ([["Saved", entry.queued ? "Saved on this phone" : "Synced"]] as [string, string][]) : []),
    ...(entry.reviewQuestion && entry.status === "review" ? ([["M8 asks", entry.reviewQuestion]] as [string, string][]) : []),
  ];

  return (
    <Screen>
      <BackBar
        label="Back"
        onBack={() => back("/money")}
        right={
          <button type="button" onClick={() => setEditing(true)} className={EDIT_HIT}>
            Edit
          </button>
        }
      />
      <div className="flex flex-col items-center px-6 pt-6 text-center">
        <ProviderMark provider={account?.provider ?? null} size={64} radius={16} />
        <div className={cn("mt-4 text-[17px] font-medium", entry.refunded && "line-through opacity-60")}>{entry.desc}</div>
        <Amount value={entry.amount} className={cn("mt-1.5 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]", entry.refunded && "opacity-60")} />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className={cn("font-mono text-[10.5px] font-medium tracking-[0.05em]", account ? "text-fg-subtle" : "text-gold-ink")}>{accountLabel(account)}</span>
          {entry.category ? <CategoryChip>{entry.category}</CategoryChip> : <CategoryChip tone="warn">Needs category</CategoryChip>}
          {entry.refunded ? <CategoryChip>Refunded</CategoryChip> : null}
        </div>
      </div>

      <dl className="mt-9 space-y-4 px-6">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-6">
            <dt className="text-[13.5px] text-fg-subtle">{k}</dt>
            <dd className="min-w-0 text-right text-[14px] break-words">{v}</dd>
          </div>
        ))}
      </dl>

      {/* r5: a receipt keeps its split and its photo */}
      {entry.split?.length ? (
        <div className="mt-7 px-6">
          {entry.split.map((p) => (
            <div key={p.category} className="border-b border-surface py-3.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-medium">{p.category}</span>
                <span className="tnum text-[14px] font-semibold">{peso(p.amount)}</span>
              </div>
              <div className="mt-1 text-[12px] leading-[1.5] text-pretty text-fg-subtle">
                {p.items.length} item{p.items.length === 1 ? "" : "s"} · {p.items.join(", ").toLowerCase()}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {entry.receipt ? (
        <button
          type="button"
          onClick={() => setPhoto(true)}
          disabled={!entry.receipt.image}
          className="mx-6 mt-5 flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left active:bg-surface"
        >
          {entry.receipt.image ? (
            <img src={entry.receipt.image} alt="" className="h-[46px] w-9 flex-none rounded-[4px] border border-line object-cover" />
          ) : (
            <span className="h-[46px] w-9 flex-none rounded-[4px] border border-line bg-surface" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">Receipt photo</span>
            <span className="mt-[3px] block font-mono text-[9.5px] font-medium text-fg-subtle">{entry.receipt.image ? "SAVED · READ BY M8" : "NOT SAVED"}</span>
          </span>
          {entry.receipt.image ? <span className="text-[13px] text-fg-subtle">View</span> : null}
        </button>
      ) : null}

      <AiCard label="M8's note" className="mx-6 mt-8">
        {note}
      </AiCard>

      <div className="mt-auto flex flex-wrap gap-3 px-6 pt-8 pb-[max(32px,env(safe-area-inset-bottom))]">
        {confirming ? (
          <>
            <p className="w-full text-[13.5px] leading-[1.5] text-fg-muted">
              {outLeg && inLeg
                ? `Delete this transfer? Both legs go: −${peso(outLeg.amount)} from ${nameOf(outLeg)} and +${peso(inLeg.amount)} to ${nameOf(inLeg)}. You can't undo this.`
                : `Delete ‘${entry.desc}’ (${peso(Math.abs(entry.amount))})? You can't undo this.`}
            </p>
            <ActionButton autoFocus variant="secondary" className="min-h-12 flex-1" onClick={() => setConfirming(false)}>
              Cancel
            </ActionButton>
            <ActionButton
              className="min-h-12 flex-1 !bg-danger"
              onClick={() => {
                dispatch({ type: "delete-entry", id: entry.id });
                back("/money");
              }}
            >
              {other ? "Delete transfer" : "Delete entry"}
            </ActionButton>
          </>
        ) : (
          <>
            {entry.receipt?.items.length ? (
              <ActionButton variant="secondary" className="min-h-12 flex-1" onClick={() => setSplitting(true)}>
                Edit split
              </ActionButton>
            ) : (
              !canRefund(entry) && !entry.refunded ? null : (
                <div className="min-w-0 flex-1">
                  <ActionButton variant="secondary" className="min-h-12 w-full" onClick={() => dispatch({ type: "update-entry", id: entry.id, patch: { refunded: !entry.refunded } })}>
                    {entry.refunded ? "Unmark refunded" : "Mark as refunded"}
                  </ActionButton>
                  {entry.refunded ? null : (
                    <p className="mt-2 text-[12px] leading-[1.4] text-fg-subtle">
                      {account ? `Puts ${peso(entry.amount)} back in ${account.name}.` : "Removes " + peso(entry.amount) + " from this month's spending."}
                    </p>
                  )}
                </div>
              )
            )}
            <ActionButton variant="secondary" className="min-h-12 flex-1 !text-danger" onClick={() => setConfirming(true)}>
              Delete
            </ActionButton>
          </>
        )}
      </div>

      <EditEntrySheet open={editing} onOpenChange={setEditing} entry={entry} other={other} accounts={state.accounts} />
      {entry.receipt?.image ? (
        <Sheet open={photo} onOpenChange={setPhoto} title="Receipt">
          <img src={entry.receipt.image} alt={`Receipt from ${entry.desc}`} className="mt-4 w-full rounded-md border border-line" />
        </Sheet>
      ) : null}
      {entry.receipt?.items.length ? <SplitSheet open={splitting} onOpenChange={setSplitting} entry={entry} /> : null}
    </Screen>
  );
}

/** A move told as one sentence, in owed-language when a card is involved (D-0007, D-0010). */
function MoveNote({ out, into, accounts }: { out: Entry; into: Entry; accounts: Account[] }) {
  const from = accounts.find((a) => a.id === out.accountId);
  const to = accounts.find((a) => a.id === into.accountId);
  const fromName = from?.name ?? "an account";
  const toName = to?.name ?? "an account";
  const amount = <AiMark>{peso(into.amount)}</AiMark>;
  if (to?.type === "credit")
    return (
      <>
        Paid {amount} off {toName} from {fromName}. Not spending: the card’s purchases already counted.
      </>
    );
  if (into.category === "Investments")
    return (
      <>
        Invested {amount} from {fromName} into {toName}. Not spending.
      </>
    );
  return (
    <>
      Moved {amount} from {fromName} to {toName}
      {from?.type === "credit" ? `, so you owe ${peso(into.amount)} more on ${fromName}` : ""}. Not spending.
    </>
  );
}

type Direction = "out" | "in";

function EditEntrySheet({
  open,
  onOpenChange,
  entry,
  other,
  accounts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entry: Entry;
  /** the other leg of a move: amount and date stay in step with this one */
  other?: Entry;
  accounts: Account[];
}) {
  const { dispatch } = useLedger();
  const shown = String(wholePesos(entry.amount));
  const [desc, setDesc] = React.useState(entry.desc);
  const [amount, setAmount] = React.useState(shown);
  const [dir, setDir] = React.useState<Direction>(entry.amount > 0 ? "in" : "out");
  const [cat, setCat] = React.useState<Category | null>(entry.category);
  const [acct, setAcct] = React.useState<string | null>(entry.accountId);
  const [when, setWhen] = React.useState(inputDateTime(new Date(entry.date)));
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    if (open) {
      setDesc(entry.desc);
      setAmount(String(wholePesos(entry.amount)));
      setDir(entry.amount > 0 ? "in" : "out");
      setCat(entry.category);
      setAcct(entry.accountId);
      setWhen(inputDateTime(new Date(entry.date)));
      setNow(new Date());
    }
  }, [open, entry]);

  // a leg of a move or an Adjustment keeps its category and its sign
  const fixed = fixedCategory(entry);
  const sign: 1 | -1 = fixed ? (entry.amount >= 0 ? 1 : -1) : dir === "in" ? 1 : -1;
  const options = categoriesFor(sign, entry.category);

  // whole pesos only, like the keypad; untouched, the stored amount stays as it was
  const untouched = amount.trim() === shown;
  const value = untouched ? Math.abs(entry.amount) : parseWholePesos(amount);
  const date = when ? new Date(when) : null;
  const future = !!date && date.getTime() > now.getTime() + 60_000;
  const dateOk = !!date && !Number.isNaN(date.getTime()) && !future;
  const valid = desc.trim() !== "" && value != null && dateOk && (fixed || cat == null || options.includes(cat)) && !(other && acct != null && acct === other.accountId);
  const flips = valid && sign !== (entry.amount >= 0 ? 1 : -1);
  const acctName = accounts.find((a) => a.id === acct)?.name;

  const pickDir = (d: Direction) => {
    setDir(d);
    // income categories don't fit money out, and the other way round
    if (cat && !categoriesFor(d === "in" ? 1 : -1, entry.category).includes(cat)) setCat(null);
  };

  const save = () => {
    if (!valid || value == null || !date) return;
    const iso = untouchedDate(entry.date, when) ? entry.date : date.toISOString();
    const signedValue = sign * value;
    dispatch({ type: "update-entry", id: entry.id, patch: { desc: desc.trim(), amount: signedValue, category: fixed ? entry.category : cat, accountId: acct, date: iso } });
    // both legs of a move carry the same amount and moment, or the accounts drift apart
    if (other && (other.amount !== -signedValue || other.date !== iso)) dispatch({ type: "update-entry", id: other.id, patch: { amount: -signedValue, date: iso } });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Edit entry">
      <form
        className="space-y-5 pt-5 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="block">
          <Eyebrow className="mb-2">DESCRIPTION</Eyebrow>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} className={FIELD} enterKeyHint="next" />
        </label>
        {fixed ? null : (
          <div>
            <Eyebrow className="mb-2.5">MONEY</Eyebrow>
            <div className="flex gap-2">
              <Pill active={dir === "out"} className="min-h-10 flex-1 px-3.5 text-[12.5px]" onClick={() => pickDir("out")}>
                Out · spent
              </Pill>
              <Pill active={dir === "in"} className="min-h-10 flex-1 px-3.5 text-[12.5px]" onClick={() => pickDir("in")}>
                In · got
              </Pill>
            </div>
          </div>
        )}
        <label className="block">
          <Eyebrow className="mb-2">AMOUNT (₱)</Eyebrow>
          <div className="flex items-center gap-3">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              aria-invalid={value == null}
              className={cn(FIELD, "min-w-0 flex-1 font-mono", value == null && amount.trim() !== "" && "border-danger")}
            />
            {value != null ? <span className={cn("tnum flex-none text-[15px] font-semibold", sign > 0 ? "text-success" : "text-fg")}>{signed(sign * value)}</span> : null}
          </div>
          {value == null && amount.trim() !== "" ? (
            <p role="alert" className="mt-1.5 text-[12.5px] text-danger">
              Whole pesos only, up to ₱9,999,999.
            </p>
          ) : null}
          {other ? (
            <p className="mt-1.5 text-[12.5px] text-fg-subtle">
              The other leg changes with it.
            </p>
          ) : null}
        </label>
        <label className="block">
          <Eyebrow className="mb-2">DATE AND TIME</Eyebrow>
          <input
            type="datetime-local"
            value={when}
            max={inputDateTime(now)}
            onChange={(e) => setWhen(e.target.value)}
            aria-invalid={!dateOk}
            className={cn(FIELD, !dateOk && "border-danger")}
          />
          {future ? <p role="alert" className="mt-1.5 text-[12.5px] text-danger">That’s in the future. Pick a time up to now.</p> : null}
        </label>
        <div>
          <Eyebrow className="mb-2.5">CATEGORY</Eyebrow>
          {fixed ? (
            <p className="text-[14px] text-fg-muted">
              {entry.category === "Adjustment" ? "Adjustment · closes a reported-balance gap" : `${entry.category ?? "Transfer"} · linked to ${other ? accounts.find((a) => a.id === other.accountId)?.name ?? "another account" : "another entry"}`}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {options.map((c) => (
                <Pill key={c} active={cat === c} className="min-h-10 px-3.5 text-[12.5px]" onClick={() => setCat(c)}>
                  {c}
                </Pill>
              ))}
            </div>
          )}
          {!fixed ? <p className="mt-2 text-[12.5px] leading-[1.45] text-fg-subtle">Moving money between your own accounts? Use Transfer on the account, so both sides are logged.</p> : null}
        </div>
        <div>
          <Eyebrow className="mb-2.5">ACCOUNT</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {/* a leg of a move can't land in the other leg's account */}
            {accounts.filter((a) => !other || a.id !== other.accountId).map((a) => (
              <Pill key={a.id} active={acct === a.id} className="min-h-10 max-w-full px-3.5 text-start text-[12.5px] whitespace-normal" onClick={() => setAcct(a.id)}>
                {a.name}
              </Pill>
            ))}
          </div>
        </div>
        {flips && value != null ? (
          <p className="text-[13px] leading-[1.5] text-fg-muted" role="status">
            This becomes money {sign > 0 ? "in" : "out"}{acctName ? ` and moves ${acctName} by ${peso(value)}` : ` of ${peso(value)}`}.
          </p>
        ) : null}
        <Cta type="submit" disabled={!valid}>
          Save changes
        </Cta>
      </form>
    </Sheet>
  );
}

/** The datetime field still shows the stored moment (to the minute): keep its seconds. */
const untouchedDate = (iso: string, field: string) => inputDateTime(new Date(iso)) === field;

/* ====================================================================== */
/*  Review queue                                                           */
/* ====================================================================== */

const QUICK: Category[] = ["Food & drink", "Gifts", "Groceries", "Other"];

export function Review() {
  const { state, dispatch } = useLedger();
  const [leaving, setLeaving] = React.useState<Set<string>>(new Set());
  const [accepted, setAccepted] = React.useState<{ ids: string[]; note: UndoNote } | null>(null);
  const closeToast = React.useCallback(() => setAccepted(null), []);
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const queue = state.entries.filter(needsReview);
  const left = queue.filter((e) => !leaving.has(e.id)).length;
  const accountById = new Map(state.accounts.map((a) => [a.id, a]));
  const missingCat = queue.filter((e) => e.category == null && !leaving.has(e.id));

  const gaps = useGaps();

  const file = (e: Entry, patch: Partial<Entry>) => {
    const next = { ...e, ...patch };
    // cloud: filing the last missing field resolves the entry (the store sends status posted)
    const resolves = e.status === "review" && (e.category == null || e.accountId == null) && next.category != null && next.accountId != null;
    const done = !needsReview(resolves ? { ...next, status: "posted" } : next);
    if (!done) {
      dispatch({ type: "update-entry", id: e.id, patch });
      return;
    }
    setLeaving((s) => new Set(s).add(e.id));
    timers.current.push(
      window.setTimeout(() => {
        dispatch({ type: "update-entry", id: e.id, patch });
        setLeaving((s) => {
          const n = new Set(s);
          n.delete(e.id);
          return n;
        });
      }, 300),
    );
  };

  const acceptAll = () => {
    const ids: string[] = [];
    for (const e of queue) {
      if (e.category != null || leaving.has(e.id)) continue;
      ids.push(e.id);
      file(e, { category: suggestCategory(e.desc) ?? "Other" });
    }
    if (ids.length) setAccepted({ ids, note: { label: "Suggestions accepted", amount: `${ids.length} ${ids.length === 1 ? "entry" : "entries"}`, where: "Filed by M8’s suggestions" } });
  };
  // the entries go back to Review without a category, as they were
  const undoAccept = () => {
    if (!accepted) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setLeaving(new Set());
    for (const id of accepted.ids) dispatch({ type: "update-entry", id, patch: { category: null } });
  };
  const toast = <UndoToast note={accepted?.note ?? null} onClose={closeToast} onUndo={undoAccept} />;

  if (queue.length === 0 && gaps.list.length === 0) {
    return (
      <Screen>
        <BackBar label="Today" onBack={() => back("/today")} />
        <PageTitle>Review</PageTitle>
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
          <h2 className="text-[19px] leading-[1.25] font-semibold tracking-[-0.01em]">All filed.</h2>
          <p className="mt-2.5 max-w-[260px] text-[14px] leading-[1.5] text-fg-muted">Every entry has a category and an account.</p>
          <Cta className="mt-7 max-w-[240px]" onClick={() => navigate("/money")}>
            See your money
          </Cta>
        </div>
        {toast}
      </Screen>
    );
  }

  return (
    <Screen>
      <BackBar label="Today" onBack={() => back("/today")} />
      <PageTitle right={<span className="font-mono text-[11px] tracking-[0.06em] text-fg-subtle uppercase">{left + gaps.list.length} left</span>}>Review</PageTitle>
      <p className="px-6 pt-2.5 text-[13.5px] leading-[1.5] text-fg-muted">
        {cloud
          ? "These need you: a missing category or account, a question from M8, or a balance that doesn’t match. Everything else is filed."
          : "These entries are missing a category or an account. Everything else is filed."}
      </p>
      {gaps.list.length ? <GapList gaps={gaps.list} onAdjust={gaps.adjust} /> : null}
      {missingCat.length > 0 ? (
        <div className="px-6 pt-4">
          <ActionButton variant="secondary" className="min-h-11 w-full" onClick={acceptAll}>
            Accept suggestions
          </ActionButton>
          <p className="mt-2 text-[12.5px] text-fg-subtle">Entries without a suggestion go to Other.</p>
        </div>
      ) : null}

      <div className="px-6 pt-7">
        {queue.map((e) => {
          const suggestion = suggestCategory(e.desc);
          const options = suggestion ? [suggestion, ...QUICK.filter((c) => c !== suggestion)].slice(0, 4) : QUICK;
          const gone = leaving.has(e.id);
          return (
            <div key={e.id} className={cn("grid transition-opacity duration-300 ease-out motion-safe:transition-[grid-template-rows,opacity]", gone ? "opacity-0 motion-safe:grid-rows-[0fr]" : "grid-rows-[1fr] opacity-100")}>
              <div className="overflow-hidden">
                <div className="pb-8">
                  <EntryRow entry={e} account={e.accountId ? accountById.get(e.accountId) : undefined} onClick={() => navigate(`/activity/${e.id}`)} />
                  {e.reviewQuestion ? (
                    <p className="mt-3 flex gap-1.5 pl-[56px] text-[13.5px] leading-[1.45] text-gold-ink">
                      <Sparkle size={11} className="mt-[4px] flex-none" />
                      <span>{e.reviewQuestion}</span>
                    </p>
                  ) : null}
                  {e.status === "review" && e.category != null && e.accountId != null ? (
                    <div className="mt-3 flex gap-1.5 pl-[56px]">
                      <Pill className="min-h-10 px-3.5" onClick={() => file(e, { status: "posted" })}>
                        Looks right
                      </Pill>
                      <Pill className="min-h-10 px-3.5" onClick={() => navigate(`/activity/${e.id}`)}>
                        Fix it
                      </Pill>
                    </div>
                  ) : null}
                  {e.category == null ? (
                    <div className="mt-3.5 flex flex-wrap gap-1.5 pl-[56px]">
                      {options.map((c) => {
                        const ai = c === suggestion;
                        return (
                          <Pill key={c} className={cn("flex min-h-10 flex-none items-center gap-1.5 px-3.5", ai && "border-warning/70 text-gold-ink")} onClick={() => file(e, { category: c })}>
                            {ai ? <Sparkle size={11} /> : null}
                            {c}
                          </Pill>
                        );
                      })}
                    </div>
                  ) : null}
                  {e.accountId == null ? (
                    <div className="mt-3 flex flex-wrap gap-1.5 pl-[56px]">
                      {state.accounts.filter((a) => e.amount >= 0 || !!e.linkId || canSpendFrom(a)).map((a) => (
                        <Pill key={a.id} className="min-h-10 max-w-full px-3.5 text-start whitespace-normal" onClick={() => file(e, { accountId: a.id })}>
                          {a.name}
                        </Pill>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="h-16" aria-hidden />
      {toast}
    </Screen>
  );
}

/** Cloud: reconciliation gaps (reported ≠ derived), refetched after every sync. */
export function useGaps() {
  const c = useCloud();
  const { dispatch } = useLedger();
  const [list, setList] = React.useState<Gap[]>([]);
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const tick = c?.tick;
  React.useEffect(() => {
    if (!cloud) return;
    let live = true;
    loadGaps().then(
      (g) => {
        if (!live) return;
        setList(g);
        setClosed(new Set());
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [tick]);
  const adjust = (g: Gap) => {
    setClosed((s) => new Set(s).add(g.snapshot_id));
    dispatch({ type: "record-adjustment", id: newId("j"), accountId: g.account_id });
  };
  return { list: list.filter((g) => !closed.has(g.snapshot_id)), adjust };
}

function GapList({ gaps, onAdjust }: { gaps: Gap[]; onAdjust: (g: Gap) => void }) {
  return (
    <section className="px-6 pt-6">
      <Eyebrow>BALANCES THAT DON’T MATCH</Eyebrow>
      <ul className="mt-2 divide-y divide-line border-y border-line">
        {gaps.map((g) => (
          <li key={g.snapshot_id} className="py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[14.5px]">{g.name}</span>
              <span className={cn("tnum flex-none text-[18px] font-semibold tracking-[-0.01em]", g.gap < 0 ? "text-danger" : "text-success")}>{signed(g.gap)}</span>
            </div>
            <p className="mt-1 text-[13px] leading-[1.45] text-fg-muted">
              You reported {peso(g.reported)} on {stamp(g.as_of)}. Your entries add up to {peso(g.derived)}.
            </p>
            <ActionButton variant="secondary" className="mt-3 min-h-11 w-full" onClick={() => onAdjust(g)}>
              Record adjustment · {signed(g.gap)}
            </ActionButton>
            <p className="mt-1.5 text-[12px] leading-[1.4] text-fg-subtle">Or add the missing entries; the gap closes on its own.</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Re-file a receipt's items; the split follows. */
function SplitSheet({ open, onOpenChange, entry }: { open: boolean; onOpenChange: (o: boolean) => void; entry: Entry }) {
  const { dispatch } = useLedger();
  const [items, setItems] = React.useState(entry.receipt?.items ?? []);
  React.useEffect(() => {
    if (open) setItems(entry.receipt?.items ?? []);
  }, [open, entry.receipt]);
  const save = () => {
    const split = splitOf(items);
    dispatch({
      type: "update-entry",
      id: entry.id,
      patch: { split: split.length > 1 ? split : undefined, category: split[0]?.category ?? entry.category, receipt: { ...entry.receipt, items } },
    });
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Edit split">
      <ul className="mt-3">
        {items.map((it, i) => (
          <li key={i} className="py-2.5">
            <div className="flex justify-between text-[13.5px]">
              <span className="truncate">{it.name}</span>
              <span className="tnum">{peso(it.amount)}</span>
            </div>
            <div className="no-scrollbar -mx-[22px] mt-2 flex gap-1.5 overflow-x-auto px-[22px]">
              {SPEND_CATEGORIES.map((c) => (
                <Pill key={c} active={it.category === c} onClick={() => setItems(items.map((x, j) => (j === i ? { ...x, category: c } : x)))}>
                  {c}
                </Pill>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <Cta className="mt-4" onClick={save}>
        Save split
      </Cta>
    </Sheet>
  );
}
