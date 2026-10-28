import * as React from "react";
import { AiCard, AiMark, Cta, Eyebrow, Pill, ProviderMark, Screen, Sheet, StatGrid } from "@/components/ledger/primitives";
import { CheckIcon, CloseIcon, PlusIcon } from "@/components/ledger/icons";
import { cn } from "@/lib/cn";
import { peso } from "@/lib/format";
import { PROVIDERS, TYPE_KIND, TYPE_LABEL, providerMeta } from "@/lib/providers";
import { navigate } from "@/lib/router";
import { suggestedBudget } from "@/lib/selectors";
import { newId, useLedger } from "@/lib/store";
import type { Account, AccountType, Frequency, Goal, Provider, SideIncome } from "@/lib/types";

/* ---------- draft store (survives route remounts via sessionStorage) ---- */

interface Draft {
  accounts: Account[];
  balances: Record<string, string>; // account id -> raw digits ("128400.5")
  income: string;
  frequency: Frequency;
  side: SideIncome[];
  goals: { emergency: boolean; trip: boolean };
}

const DRAFT_KEY = "ledger:onboarding";
const EMPTY: Draft = { accounts: [], balances: {}, income: "", frequency: "Twice a month", side: [], goals: { emergency: false, trip: false } };

function load(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return EMPTY;
}

let draft: Draft = load();
const listeners = new Set<() => void>();

function setDraft(patch: Partial<Draft>) {
  draft = { ...draft, ...patch };
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function clearDraft() {
  draft = EMPTY;
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function useDraft() {
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => draft,
  );
}

/* ---------- helpers ----------------------------------------------------- */

const STEPS = ["accounts", "balances", "income"] as const;
const FREQS: Frequency[] = ["Twice a month", "Monthly", "Weekly", "Irregular"];
const TYPES: AccountType[] = ["bank", "investments", "ewallet", "cash", "credit"];

const toNum = (s: string) => Number.parseFloat(s.replace(/,/g, "")) || 0;

/** "1234567.5" -> "1,234,567.5" while typing; keeps a trailing dot. */
function fmtInput(v: string) {
  const clean = v.replace(/[^\d.]/g, "");
  const [i, ...rest] = clean.split(".");
  const dec = rest.join("").slice(0, 2);
  const int = i.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest.length ? `${int}.${dec}` : int;
}

/** Inputs show no container at rest; on focus a weak fill and a 1px ink border. */
const FIELD =
  "w-full rounded-md border border-transparent bg-transparent text-fg outline-none transition-colors duration-fast placeholder:text-fg-subtle focus:border-accent focus:bg-surface";

const accountLine = (a: Account) =>
  `${a.providerLabel.toUpperCase()}${a.type === "ewallet" ? "" : ` · ${a.kind}`}${a.last4 ? ` ·${a.last4}` : ""}`;

/* ---------- chrome ------------------------------------------------------ */

function TopBar({ step, onSkip }: { step: (typeof STEPS)[number]; onSkip: () => void }) {
  const idx = STEPS.indexOf(step);
  return (
    <div className="flex items-center justify-between px-6 pt-3.5">
      <div className="flex gap-[5px]" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={idx + 1} aria-valuetext={`Step ${idx + 1} of 3`} aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <span key={s} className={cn("h-[3px] rounded-[2px] motion-safe:transition-[width,background-color] duration-fast", i === idx ? "w-[22px] bg-accent" : "w-3.5 bg-fill")} />
        ))}
      </div>
      <button type="button" onClick={onSkip} className="-mr-3 flex h-10 items-center px-3 text-[12px] text-fg-muted active:opacity-60">
        Skip
      </button>
    </div>
  );
}

