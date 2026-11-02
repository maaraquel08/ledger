import * as React from "react";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { cn } from "@/lib/cn";
import { addDays, balance, dayName, monthName, monthShort } from "@/lib/format";
import { accountLabel } from "@/lib/selectors";
import type { Account } from "@/lib/types";
import { CalendarIcon, CheckIcon, ChevronDown, ChevronLeft, ChevronRight } from "./icons";
import { CategoryChip, ProviderMark } from "./primitives";

/**
 * The Add entry draft: the entry drawn as the Activity row it will become,
 * over one fixed-height panel that swaps to the picker for the part being
 * edited. Study B in design-ledger/studies/add-entry-selection.
 */

export type Kind = "Expense" | "Income" | "Transfer";
export const KINDS: Kind[] = ["Expense", "Income", "Transfer"];
export type Part = "amount" | "desc" | "category" | "account" | "to" | "date";

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
  missingAccount = "WHICH ACCOUNT?",
  onPart,
}: {
  title: string;
  account?: Account;
  amount: { text: string; tone: "danger" | "success" | "fg" | "empty" };
  chip: { label: string; part: Part; warn?: boolean };
  active?: Part | null;
  /** what the empty account slot asks ("FROM WHICH ACCOUNT?" on a transfer) */
  missingAccount?: string;
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
        {part("desc", `Note: ${title}`, "block max-w-full truncate", <span className={cn("text-[14.5px] leading-[1.3]", line("desc"))}>{title}</span>)}
        <div className="mt-[7px] flex flex-wrap items-center gap-2">
          {part(
            "account",
            account ? `Account: ${accountLabel(account)}` : "Pick an account",
            "",
            <span className={cn("font-mono text-[10.5px] font-medium tracking-[0.05em] whitespace-nowrap", account ? "text-fg-subtle" : "text-gold-ink", line("account"))}>
              {account ? accountLabel(account) : missingAccount}
            </span>,
          )}
          {part(
            chip.part,
            chip.part !== "category" ? chip.label : chip.warn ? "Pick a category" : `Category: ${chip.label}`,
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
              <span className="mt-0.5 block truncate font-mono text-[9.5px] tracking-[0.08em] text-fg-subtle uppercase">{a.provider === "other" ? a.kind : a.name}</span>
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


/* ---------- the manual form: every field in view, one tap each ---------- */

/** Mono eyebrow over a form field. */
export function FieldLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <span className="font-mono text-[10.5px] font-medium tracking-[0.08em] text-fg-subtle uppercase">{children}</span>
      {aside}
    </div>
  );
}

/** The amount, big and typed with the phone's own number pad. Whole pesos only. */
export const AmountInput = React.forwardRef<
  HTMLInputElement,
  { value: string; onChange: (v: string) => void; onEnter: () => void; sign: "−" | "+" | ""; note?: string }
>(function AmountInput({ value, onChange, onEnter, sign, note }, ref) {
  return (
    <div>
      <label className="flex items-baseline gap-1.5 border-b border-line-strong pb-2 focus-within:border-accent">
        <span aria-hidden className={cn("text-[30px] font-semibold", value ? "text-fg" : "text-mute")}>
          {sign}₱
        </span>
        <input
          ref={ref}
          autoFocus
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          aria-label="Amount in pesos"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
          className="tnum min-w-0 flex-1 bg-transparent text-[40px] leading-none font-semibold tracking-[-0.02em] outline-none placeholder:text-mute"
        />
      </label>
      {note ? (
        <p role="status" className="mt-1.5 text-[12.5px] text-gold-ink">
          {note}
        </p>
      ) : null}
    </div>
  );
});

const fieldClass = "h-12 w-full rounded-md border border-line-strong bg-bg px-3.5 text-[16px] outline-none focus:border-accent";

export interface PickOption {
  value: string;
  label: string;
  /** right-aligned, e.g. the balance */
  meta?: string;
  /** a logo or mark before the label */
  lead?: React.ReactNode;
}

/** A field that opens a popover list (logos and balances in view), keyboard and screen-reader ready. */
export function PickField({
  label,
  value,
  onChange,
  options,
  placeholder = "Pick one",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: PickOption[];
  placeholder?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Select.Root value={value || null} onValueChange={(v) => v != null && onChange(String(v))}>
        <Select.Trigger aria-label={label} className={cn(fieldClass, "flex items-center gap-2.5 text-left data-popup-open:border-accent")}>
          {current ? (
            <>
              {current.lead}
              <span className="min-w-0 flex-1 truncate">{current.label}</span>
              {current.meta ? <span className="tnum text-[13px] text-fg-muted">{current.meta}</span> : null}
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-mute">{placeholder}</span>
          )}
          <ChevronDown size={16} className="flex-none text-fg-subtle" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="z-50 outline-none" sideOffset={6} alignItemWithTrigger={false}>
            <Select.Popup className="min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-lg border border-line bg-bg p-1 shadow-[var(--brand-shadow-overlay)] outline-none transition-[scale,opacity] duration-fast ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
              <Select.List className="max-h-[min(320px,var(--available-height))] overflow-y-auto overscroll-contain">
                {options.map((o) => (
                  <Select.Item
                    key={o.value}
                    value={o.value}
                    className="flex min-h-12 cursor-default items-center gap-3 rounded-md px-2.5 text-[15px] outline-none select-none data-highlighted:bg-surface data-selected:font-medium"
                  >
                    {o.lead}
                    <Select.ItemText className="min-w-0 flex-1 truncate">{o.label}</Select.ItemText>
                    {o.meta ? <span className="tnum text-[13px] font-normal text-fg-muted">{o.meta}</span> : null}
                    <span className="flex w-4 flex-none justify-end">
                      <Select.ItemIndicator>
                        <CheckIcon size={16} />
                      </Select.ItemIndicator>
                    </span>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

/** An account as a pick option: its logo, its name, its balance. */
export const accountOption = (a: Account): PickOption => ({
  value: a.id,
  label: a.name,
  meta: balance(a.type === "credit" ? -a.balance : a.balance),
  lead: <ProviderMark provider={a.provider} size={26} radius={7} />,
});

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const atNoon = (day: string) => new Date(`${day}T12:00:00`);
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** "Today · Tue 3 Nov", "Yesterday · Mon 2 Nov", "Fri 16 Oct 2025" */
function dayText(day: string, max: string) {
  const d = atNoon(day);
  const short = `${dayName(d).slice(0, 3)} ${d.getDate()} ${monthShort(d)}`;
  if (day === max) return `Today · ${short}`;
  if (day === ymd(addDays(atNoon(max), -1))) return `Yesterday · ${short}`;
  return d.getFullYear() === atNoon(max).getFullYear() ? short : `${short} ${d.getFullYear()}`;
}

/** A calendar popover: Today and Yesterday one tap away, any earlier day on a Monday-first month grid. */
export function DateField({ value, max, onChange }: { value: string; max: string; onChange: (d: string) => void }) {
  const [open, setOpen] = React.useState(false);
  // the month on show; follows the value each time the popover opens
  const [view, setView] = React.useState(() => atNoon(value));
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => ymd(new Date(view.getFullYear(), view.getMonth(), i + 1)))];
  const atMax = view.getFullYear() === atNoon(max).getFullYear() && view.getMonth() === atNoon(max).getMonth();
  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
  };
  const shift = (n: number) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));
  const quick = (label: string, d: string) => (
    <button
      type="button"
      onClick={() => pick(d)}
      className={cn("h-9 flex-1 rounded-md border text-[13px] font-medium", value === d ? "border-accent bg-accent text-accent-fg" : "border-line-strong active:bg-surface")}
    >
      {label}
    </button>
  );
  return (
    <div>
      <FieldLabel>Date</FieldLabel>
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          if (o) setView(atNoon(value));
          setOpen(o);
        }}
      >
        <Popover.Trigger aria-label={`Date: ${dayText(value, max)}`} className={cn(fieldClass, "flex items-center gap-2.5 text-left data-popup-open:border-accent")}>
          <CalendarIcon size={18} className="flex-none text-fg-subtle" />
          <span className="min-w-0 flex-1 truncate">{dayText(value, max)}</span>
          <ChevronDown size={16} className="flex-none text-fg-subtle" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner className="z-50 outline-none" sideOffset={6}>
            <Popover.Popup className="w-[var(--anchor-width)] max-w-[340px] origin-[var(--transform-origin)] rounded-lg border border-line bg-bg p-3 shadow-[var(--brand-shadow-overlay)] outline-none transition-[scale,opacity] duration-fast ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
              <div className="flex gap-2">
                {quick("Today", max)}
                {quick("Yesterday", ymd(addDays(atNoon(max), -1)))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="flex size-9 items-center justify-center rounded-md active:bg-surface">
                  <ChevronLeft size={16} />
                </button>
                <span aria-live="polite" className="text-[14px] font-semibold">
                  {monthName(view)} {view.getFullYear()}
                </span>
                <button type="button" aria-label="Next month" disabled={atMax} onClick={() => shift(1)} className="flex size-9 items-center justify-center rounded-md active:bg-surface disabled:opacity-30">
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="mt-1 grid grid-cols-7 text-center font-mono text-[10px] tracking-[0.06em] text-fg-subtle uppercase" aria-hidden>
                {WEEKDAYS.map((w) => (
                  <span key={w} className="py-1.5">
                    {w}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5">
                {cells.map((d, i) =>
                  d ? (
                    <button
                      key={d}
                      type="button"
                      disabled={d > max}
                      aria-pressed={d === value}
                      aria-label={dayText(d, max)}
                      onClick={() => pick(d)}
                      className={cn(
                        "tnum mx-auto flex size-10 items-center justify-center rounded-full text-[14px] disabled:text-mute",
                        d === value ? "bg-accent font-semibold text-accent-fg" : "active:bg-surface",
                        d === max && d !== value && "font-semibold underline underline-offset-4",
                      )}
                    >
                      {Number(d.slice(8))}
                    </button>
                  ) : (
                    <span key={`b${i}`} />
                  ),
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export function NoteField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <FieldLabel>Note</FieldLabel>
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={80} enterKeyHint="done" placeholder={placeholder} className={cn(fieldClass, "placeholder:text-mute")} />
    </label>
  );
}
