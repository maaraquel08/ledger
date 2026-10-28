import * as React from "react";
import { cn } from "@/lib/cn";
import { balance } from "@/lib/format";
import { accountLabel } from "@/lib/selectors";
import type { Account, Category } from "@/lib/types";
import { CheckIcon } from "./icons";
import { CategoryChip, ProviderMark } from "./primitives";

/**
 * The Add entry draft: the entry drawn as the Activity row it will become,
 * over one fixed-height panel that swaps to the picker for the part being
 * edited. Study B in design-ledger/studies/add-entry-selection.
 */

export type Kind = "Expense" | "Income" | "Invest";
export type Part = "kind" | "amount" | "desc" | "category" | "account" | "to" | "date";

/* ---------- draft row --------------------------------------------------- */

/**
 * EntryRow's three slots, each one a button that opens its picker. Missing
 * parts read gold (empty logo slot, WHICH ACCOUNT?, NEEDS CATEGORY); the
 * part being edited is underlined, or outlined for the chip.
 */
export function DraftRow({
  title,
  account,
  amount,
  chip,
  active,
  onPart,
}: {
  title: string;
  account?: Account;
  amount: { text: string; tone: "danger" | "success" | "fg" | "empty" };
  chip: { label: string; part: Part; warn?: boolean };
  active?: Part | null;
  onPart?: (p: Part) => void;
}) {
  const part = (p: Part, label: string, className: string, children: React.ReactNode) =>
    onPart ? (
      <button type="button" aria-label={label} aria-expanded={active === p} onClick={() => onPart(p)} className={cn("text-left active:opacity-60", className)}>
        {children}
      </button>
    ) : (
      <span className={className}>{children}</span>
    );
  const line = (p: Part) => active === p && "underline decoration-2 underline-offset-4";

  return (
    <div className="flex w-full items-center gap-3.5 rounded-md border border-line-strong px-3.5 py-3">
      {part(
        "account",
        account ? `Account: ${accountLabel(account)}` : "Pick an account",
        "flex-none",
        account ? <ProviderMark provider={account.provider} /> : <span className="block size-[42px] rounded-[10px] border border-gold-ink" />,
      )}
      <div className="min-w-0 flex-1">
        {part("kind", `Kind: ${title}`, "block max-w-full truncate", <span className={cn("text-[14.5px] leading-[1.3]", line("kind"))}>{title}</span>)}
        <div className="mt-[7px] flex flex-wrap items-center gap-2">
          {part(
            "account",
            account ? `Account: ${accountLabel(account)}` : "Pick an account",
            "",
            <span className={cn("font-mono text-[10.5px] font-medium tracking-[0.05em] whitespace-nowrap", account ? "text-fg-subtle" : "text-gold-ink", line("account"))}>
              {account ? accountLabel(account) : "WHICH ACCOUNT?"}
            </span>,
          )}
          {part(
            chip.part,
            chip.warn ? "Pick a category" : `Category: ${chip.label}`,
            cn("rounded-sm", active === chip.part && "outline-1 outline-accent bg-surface"),
            <CategoryChip tone={chip.warn ? "warn" : "neutral"}>{chip.label}</CategoryChip>,
          )}
        </div>
      </div>
      {part(
        "amount",
        `Amount: ${amount.text}`,
        "flex-none",
        <span
          className={cn(
            "tnum text-[18px] font-semibold tracking-[-0.01em] whitespace-nowrap",
            amount.tone === "danger" && "text-danger",
            amount.tone === "success" && "text-success",
            amount.tone === "fg" && "text-fg",
            amount.tone === "empty" && "text-gold-ink",
            line("amount"),
          )}
        >
          {amount.text}
        </span>,
      )}
    </div>
  );
}

/** What produced the draft (the voice orb, a receipt photo) and a way to redo it. */
export function SourceRow({ lead, label, children, action }: { lead: React.ReactNode; label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[72px] items-center gap-3 border-y border-line py-3">
      <span className="flex-none">{lead}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[9.5px] font-semibold tracking-[0.16em] text-fg-subtle">{label}</span>
        <span className="mt-1 block text-[13px] leading-[1.45] text-fg-muted">{children}</span>
      </span>
      {action}
    </div>
  );
}

/* ---------- panels ------------------------------------------------------ */

/**
 * Every picker sits in the same fixed-height panel so the sheet never jumps.
 * Content anchors to the bottom (thumb reach) and scrolls from the top when
 * it is taller than the panel.
 */
export function PickerPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="no-scrollbar flex h-[300px] flex-col overflow-y-auto overscroll-contain">
      <div className={cn("mt-auto", className)}>{children}</div>
    </div>
  );
}

const KIND_OPTIONS: { kind: Kind; word: string; sign: string; tone: string; meta: string }[] = [
  { kind: "Expense", word: "Spent", sign: "−", tone: "text-danger", meta: "Money out of an account." },
  { kind: "Income", word: "Got", sign: "+", tone: "text-success", meta: "Money in: salary, freelance, a refund." },
  { kind: "Invest", word: "Moved", sign: "→", tone: "text-fg", meta: "Into investments. Adds a “to” account." },
];

