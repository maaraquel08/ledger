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
import { cn } from "@/lib/cn";
import { monthName, peso, signed, stamp } from "@/lib/format";
import { SPEND_CATEGORIES, suggestCategory } from "@/lib/providers";
import { splitOf } from "@/lib/receipt";
import { back, navigate } from "@/lib/router";
import { accountLabel, byCategory, inRange, monthBounds } from "@/lib/selectors";
import { needsReview } from "@/screens/ledger-list";
import { newId, useLedger } from "@/lib/store";
import { cloud } from "@/lib/supabase";
import { loadGaps, type Gap } from "@/lib/cloud/api";
import { useCloud } from "@/lib/cloud/provider";
import type { Account, Category, Entry } from "@/lib/types";

const FIELD =
  "h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent";
const ALL_CATEGORIES: Category[] = [...SPEND_CATEGORIES, "Income", "Salary", "Investments", "Transfer"];

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

  // budget status for this entry's category in its month
  let budgetLine = "No budget for this";
  if (entry.category) {
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
  if (sameYear.length >= 5 && entry.amount < 0) {
    note = (
      <>
        Your <AiMark>{ordinal(rank)} {entry.desc}</AiMark> this year, {peso(sameYear.reduce((n, e) => n + Math.abs(e.amount), 0))} so far.
        This one is <AiMark>a habit, not a decision</AiMark>.
      </>
    );
  } else if (entry.amount > 0) {
    note = (
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

  const other = entry.linkId ? state.entries.find((e) => e.id !== entry.id && e.linkId === entry.linkId) : undefined;
  const nameOf = (e: Entry) => state.accounts.find((a) => a.id === e.accountId)?.name ?? "no account";
  const [outLeg, inLeg] = other ? (entry.amount < 0 ? [entry, other] : [other, entry]) : [];

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
          <button type="button" onClick={() => setEditing(true)} className="flex h-10 items-center px-1 text-[15px] active:opacity-60">
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
              entry.amount > 0 ? null : (
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

      <EditEntrySheet open={editing} onOpenChange={setEditing} entry={entry} accounts={state.accounts} />
      {entry.receipt?.image ? (
        <Sheet open={photo} onOpenChange={setPhoto} title="Receipt">
          <img src={entry.receipt.image} alt={`Receipt from ${entry.desc}`} className="mt-4 w-full rounded-md border border-line" />
        </Sheet>
      ) : null}
      {entry.receipt?.items.length ? <SplitSheet open={splitting} onOpenChange={setSplitting} entry={entry} /> : null}
    </Screen>
  );
}

function EditEntrySheet({ open, onOpenChange, entry, accounts }: { open: boolean; onOpenChange: (o: boolean) => void; entry: Entry; accounts: Account[] }) {
  const { dispatch } = useLedger();
  const [desc, setDesc] = React.useState(entry.desc);
  const [amount, setAmount] = React.useState(String(Math.abs(entry.amount)));
  const [cat, setCat] = React.useState<Category | null>(entry.category);
  const [acct, setAcct] = React.useState<string | null>(entry.accountId);

  React.useEffect(() => {
    if (open) {
      setDesc(entry.desc);
      setAmount(String(Math.abs(entry.amount)));
      setCat(entry.category);
      setAcct(entry.accountId);
    }
  }, [open, entry]);

  const value = Number(amount.replace(/,/g, ""));
  const valid = desc.trim() !== "" && Number.isFinite(value) && value > 0;
  const linked = entry.linkId != null;
  const sign = linked ? (entry.amount >= 0 ? 1 : -1) : cat === "Income" || cat === "Salary" ? 1 : cat === "Transfer" || cat === "Investments" ? (entry.amount >= 0 ? 1 : -1) : -1;
  const flips = valid && sign !== (entry.amount >= 0 ? 1 : -1);
  const acctName = accounts.find((a) => a.id === acct)?.name;

  const save = () => {
    if (!valid) return;
    dispatch({ type: "update-entry", id: entry.id, patch: { desc: desc.trim(), amount: sign * value, category: cat, accountId: acct } });
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
        <label className="block">
          <Eyebrow className="mb-2">AMOUNT (₱)</Eyebrow>
          <div className="flex items-center gap-3">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={cn(FIELD, "min-w-0 flex-1 font-mono")} />
            {valid ? <span className={cn("tnum flex-none text-[15px] font-semibold", sign > 0 ? "text-success" : "text-fg")}>{signed(sign * value)}</span> : null}
          </div>
        </label>
        <div>
          <Eyebrow className="mb-2.5">CATEGORY</Eyebrow>
          {linked ? (
            <p className="text-[14px] text-fg-muted">{cat ?? "Transfer"} · linked</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(cat && !ALL_CATEGORIES.includes(cat) ? [...ALL_CATEGORIES, cat] : ALL_CATEGORIES).map((c) => (
                <Pill key={c} active={cat === c} className="min-h-10 px-3.5 text-[12.5px]" onClick={() => setCat(c)}>
                  {c}
                </Pill>
              ))}
            </div>
          )}
        </div>
        <div>
          <Eyebrow className="mb-2.5">ACCOUNT</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <Pill key={a.id} active={acct === a.id} className="min-h-10 max-w-full px-3.5 text-start text-[12.5px] whitespace-normal" onClick={() => setAcct(a.id)}>
                {a.name}
              </Pill>
            ))}
          </div>
        </div>
        {flips ? (
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

/* ====================================================================== */
/*  Review queue                                                           */
/* ====================================================================== */

const QUICK: Category[] = ["Food & drink", "Gifts", "Groceries", "Other"];

export function Review() {
  const { state, dispatch } = useLedger();
  const [leaving, setLeaving] = React.useState<Set<string>>(new Set());
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
    for (const e of queue) {
      if (e.category != null) continue;
      file(e, { category: suggestCategory(e.desc) ?? "Other" });
    }
  };

  if (queue.length === 0 && gaps.list.length === 0) {
    return (
      <Screen tabbed>
        <PageTitle>Review</PageTitle>
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
          <h2 className="text-[19px] leading-[1.25] font-semibold tracking-[-0.01em]">All filed.</h2>
          <p className="mt-2.5 max-w-[260px] text-[14px] leading-[1.5] text-fg-muted">Every entry has a category and an account.</p>
          <Cta className="mt-7 max-w-[240px]" onClick={() => navigate("/money")}>
            See your money
          </Cta>
        </div>
      </Screen>
    );
  }

  return (
    <Screen tabbed>
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
                    <div className="no-scrollbar mt-3.5 -mr-6 flex gap-1.5 overflow-x-auto pr-6 pl-[56px]">
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
                    <div className="no-scrollbar mt-3 -mr-6 flex gap-1.5 overflow-x-auto pr-6 pl-[56px]">
                      {state.accounts.map((a) => (
                        <Pill key={a.id} className="min-h-10 max-w-full flex-none px-3.5 text-start whitespace-normal" onClick={() => file(e, { accountId: a.id })}>
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
    </Screen>
  );
}

/** Cloud: reconciliation gaps (reported ≠ derived), refetched after every sync. */
function useGaps() {
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
