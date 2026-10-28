import * as React from "react";
import { useChrome } from "@/components/ledger/chrome";
import { PlusIcon } from "@/components/ledger/icons";
import {
  ActionButton,
  Amount,
  BackBar,
  Cta,
  Eyebrow,
  Pill,
  ProviderMark,
  Screen,
  Sheet,
} from "@/components/ledger/primitives";
import { UndoToast, type UndoNote } from "@/components/ledger/undo-toast";
import { cn } from "@/lib/cn";
import { balance, monthShort, peso, signed } from "@/lib/format";
import { PROVIDERS, providerMeta, TYPE_KIND, TYPE_LABEL } from "@/lib/providers";
import { back, navigate } from "@/lib/router";
import { netWorth } from "@/lib/selectors";
import { LedgerList } from "@/screens/ledger-list";
import { adjustmentAmount, newId, useLedger } from "@/lib/store";
import { cloud } from "@/lib/supabase";
import type { Account, AccountType, Provider } from "@/lib/types";

const FIELD =
  "h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent";
const TYPES: AccountType[] = ["bank", "ewallet", "cash", "credit", "investments"];

const kindLine = (a: Account) => {
  const same = a.name.toLowerCase().startsWith(a.providerLabel.toLowerCase());
  return `${same ? "" : `${a.providerLabel} · `}${a.kind}${a.last4 ? ` ·${a.last4}` : ""}`.toUpperCase();
};
const num = (s: string) => Number(s.replace(/,/g, ""));

/** What to suggest as a name, by account type: "Wallet cash", "Main card"… */
export const NAME_HINT: Record<AccountType, string> = {
  bank: "Payroll account",
  ewallet: "Daily wallet",
  cash: "Wallet cash",
  credit: "Main card",
  investments: "Brokerage",
};

/** The Edit text button in a BackBar: 40px to see, 48px to hit. */
export const EDIT_HIT = "flex h-11 min-w-11 items-center justify-center px-1 text-[15px] active:opacity-60";

function dueText(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  return `due ${d.getDate()} ${monthShort(d)}`;
}

/* ====================================================================== */
/*  Accounts list                                                          */
/* ====================================================================== */

function AccountRow({ a, meta }: { a: Account; meta?: React.ReactNode }) {
  return (
    <button type="button" onClick={() => navigate(`/money/${a.id}`)} className="flex min-h-[52px] w-full items-center gap-3.5 text-left active:opacity-60">
      <ProviderMark provider={a.provider} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] leading-[1.3]">{a.name}</div>
        <div className="mt-1.5 truncate font-mono text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle">{kindLine(a)}</div>
      </div>
      <div className="flex-none text-right">
        <div className={cn("tnum text-[18px] font-semibold tracking-[-0.01em]", a.balance < 0 && "text-danger")}>{balance(a.balance)}</div>
        {meta ? <div className="mt-1 font-mono text-[10.5px] tracking-[0.04em] text-fg-subtle">{meta}</div> : null}
      </div>
    </button>
  );
}

function Group({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <Eyebrow className="mb-4">{title}</Eyebrow>
      <div className="flex flex-col gap-[22px]">{children}</div>
    </section>
  );
}