export function KindPanel({ value, onPick, noInvestAccount }: { value: Kind; onPick: (k: Kind) => void; noInvestAccount?: boolean }) {
  return (
    <PickerPanel className="flex flex-col gap-2">
      {KIND_OPTIONS.map((o) => (
        <button
          key={o.kind}
          type="button"
          aria-pressed={value === o.kind}
          onClick={() => onPick(o.kind)}
          className={cn(
            "flex min-h-[80px] items-center gap-3.5 rounded-md border px-4 text-left transition-colors duration-fast",
            value === o.kind ? "border-accent bg-surface" : "border-line active:bg-surface",
          )}
        >
          <span aria-hidden className={cn("flex size-9 flex-none items-center justify-center rounded-full border border-line-strong text-[20px] font-medium", o.tone)}>
            {o.sign}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-medium">{o.word}</span>
            <span className="mt-1 block text-[12.5px] text-fg-muted">
              {o.kind === "Invest" && noInvestAccount ? "Add an investments account to track where it goes." : o.meta}
            </span>
          </span>
          {value === o.kind ? <CheckIcon size={18} /> : null}
        </button>
      ))}
    </PickerPanel>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "next", "0", "⌫"];

/** Whole pesos only; "Next" moves on to the first empty part. */
export function KeypadPanel({ onKey, onNext, canNext }: { onKey: (k: string) => void; onNext: () => void; canNext: boolean }) {
  return (
    <PickerPanel className="grid grid-cols-3 gap-1.5">
      {KEYS.map((k) =>
        k === "next" ? (
          <button
            key={k}
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className="h-[66px] rounded-md bg-accent text-[15px] font-semibold text-accent-fg active:bg-accent-hover disabled:bg-fill disabled:text-fg-subtle"
          >
            Next
          </button>
        ) : (
          <button
            key={k}
            type="button"
            aria-label={k === "⌫" ? "Delete" : k}
            onClick={() => onKey(k)}
            className="h-[66px] rounded-md border border-line bg-surface text-[22px] font-medium active:bg-fill"
          >
            {k}
          </button>
        ),
      )}
    </PickerPanel>
  );
}

/** Ranked category tiles, label anchored to the bottom of each card. */
export function CategoryPanel({ options, value, onPick }: { options: Category[]; value: Category | null; onPick: (c: Category) => void }) {
  return (
    <PickerPanel className="grid grid-cols-3 gap-2">
      {options.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={value === c}
          onClick={() => onPick(c)}
          className={cn(
            "flex h-20 items-end rounded-md border px-2.5 pb-2.5 text-left text-[13px] font-medium transition-colors duration-fast",
            value === c ? "border-accent bg-surface" : "border-line-strong active:bg-surface",
          )}
        >
          {c}
        </button>
      ))}
    </PickerPanel>
  );
}

/** Ranked accounts, named the way entry rows name them: GCASH ·8871. */
export function AccountPanel({
  options,
  value,
  onPick,
  allowNone,
}: {
  options: Account[];
  value: string | null;
  onPick: (id: string | null) => void;
  allowNone?: boolean;
}) {
  return (
    <PickerPanel>
      <div className="divide-y divide-line">
        {options.map((a) => (
          <button key={a.id} type="button" aria-pressed={value === a.id} onClick={() => onPick(a.id)} className="flex min-h-14 w-full items-center gap-3 text-left active:opacity-60">
            <ProviderMark provider={a.provider} size={32} radius={8} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{accountLabel(a)}</span>
              <span className="mt-0.5 block truncate font-mono text-[9.5px] tracking-[0.08em] text-fg-subtle uppercase">{a.name}</span>
            </span>
            <span className="tnum text-[13px] text-fg-muted">{balance(a.type === "credit" ? -a.balance : a.balance)}</span>
            <span className="w-[18px] flex-none">{value === a.id ? <CheckIcon size={18} /> : null}</span>
          </button>
        ))}
        {allowNone ? (
          <button type="button" aria-pressed={value === null} onClick={() => onPick(null)} className="flex min-h-12 w-full items-center text-left text-[13px] text-fg-muted active:opacity-60">
            Not sure yet. It goes to Review.
          </button>
        ) : null}
      </div>
    </PickerPanel>
  );
}

export function DescPanel({ value, onChange, onDone, placeholder }: { value: string; onChange: (v: string) => void; onDone: () => void; placeholder: string }) {
  return (
    <PickerPanel className="flex flex-col gap-3">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onDone()}
        maxLength={80}
        enterKeyHint="done"
        placeholder={placeholder}
        aria-label="Where or what"
        className="h-14 rounded-lg border border-line-strong bg-bg px-4 text-[18px] outline-none placeholder:text-mute focus:border-accent"
      />
      <p className="text-[12.5px] text-fg-muted">Optional. Leave it empty and the category names the entry.</p>
      <button type="button" onClick={onDone} className="h-12 rounded-md border border-line-strong text-[13px] font-medium active:bg-surface">
        Done
      </button>
    </PickerPanel>
  );
}

export function DatePanel({ value, today, yesterday, onPick }: { value: string; today: string; yesterday: string; onPick: (d: string) => void }) {
  const chip = (label: string, d: string) => (
    <button
      type="button"
      aria-pressed={value === d}
      onClick={() => onPick(d)}
      className={cn("h-12 flex-1 rounded-md border text-[14px] font-medium", value === d ? "border-accent bg-surface" : "border-line-strong active:bg-surface")}
    >
      {label}
    </button>
  );
  return (
    <PickerPanel className="flex flex-col gap-3">
      <div className="flex gap-2">
        {chip("Today", today)}
        {chip("Yesterday", yesterday)}
      </div>
      <label className="flex h-12 items-center justify-between gap-4 rounded-md border border-line-strong px-4 text-[14px]">
        <span className="text-fg-muted">Another day</span>
        <input type="date" value={value} max={today} onChange={(e) => e.target.value && onPick(e.target.value)} className="bg-transparent text-right text-[16px]" />
      </label>
    </PickerPanel>
  );
}