function Heading({ step, title, sub }: { step: number; title: string; sub?: string }) {
  return (
    <div>
      <Eyebrow>STEP {step} OF 3</Eyebrow>
      <h1 className="mt-3 text-[26px] leading-[1.26] font-semibold tracking-[-0.026em] text-balance">{title}</h1>
      {sub ? <p className="mt-[11px] text-[13.5px] leading-[1.55] text-fg-muted text-pretty">{sub}</p> : null}
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="sticky bottom-0 bg-bg px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]">{children}</div>;
}

/* ---------- account sheet ----------------------------------------------- */

type Target = { provider: Provider; edit?: Account } | null;

function AccountForm({ target, onDone }: { target: NonNullable<Target>; onDone: () => void }) {
  const { provider, edit } = target;
  const meta = providerMeta(provider);
  const other = provider === "other";
  const [name, setName] = React.useState(edit?.name ?? "");
  const [label, setLabel] = React.useState(edit?.providerLabel ?? "");
  const [type, setType] = React.useState<AccountType>(edit?.type ?? meta.type);
  const [last4, setLast4] = React.useState(edit?.last4 ?? "");
  const ok = name.trim().length > 0 && (!other || label.trim().length > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    const account: Account = {
      id: edit?.id ?? newId("a"),
      name: name.trim(),
      provider,
      providerLabel: other ? label.trim() : meta.label,
      type,
      kind: TYPE_KIND[type],
      last4: last4 || undefined,
      balance: edit?.balance ?? 0,
    };
    setDraft({ accounts: edit ? draft.accounts.map((a) => (a.id === edit.id ? account : a)) : [...draft.accounts, account] });
    onDone();
  };

  return (
    <form onSubmit={submit} className="pt-5">
      {other ? (
        <label className="mb-5 block">
          <Eyebrow>WHERE IS IT?</Eyebrow>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Bank, app or wallet"
            className={cn(FIELD, "-mx-3 mt-1.5 h-11 w-[calc(100%+24px)] px-3 text-[16px]")}
          />
        </label>
      ) : null}
      <label className="block">
        <Eyebrow>WHAT DO YOU CALL IT?</Eyebrow>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Payroll account"
        className={cn(FIELD, "-mx-3 mt-1.5 h-11 w-[calc(100%+24px)] px-3 text-[18px] font-medium tracking-[-0.01em]")}
      />
      </label>
      <Eyebrow className="mt-5">TYPE</Eyebrow>
      <div className="mt-2 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <Pill key={t} active={type === t} onClick={() => setType(t)} className="min-h-10 px-3.5 text-[13px]">
            {TYPE_LABEL[t]}
          </Pill>
        ))}
      </div>
      <label className="mt-5 block">
      <Eyebrow>LAST 4 · OPTIONAL</Eyebrow>
      <input
        value={last4}
        onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        maxLength={4}
        placeholder="••••"
        className={cn(FIELD, "-mx-3 mt-1.5 h-11 w-[calc(100%+24px)] px-3 font-mono text-[16px] tracking-[0.2em]")}
      />
      </label>
      <Cta type="submit" disabled={!ok} className="mt-6">
        {edit ? "Save" : "Add account"}
      </Cta>
    </form>
  );
}

/* ---------- steps ------------------------------------------------------- */