/** Net worth and every account, grouped. The top of Money. */
export function AccountsSummary({ onAdd }: { onAdd: (provider?: Provider) => void }) {
  const { state } = useLedger();
  const nw = netWorth(state.accounts);
  const cash = state.accounts.filter((a) => a.type === "bank" || a.type === "ewallet" || a.type === "cash");
  const credit = state.accounts.filter((a) => a.type === "credit");
  const invested = state.accounts.filter((a) => a.type === "investments");

  const holdings = state.profile.holdings;
  const hv = holdings.reduce((n, h) => n + h.value, 0);
  const change = hv > 0 ? holdings.reduce((n, h) => n + h.change * h.value, 0) / hv : null;

  if (state.accounts.length === 0) {
    return (
      <div className="px-6 pt-8 pb-6">
        <Eyebrow>NO ACCOUNTS YET</Eyebrow>
        <h2 className="mt-3 text-[19px] leading-[1.3] font-semibold tracking-[-0.01em]">Add the accounts you actually use.</h2>
        <p className="mt-2.5 text-[14px] leading-[1.5] text-fg-muted">Balances are yours to keep updated. Ledger never connects to your bank.</p>
        <div className="mt-6 flex flex-col gap-3">
          {(
            [
              ["gcash", "GCash", "Wallet"],
              ["bpi", "BPI", "Debit or savings"],
              ["rcbc", "RCBC", "Credit card"],
              ["cash", "Cash on hand", "Physical"],
            ] as [Provider, string, string][]
          ).map(([p, label, sub]) => (
            <button key={p} type="button" onClick={() => onAdd(p)} className="flex min-h-[64px] items-center gap-3.5 rounded-lg border border-line px-4 text-left active:bg-surface">
              <ProviderMark provider={p} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px]">{label}</div>
                <div className="mt-0.5 text-[12.5px] text-fg-subtle">{sub}</div>
              </div>
              <PlusIcon size={18} className="text-fg-subtle" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pt-6">
      <Eyebrow>TOTAL NET WORTH</Eyebrow>
      <div className={cn("tnum mt-2 mb-9 text-[40px] leading-[1.1] font-semibold tracking-[-0.025em]", nw.total < 0 && "text-danger")}>
        {nw.total < 0 ? "−" : ""}
        {peso(nw.total)}
      </div>
      {cash.length > 0 ? (
        <Group title={`CASH · ${peso(nw.cash)}`}>
          {cash.map((a) => (
            <AccountRow key={a.id} a={a} meta={a.rate} />
          ))}
        </Group>
      ) : null}
      {credit.length > 0 ? (
        <Group title="CREDIT">
          {credit.map((a) => (
            <AccountRow key={a.id} a={a} meta={dueText(a.dueDate)} />
          ))}
        </Group>
      ) : null}
      {invested.length > 0 ? (
        <Group title={`INVESTED · ${peso(nw.invested)}`}>
          {invested.map((a) => (
            <AccountRow
              key={a.id}
              a={a}
              meta={change !== null ? <span className={change < 0 ? "text-danger" : "text-success"}>{change < 0 ? "▼" : "▲"} {Math.abs(change).toFixed(1)}%</span> : null}
            />
          ))}
        </Group>
      ) : null}
    </div>
  );
}

/* ---------- add account sheet ---------- */

export function AddAccountSheet({ open, onOpenChange, initialProvider }: { open: boolean; onOpenChange: (o: boolean) => void; initialProvider?: Provider }) {
  const { dispatch } = useLedger();
  const [provider, setProvider] = React.useState<Provider | null>(null);
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<AccountType>("bank");
  const [last4, setLast4] = React.useState("");
  const [balance, setBalance] = React.useState("");

  const pick = React.useCallback((p: Provider) => {
    const m = providerMeta(p);
    setProvider(p);
    setName(p === "other" ? "" : p === "cash" ? "Cash on hand" : m.label);
    setType(m.type);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setLast4("");
    setBalance("");
    if (initialProvider) pick(initialProvider);
    else {
      setProvider(null);
      setName("");
      setType("bank");
    }
  }, [open, initialProvider, pick]);

  const bal = balance.trim() === "" ? 0 : num(balance);
  const valid = provider !== null && name.trim() !== "" && Number.isFinite(bal) && bal >= 0;

  const save = () => {
    if (!valid || !provider) return;
    const m = providerMeta(provider);
    dispatch({
      type: "upsert-account",
      account: {
        id: newId("a"),
        name: name.trim(),
        provider,
        providerLabel: provider === "other" ? name.trim() : m.label,
        type,
        kind: TYPE_KIND[type],
        last4: last4 || undefined,
        balance: bal,
      },
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add account">
      <form
        className="space-y-5 pt-5 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-3 gap-2.5">
          {[...PROVIDERS, { id: "other" as Provider, label: "Other" }].map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={provider === p.id}
              onClick={() => pick(p.id)}
              className={cn("flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-lg border px-1 py-2.5 text-[12px]", provider === p.id ? "border-accent bg-surface font-medium" : "border-line active:bg-surface")}
            >
              <ProviderMark provider={p.id} size={34} radius={9} />
              {p.label}
            </button>
          ))}
        </div>
        {provider ? (
          <>
            <label className="block">
              <Eyebrow className="mb-2">NAME</Eyebrow>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={NAME_HINT[type]} className={FIELD} enterKeyHint="next" />
            </label>
            <div>
              <Eyebrow className="mb-2.5">TYPE</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {TYPES.map((t) => (
                  <Pill key={t} active={type === t} className="min-h-10 px-3.5 text-[12.5px]" onClick={() => setType(t)}>
                    {TYPE_LABEL[t]}
                  </Pill>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 items-end gap-3">
              <label className="block">
                <Eyebrow className="mb-2">LAST 4 (OPTIONAL)</Eyebrow>
                <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} placeholder="2841" className={cn(FIELD, "font-mono")} />
              </label>
              <label className="block">
                <Eyebrow className="mb-2">{type === "credit" ? "AMOUNT OWED (₱)" : "BALANCE (₱)"}</Eyebrow>
                <input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0" className={cn(FIELD, "font-mono")} />
              </label>
            </div>
          </>
        ) : null}
        <Cta type="submit" disabled={!valid}>
          Add account
        </Cta>
      </form>
    </Sheet>
  );
}

/* ====================================================================== */
/*  Account detail                                                         */
/* ====================================================================== */

export function AccountDetail({ id, path }: { id: string; path: string }) {
  const { state, dispatch } = useLedger();
  const { openAdd } = useChrome();
  const [editing, setEditing] = React.useState(false);
  const [reporting, setReporting] = React.useState(false);
  const [transfer, setTransfer] = React.useState(false);
  const [adjusted, setAdjusted] = React.useState<{ entryId: string; note: UndoNote } | null>(null);
  const closeToast = React.useCallback(() => setAdjusted(null), []);
  const account = state.accounts.find((a) => a.id === id);

  if (!account) {
    return (
      <Screen>
        <BackBar label="Money" onBack={() => back("/money")} />
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
          <h2 className="text-[19px] font-semibold">Account not found</h2>
          <p className="mt-2.5 text-[14px] text-fg-muted">It may have been removed.</p>
          <Cta className="mt-7 max-w-[240px]" onClick={() => navigate("/money", { replace: true })}>
            Back to Money
          </Cta>
        </div>
      </Screen>
    );
  }

  // cloud mode: report_balance snapshot. The balance stays derived from entries (D-0014); a gap
  // shows in Review, closed only by an Adjustment the Owner records.
  // Local mode: the sheet shows the gap and the Owner confirms one Adjustment entry here.
  const reportBalance = (value: number) => {
    if (cloud) return dispatch({ type: "report-balance", id: newId("s"), accountId: account.id, reported: value });
    const amount = adjustmentAmount(account, value);
    if (!amount) return;
    const entry = { id: newId("e"), desc: "Balance adjustment", accountId: account.id, category: "Adjustment" as const, amount, date: new Date().toISOString() };
    dispatch({ type: "add-entry", entry });
    setAdjusted({ entryId: entry.id, note: { label: "Adjustment recorded", amount: signed(amount), where: `${account.name} now matches ${balance(value)}` } });
  };

  return (
    <Screen className="pb-[max(32px,env(safe-area-inset-bottom))]">
      <BackBar
        label="Money"
        onBack={() => back("/money")}
        right={
          <button type="button" onClick={() => setEditing(true)} className={EDIT_HIT}>
            Edit
          </button>
        }
      />
      <div className="flex flex-col items-center px-6 pt-6 text-center">
        <ProviderMark provider={account.provider} size={64} radius={16} />
        <div className="mt-4 text-[19px] leading-[1.25] font-semibold tracking-[-0.01em] text-balance">{account.name}</div>
        <div className="mt-1.5 font-mono text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle">{kindLine(account)}</div>
        <div className={cn("tnum mt-5 text-[40px] leading-[1.1] font-semibold tracking-[-0.025em]", account.balance < 0 && "text-danger")}>{balance(account.balance)}</div>
        {account.type === "credit" ? <div className="mt-1.5 font-mono text-[10.5px] tracking-[0.05em] text-fg-subtle">OWED{account.dueDate ? ` · ${dueText(account.dueDate)?.toUpperCase()}` : ""}</div> : null}
        <button type="button" onClick={() => setReporting(true)} className="mt-2 flex min-h-11 items-center px-2 text-[13px] text-fg-muted underline underline-offset-4 active:opacity-60">
          Report balance
        </button>
      </div>

      <div className="flex gap-3 px-6 pt-5 pb-6">
        <ActionButton className="min-h-12 flex-1" onClick={() => openAdd({ accountId: account.id })}>
          Add entry here
        </ActionButton>
        <ActionButton variant="secondary" className="min-h-12 flex-1" onClick={() => setTransfer(true)}>
          Transfer
        </ActionButton>
      </div>

      <LedgerList path={path} base={`/money/${account.id}`} accountId={account.id} />

      <EditAccountSheet
        open={editing}
        onOpenChange={setEditing}
        account={account}
        onRemove={() => {
          dispatch({ type: "remove-account", id: account.id });
          navigate("/money", { replace: true });
        }}
      />
      <ReportBalanceSheet open={reporting} onOpenChange={setReporting} account={account} onReport={reportBalance} />
      <TransferSheet open={transfer} onOpenChange={setTransfer} from={account} />
      <UndoToast note={adjusted?.note ?? null} onClose={closeToast} onUndo={() => adjusted && dispatch({ type: "delete-entry", id: adjusted.entryId })} />
    </Screen>
  );
}

function EditAccountSheet({ open, onOpenChange, account, onRemove }: { open: boolean; onOpenChange: (o: boolean) => void; account: Account; onRemove: () => void }) {
  const { dispatch } = useLedger();
  const [name, setName] = React.useState(account.name);
  const [last4, setLast4] = React.useState(account.last4 ?? "");
  const [confirm, setConfirm] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(account.name);
      setLast4(account.last4 ?? "");
      setConfirm(false);
    }
  }, [open, account]);

  const valid = name.trim() !== "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Edit account">
      <form
        className="space-y-5 pt-5 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          dispatch({ type: "upsert-account", account: { ...account, name: name.trim(), last4: last4 || undefined } });
          onOpenChange(false);
        }}
      >
        <label className="block">
          <Eyebrow className="mb-2">NAME</Eyebrow>
          <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} enterKeyHint="next" />
        </label>
        <label className="block">
          <Eyebrow className="mb-2">LAST 4</Eyebrow>
          <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} className={cn(FIELD, "font-mono")} />
        </label>
        <Cta type="submit" disabled={!valid}>
          Save changes
        </Cta>
        {confirm ? (
          <div className="rounded-lg border border-danger/50 p-3.5">
            <p className="text-[13.5px] leading-[1.45]">Remove {account.name}? Its entries stay in Money but lose their account.</p>
            <div className="mt-3 flex gap-2.5">
              <ActionButton variant="secondary" className="min-h-11 flex-1" autoFocus onClick={() => setConfirm(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                className="min-h-11 flex-1 !bg-danger"
                onClick={() => {
                  onOpenChange(false);
                  onRemove();
                }}
              >
                Remove account
              </ActionButton>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="flex min-h-11 w-full items-center justify-center text-[14px] text-danger active:opacity-60">
            Remove account
          </button>
        )}
      </form>
    </Sheet>
  );
}

/**
 * What the account shows right now, as the Owner reads it off the app or card.
 * D-0014: the report never changes the balance. Cloud stores it as a snapshot and
 * the gap waits in Review; local mode shows the gap here and records an Adjustment
 * only when the Owner confirms it.
 */
function ReportBalanceSheet({ open, onOpenChange, account, onReport }: { open: boolean; onOpenChange: (o: boolean) => void; account: Account; onReport: (value: number) => void }) {
  const [value, setValue] = React.useState("");
  React.useEffect(() => {
    if (open) setValue("");
  }, [open]);
  const n = num(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 0;
  const gap = valid ? Math.round(n) - Math.round(account.balance) : 0;
  const credit = account.type === "credit";
  // "less" / "more" in the Owner's terms: what's in the account, or what's owed on the card
  const gapLine = gap === 0 ? null : `${peso(gap)} ${gap < 0 ? "less" : "more"}${credit ? " owed" : ""}`;
  const local = !cloud;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Report balance">
      <form
        className="space-y-5 pt-5 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (local && gap === 0) return onOpenChange(false);
          onReport(n);
          onOpenChange(false);
        }}
      >
        <p className="text-[14px] leading-[1.5] text-fg-muted">
          {credit ? "How much do you owe on" : "What does"} {account.name} {credit ? "right now?" : "show right now?"} Ledger has {balance(account.balance)}
          {credit ? " owed" : ""}.
        </p>
        <label className="block">
          <Eyebrow className="mb-2">{credit ? "OWED NOW (₱)" : "BALANCE NOW (₱)"}</Eyebrow>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" placeholder={String(Math.round(account.balance))} className={cn(FIELD, "font-mono")} autoFocus />
        </label>
        {valid && local ? (
          <div role="status" className="rounded-md border border-line px-3.5 py-3">
            {gapLine ? (
              <>
                <p className="tnum text-[14px] leading-[1.5]">
                  Ledger expects {peso(account.balance)} · you reported {peso(n)} · <span className="font-semibold">{gapLine}</span>
                </p>
                <p className="mt-1.5 text-[12.5px] leading-[1.45] text-fg-subtle">
                  An adjustment entry closes the gap. It isn’t spending or income. Missing an entry instead? Log it and the gap closes on its own.
                </p>
              </>
            ) : (
              <p className="text-[14px] leading-[1.5]">That matches what Ledger has. Nothing to adjust.</p>
            )}
          </div>
        ) : null}
        {valid && !local && gap !== 0 ? (
          <p role="status" className="tnum text-[13px] text-fg-muted">
            {signed(gap)} from what Ledger has. Ledger keeps its balance from your entries; the difference waits in Review, where you can record an adjustment.
          </p>
        ) : null}
        <Cta type="submit" disabled={!valid}>
          {local ? (valid && gap !== 0 ? `Record ${peso(gap)} adjustment` : "Done") : "Report balance"}
        </Cta>
      </form>
    </Sheet>
  );
}