function Welcome1() {
  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center px-6">
        <div className="flex size-[52px] items-center justify-center rounded-full bg-highlight text-fg">
          <PlusIcon size={26} />
        </div>
        <h1 className="mt-[26px] text-[33px] leading-[1.16] font-semibold tracking-[-0.032em] text-balance">One place for everything you earn, spend and invest.</h1>
        <p className="mt-[11px] text-[13.5px] leading-[1.55] text-fg-muted text-pretty">Three steps to set up. No bank logins, no forms, nothing to verify.</p>
        <ol className="mt-[30px] flex flex-col gap-3">
          {["Add your accounts", "Rough balances", "What you earn"].map((t, i) => (
            <li key={t} className="flex items-center gap-3 text-[14px]">
              <span className="flex size-[22px] flex-none items-center justify-center rounded-full border border-line-strong font-mono text-[10px] font-semibold">{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
      </div>
      <div className="px-5 pb-[max(24px,env(safe-area-inset-bottom))]">
        <Cta onClick={() => navigate("/onboarding/accounts")}>Start</Cta>
        <div className="mt-3 text-center text-[11.5px] text-fg-subtle">About a minute</div>
      </div>
    </Screen>
  );
}

function AccountsStep() {
  const d = useDraft();
  const [target, setTarget] = React.useState<Target>(null);
  const [open, setOpen] = React.useState(false);
  const show = (t: NonNullable<Target>) => {
    setTarget(t);
    setOpen(true);
  };
  const has = d.accounts.length > 0;

  return (
    <Screen>
      <TopBar step="accounts" onSkip={() => navigate("/onboarding/balances")} />
      <div className="flex-1 px-6 pt-6 pb-4">
        <Heading
          step={1}
          title={has ? "Your accounts." : "Add the accounts you actually use."}
          sub={has ? undefined : "Tap one to add it, then name it whatever you call it. Nothing to log into."}
        />
        {has ? (
          <div className="mt-6">
            <Eyebrow>YOURS · {d.accounts.length}</Eyebrow>
            <ul className="mt-2">
              {d.accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3.5 py-2.5">
                  <ProviderMark provider={a.provider} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px]">{a.name}</div>
                    <div className="mt-1 truncate font-mono text-[10.5px] tracking-[0.05em] text-fg-subtle">{accountLine(a)}</div>
                  </div>
                  <button type="button" onClick={() => show({ provider: a.provider, edit: a })} className="flex h-10 items-center px-2 text-[12px] text-fg-muted active:opacity-60">
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => {
                      const { [a.id]: _gone, ...rest } = d.balances;
                      setDraft({ accounts: d.accounts.filter((x) => x.id !== a.id), balances: rest });
                    }}
                    className="-mr-2 flex size-10 items-center justify-center text-fg-subtle active:opacity-60"
                  >
                    <CloseIcon size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => show({ provider: "other" })}
              className="mt-3 flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-[13px] text-fg-muted active:bg-surface"
            >
              Add another <PlusIcon size={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="mt-[26px]">
              <Eyebrow>COMMON IN PH</Eyebrow>
            </div>
            <div className="mt-[13px] grid grid-cols-3 gap-[9px]">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => show({ provider: p.id })}
                  className="flex flex-col items-center gap-2 rounded-lg border border-line-strong px-2.5 py-[13px] active:bg-surface"
                >
                  <ProviderMark provider={p.id} size={30} radius={8} />
                  <span className="text-[11.5px]">{p.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => show({ provider: "other" })}
              className="mt-[11px] flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-[12.5px] text-fg-muted active:bg-surface"
            >
              Something else? Type its name <PlusIcon size={14} />
            </button>
          </>
        )}
      </div>
      <Footer>
        <Cta disabled={!has} onClick={() => navigate("/onboarding/balances")}>
          Continue
        </Cta>
      </Footer>
      <Sheet open={open} onOpenChange={setOpen} title={target ? (target.edit ? `Edit ${target.edit.providerLabel}` : target.provider === "other" ? "Add account" : `Add ${providerMeta(target.provider).label}`) : undefined}>
        {target ? <AccountForm key={target.edit?.id ?? target.provider} target={target} onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </Screen>
  );
}

function BalancesStep() {
  const d = useDraft();
  const filled = d.accounts.filter((a) => (d.balances[a.id] ?? "") !== "").length;
  let assets = 0;
  let owed = 0;
  for (const a of d.accounts) {
    const v = toNum(d.balances[a.id] ?? "");
    if (a.type === "credit") owed += v;
    else assets += v;
  }
  return (
    <Screen>
      <TopBar step="balances" onSkip={() => navigate("/onboarding/income")} />
      <div className="flex-1 px-6 pt-6 pb-4">
        <Heading step={2} title="How much is in each?" sub="Skip any you don’t know." />
        <ul className="mt-5">
          {d.accounts.map((a) => (
            <li key={a.id}>
              <label className="flex items-center gap-3.5 py-2.5">
                <ProviderMark provider={a.provider} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] break-words">{a.name}</div>
                  <div className="mt-1 truncate font-mono text-[10.5px] tracking-[0.05em] text-fg-subtle">
                    {a.type === "credit" ? `${a.providerLabel.toUpperCase()} · OWED${a.last4 ? ` ·${a.last4}` : ""}` : accountLine(a)}
                  </div>
                </div>
                <span className="flex items-center gap-1 text-fg-muted">
                  <span className="font-mono text-[15px]">₱</span>
                  <input
                    value={d.balances[a.id] ?? ""}
                    onChange={(e) => setDraft({ balances: { ...d.balances, [a.id]: fmtInput(e.target.value) } })}
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`${a.name} balance`}
                    className={cn(FIELD, "tnum h-11 w-[116px] px-2 text-right font-mono text-[16px] font-medium")}
                  />
                </span>
              </label>
            </li>
          ))}
        </ul>
        {d.accounts.length > 0 ? (
          <div className="mt-4 text-center font-mono text-[10.5px] tracking-[0.06em] text-fg-subtle">
            {filled} of {d.accounts.length} filled in
          </div>
        ) : (
          <p className="mt-6 text-[13px] text-fg-muted">No accounts yet. You can add them from Accounts later.</p>
        )}
      </div>
      <Footer>
        <Cta
          onClick={() => navigate("/onboarding/income")}
        >
          Continue
        </Cta>
        {filled > 0 ? (
          <div className="mt-3 text-center font-mono text-[10.5px] tracking-[0.04em] text-fg-subtle">
            Assets {peso(assets)}
            {owed > 0 ? ` · card owed ${peso(owed)}` : ""}
          </div>
        ) : null}
      </Footer>
    </Screen>
  );
}

function SideForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const ok = label.trim() !== "" && toNum(amount) > 0;
  return (
    <form
      className="pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        setDraft({ side: [...draft.side, { id: newId("s"), label: label.trim(), amount: toNum(amount), frequency: "Irregular" }] });
        onDone();
      }}
    >
      <label className="block">
      <Eyebrow>WHAT IS IT?</Eyebrow>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Freelance · Studio K"
        className={cn(FIELD, "-mx-3 mt-1.5 h-11 w-[calc(100%+24px)] px-3 text-[16px]")}
      />
      </label>
      <label className="mt-5 block">
      <Eyebrow>HOW MUCH?</Eyebrow>
      <div className="mt-1.5 flex items-center gap-1 text-fg-muted">
        <span className="font-mono text-[16px]">₱</span>
        <input
          value={amount}
          onChange={(e) => setAmount(fmtInput(e.target.value))}
          inputMode="decimal"
          placeholder="0"
          className={cn(FIELD, "tnum h-11 px-2 font-mono text-[16px]")}
        />
      </div>
      </label>
      <p className="mt-3 text-[12px] text-fg-subtle">Irregular · not budgeted</p>
      <Cta type="submit" disabled={!ok} className="mt-5">
        Add side income
      </Cta>
    </form>
  );
}