function TransferSheet({ open, onOpenChange, from }: { open: boolean; onOpenChange: (o: boolean) => void; from: Account }) {
  const { state, dispatch } = useLedger();
  const others = state.accounts.filter((a) => a.id !== from.id);
  const [to, setTo] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setTo(null);
      setAmount("");
    }
  }, [open]);

  const value = num(amount);
  const dest = others.find((a) => a.id === to);
  const overdraws = from.type !== "credit" && Number.isFinite(value) && value > from.balance;
  const valid = !!dest && Number.isFinite(value) && value > 0 && !overdraws;

  const go = () => {
    if (!dest || !valid) return;
    const date = new Date().toISOString();
    const linkId = newId("l");
    dispatch({
      type: "add-entries",
      entries: [
        { id: newId("e"), desc: `Transfer to ${dest.name}`, accountId: from.id, category: "Transfer", amount: -value, date, linkId },
        { id: newId("e"), desc: `Transfer from ${from.name}`, accountId: dest.id, category: "Transfer", amount: value, date, linkId },
      ],
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Transfer from ${from.name}`}>
      <form
        className="space-y-5 pt-5 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        {others.length === 0 ? (
          <p className="text-[14px] text-fg-muted">Add another account to move money between them.</p>
        ) : (
          <>
            <div>
              <Eyebrow className="mb-2.5">TO</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {others.map((a) => (
                  <Pill key={a.id} active={to === a.id} className="min-h-10 max-w-full px-3.5 text-[12.5px] whitespace-normal text-start" onClick={() => setTo(a.id)}>
                    {a.name}
                  </Pill>
                ))}
              </div>
            </div>
            <label className="block">
              <Eyebrow className="mb-2">AMOUNT (₱)</Eyebrow>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className={cn(FIELD, "font-mono")} />
            </label>
            {overdraws ? <p className="text-[13px] text-danger">That would leave {from.name} at {balance(from.balance - value)}.</p> : null}
            {valid && dest ? (
              <p className="text-[13px] text-fg-muted">
                <Amount value={-value} /> from {from.name}, <Amount value={value} /> to {dest.name}.
              </p>
            ) : null}
          </>
        )}
        <Cta type="submit" disabled={!valid}>
          Transfer
        </Cta>
      </form>
    </Sheet>
  );
}