function IncomeStep() {
  const d = useDraft();
  const [open, setOpen] = React.useState(false);
  return (
    <Screen>
      <TopBar step="income" onSkip={() => navigate("/onboarding/ready")} />
      <div className="flex-1 px-6 pt-6 pb-4">
        <Heading step={3} title="What lands in your account on payday?" sub="Take-home, after deductions." />
        <label className="mt-7 flex items-baseline gap-2 pb-2">
          <span className="font-mono text-[28px] text-fg-muted">₱</span>
          <input
            value={d.income}
            onChange={(e) => setDraft({ income: fmtInput(e.target.value) })}
            inputMode="decimal"
            placeholder="0"
            aria-label="Take-home per payday"
            className="tnum min-w-0 flex-1 bg-transparent font-mono text-[34px] font-semibold tracking-[-0.02em] placeholder:text-fg-subtle"
          />
        </label>
        <div className="mt-7">
          <Eyebrow>HOW OFTEN?</Eyebrow>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {FREQS.map((f) => (
              <Pill key={f} active={d.frequency === f} onClick={() => setDraft({ frequency: f })} className="min-h-10 px-3.5 text-[13px]">
                {f}
              </Pill>
            ))}
          </div>
        </div>
        <div className="mt-7">
          <Eyebrow>SIDE INCOME? · OPTIONAL</Eyebrow>
          {d.side.map((s) => (
            <div key={s.id} className="mt-2.5 flex items-center gap-3 rounded-lg border border-line-strong py-2.5 pr-1 pl-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] break-words">{s.label}</div>
                <div className="mt-0.5 text-[11.5px] text-fg-subtle">Irregular · not budgeted</div>
              </div>
              <span className="tnum font-mono text-[14px] font-semibold text-success">{peso(s.amount)}</span>
              <button
                type="button"
                aria-label={`Remove ${s.label}`}
                onClick={() => setDraft({ side: d.side.filter((x) => x.id !== s.id) })}
                className="flex size-10 items-center justify-center text-fg-subtle active:opacity-60"
              >
                <CloseIcon size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-2.5 flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-[13px] text-fg-muted active:bg-surface"
          >
            {d.side.length ? "Add another" : "Freelance, rent, anything else"} <PlusIcon size={14} />
          </button>
        </div>
      </div>
      <Footer>
        <Cta onClick={() => navigate("/onboarding/ready")}>Done</Cta>
      </Footer>
      <Sheet open={open} onOpenChange={setOpen} title="Side income">
        <SideForm onDone={() => setOpen(false)} />
      </Sheet>
    </Screen>
  );
}

function ReadyStep() {
  const d = useDraft();
  const { dispatch } = useLedger();
  const per = toNum(d.income);
  const factor = d.frequency === "Twice a month" ? 2 : d.frequency === "Weekly" ? 4.33 : 1;
  const monthly = Math.round(per * factor);
  const budget = suggestedBudget(monthly);
  const save = Math.max(0, monthly - budget);
  const savePct = monthly > 0 ? Math.round((save / monthly) * 100) : 0;
  const accounts = d.accounts.map((a) => ({ ...a, balance: toNum(d.balances[a.id] ?? "") }));
  const assets = accounts.reduce((n, a) => n + (a.type === "credit" ? 0 : a.balance), 0);
  const emergency = budget * 3;

  const finish = () => {
    const yr = new Date().getFullYear();
    const goals: Goal[] = [];
    if (d.goals.emergency && emergency > 0) goals.push({ id: newId("g"), name: "Emergency fund", saved: 0, target: emergency, by: `${yr + 1}-12` });
    if (d.goals.trip) goals.push({ id: newId("g"), name: "A trip · Japan", saved: 0, target: 150000, by: `${yr + 1}-12` });
    dispatch({
      type: "complete-onboarding",
      accounts,
      profile: { name: "", initials: "ME", income: per, frequency: d.frequency, sideIncome: d.side, monthlyBudget: budget, categoryBudgets: {}, goals },
    });
    clearDraft();
    navigate("/today", { replace: true });
  };

  const goalBtn = (key: "emergency" | "trip", title: string, sub: string) => (
    <button
      type="button"
      aria-pressed={d.goals[key]}
      onClick={() => setDraft({ goals: { ...d.goals, [key]: !d.goals[key] } })}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors duration-fast",
        d.goals[key] ? "border-accent bg-surface" : "border-line-strong active:bg-surface",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12px] text-fg-muted">{sub}</div>
      </div>
      <span className={cn("flex size-6 flex-none items-center justify-center rounded-full border", d.goals[key] ? "border-accent bg-accent text-accent-fg" : "border-line-strong text-fg-muted")}>
        {d.goals[key] ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
      </span>
    </button>
  );

  return (
    <Screen>
      <div className="flex-1 px-6 pt-10 pb-4">
        <span className="flex size-[46px] items-center justify-center rounded-full bg-accent text-accent-fg">
          <CheckIcon size={22} />
        </span>
        <h1 className="mt-5 text-[26px] leading-[1.26] font-semibold tracking-[-0.026em] text-balance">Set up. Here’s your starting plan.</h1>
        <AiCard label="From what you told me" className="mt-6">
          {monthly > 0 ? (
            <>
              On {peso(monthly)} a month I’d hold spending near <AiMark>{peso(budget)}</AiMark>, leaving {peso(save)}, about {savePct}%, to
              save. Change any of it later.
            </>
          ) : (
            "Add what you earn and I’ll suggest a monthly budget. You can set one anytime from Insights › Budgets."
          )}
        </AiCard>
        <div className="mt-4">
          <StatGrid
            items={[
              { label: "ASSETS", value: peso(assets) },
              { label: "BUDGET", value: budget > 0 ? peso(budget) : "—" },
              { label: "ACCOUNTS", value: d.accounts.length },
            ]}
          />
        </div>
        <div className="mt-6">
          <Eyebrow>WANT A GOAL TOO? · OPTIONAL</Eyebrow>
          <div className="mt-2.5 flex flex-col gap-2">
            {budget > 0 ? goalBtn("emergency", "Emergency fund", `${peso(emergency)} · 3 months of costs`) : null}
            {goalBtn("trip", "A trip", "Japan, ₱150,000")}
          </div>
        </div>
      </div>
      <Footer>
        <Cta onClick={finish}>Go to Today</Cta>
      </Footer>
    </Screen>
  );
}

export function Onboarding({ step }: { step: string }) {
  switch (step) {
    case "accounts":
      return <AccountsStep />;
    case "balances":
      return <BalancesStep />;
    case "income":
      return <IncomeStep />;
    case "ready":
      return <ReadyStep />;
    default:
      return <Welcome1 />;
  }
}
