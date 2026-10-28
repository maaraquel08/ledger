import * as React from "react";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer/drawer";
import { AiSummary, AiSummaryLabel, AiSummaryMark, AiSummaryText } from "@/components/ui/ai-summary/ai-summary";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs/tabs";
import { cn } from "@/lib/cn";
import { accountLabel } from "@/lib/selectors";
import { providerMeta } from "@/lib/providers";
import { signed } from "@/lib/format";
import type { Account, Entry, Provider } from "@/lib/types";
import { back } from "@/lib/router";
import { CashIcon, ChartIcon, ChevronLeft, CloseIcon, Sparkle } from "./icons";

/* ---------- layout ---------------------------------------------------- */

/**
 * A phone-width column. On wider screens it centres as a 430px card on the
 * canvas colour so the mobile layout is never stretched.
 */
export function Screen({
  children,
  className,
  tabbed = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** reserve room for the tab bar + the Add FAB above it, so the last row scrolls clear of both */
  tabbed?: boolean;
}) {
  return (
    <div
      className={cn(
        "screen-in relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg",
        "pt-[env(safe-area-inset-top)]",
        // tab bar (~65px) + 14px gap + 60px FAB + 16px air
        tabbed && "pb-[calc(156px+env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** "‹ Activity        Edit" */
export function BackBar({ label, right, onBack }: { label: string; right?: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 pt-3">
      <button
        type="button"
        onClick={onBack ?? (() => back())}
        className="-ml-1 flex h-11 items-center gap-0.5 rounded-md pr-2 text-[15px] text-fg active:opacity-60"
      >
        <ChevronLeft size={20} />
        {label}
      </button>
      {right}
    </div>
  );
}

export function PageTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-6 pt-4">
      <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em]">{children}</h1>
      {right}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("eyebrow", className)}>{children}</div>;
}

/** ✦ THE VERDICT — the AI's voice is gold, never decoration. */
export function AiEyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-[7px]", className)}>
      <Sparkle />
      <span className="eyebrow !text-gold-ink">{children}</span>
    </div>
  );
}

/* ---------- money ------------------------------------------------------ */

export function Amount({ value, className, plain }: { value: number; className?: string; plain?: boolean }) {
  return (
    <span className={cn("tnum whitespace-nowrap", !plain && (value < 0 ? "text-danger" : "text-success"), className)}>
      {signed(value)}
    </span>
  );
}

/* ---------- account tile + entry row ---------------------------------- */

export function ProviderMark({ provider, size = 42, radius = 10 }: { provider: Provider | null; size?: number; radius?: number }) {
  const meta = provider ? providerMeta(provider) : null;
  // a logo that can't load (offline, or outside the app) falls back to the brand's initial
  const [broken, setBroken] = React.useState(false);
  return (
    <span
      className="flex flex-none items-center justify-center overflow-hidden border border-line bg-bg text-fg-muted"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {meta?.logo && !broken ? (
        <img src={meta.logo} alt="" className="size-full object-cover" style={{ borderRadius: "inherit" }} onError={() => setBroken(true)} />
      ) : meta?.logo && broken ? (
        <span className="font-mono text-[13px] font-semibold">{meta.label[0]}</span>
      ) : meta?.icon === "chart" ? (
        <ChartIcon size={size * 0.42} />
      ) : meta?.icon === "cash" ? (
        <CashIcon size={size * 0.42} />
      ) : (
        <span className="font-mono text-[13px] font-semibold">?</span>
      )}
    </span>
  );
}

export function CategoryChip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-0.5 font-mono text-[9.5px] font-medium tracking-[0.05em] whitespace-nowrap uppercase",
        tone === "warn" ? "border-warning/60 text-gold-ink" : "border-line-strong text-fg-muted",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Three fixed slots — description · account · value — so a typed
 * "grab gcash 248" and a synced bank transaction render identically.
 */
export function EntryRow({
  entry,
  account,
  meta,
  onClick,
}: {
  entry: Entry;
  account?: Account;
  /** override the mono line (e.g. "TRANSPORT · TODAY" on an account page) */
  meta?: React.ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className="flex w-full items-center gap-3.5 text-left active:opacity-60">
      <ProviderMark provider={account?.provider ?? null} />
      <div className="min-w-0 flex-1">
        <div className={cn(onClick ? "truncate" : "line-clamp-2 break-words", "text-[14.5px] leading-[1.3]", entry.refunded && "line-through opacity-60")}>{entry.desc}</div>
        <div className="mt-[7px] flex flex-wrap items-center gap-2">
          {meta ?? (
            <>
              <span className={cn("font-mono text-[10.5px] font-medium tracking-[0.05em] whitespace-nowrap", account ? "text-fg-subtle" : "text-gold-ink")}>
                {accountLabel(account)}
                {entry.auto ? " AUTO" : ""}
              </span>
              {entry.category ? <CategoryChip>{entry.category}</CategoryChip> : <CategoryChip tone="warn">Needs category</CategoryChip>}
              {entry.queued ? <CategoryChip tone="warn">On phone</CategoryChip> : null}
            </>
          )}
        </div>
      </div>
      <Amount value={entry.amount} className="text-[18px] font-semibold tracking-[-0.01em]" />
    </Tag>
  );
}

/* ---------- controls --------------------------------------------------- */

/** Rounded pill: filter, suggestion and choice chips. */
export function Pill({
  active,
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "hit rounded-[18px] border px-3 py-[7px] text-[11.5px] whitespace-nowrap transition-colors duration-fast",
        active ? "border-accent bg-accent font-medium text-accent-fg" : "border-line-strong text-fg active:bg-surface",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** Full-width bottom CTA. Disabled until there's something to continue with. */
export function Cta({ className, variant = "primary", ...props }: React.ComponentProps<"button"> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      type="button"
      className={cn(
        "w-full rounded-lg py-4 text-center text-[14.5px] font-semibold transition-colors duration-fast",
        variant === "primary"
          ? "bg-accent text-accent-fg active:bg-accent-hover disabled:bg-fill disabled:text-fg-subtle"
          : "border border-line-strong text-fg active:bg-surface",
        className,
      )}
      {...props}
    />
  );
}

/** Small paired action buttons ("Show the math" / "Adjust budget"). */
export function ActionButton({ variant = "primary", className, ...props }: React.ComponentProps<"button"> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md px-[17px] py-[11px] text-[13px] transition-colors duration-fast",
        variant === "primary" ? "bg-accent font-semibold text-accent-fg active:bg-accent-hover" : "border border-line-strong text-fg active:bg-surface",
        className,
      )}
      {...props}
    />
  );
}

/** Weekly / Monthly / Yearly — sc1m Tabs restyled as the ink segmented control. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)}>
      <TabsList className="gap-0 rounded-none border border-accent bg-bg p-0">
        {options.map((o, i) => (
          <TabsTab
            key={o}
            value={o}
            className={cn(
              "z-1 min-h-11 rounded-none py-2 text-[12px] font-normal text-fg normal-case data-active:bg-accent data-active:font-semibold data-active:text-accent-fg",
              i > 0 && "border-l border-accent",
            )}
          >
            {o}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  );
}

/* ---------- sheet ------------------------------------------------------ */

/**
 * Bottom sheet on the sc1m Drawer: swipe-down to dismiss, inset 10px from
 * the screen edges with the design's 22/30 corner radii.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  icon,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className={cn(
          "max-h-[88dvh] max-w-[410px] overflow-y-auto overscroll-contain rounded-t-[22px] rounded-b-[30px] border-0 px-[22px] pt-2.5 pb-5 shadow-overlay",
          "mb-[env(safe-area-inset-bottom)] [&>div:first-child]:mb-0 [&>div:first-child]:h-1 [&>div:first-child]:w-[38px]",
          className,
        )}
      >
        {title ? (
          <div className="flex items-center justify-between pt-4">
            <DrawerTitle className="flex items-center gap-2.5 text-[15px] font-semibold">
              {icon}
              {title}
            </DrawerTitle>
            <DrawerClose
              aria-label="Close"
              className="relative flex size-[26px] items-center justify-center rounded-full bg-surface text-fg-subtle after:absolute after:-inset-[9px] after:content-[''] active:opacity-60"
            >
              <CloseIcon size={12} />
            </DrawerClose>
          </div>
        ) : null}
        {children}
      </DrawerContent>
    </Drawer>
  );
}

/* ---------- misc ------------------------------------------------------- */

export function StatGrid({ items }: { items: { label: string; value: React.ReactNode; tone?: "success" | "danger" }[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-y-3 rounded-md border border-line py-[13px]">
      {items.map((it) => (
        <div key={it.label} className="px-3">
          <div className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-fg-subtle uppercase">{it.label}</div>
          <div className={cn("tnum mt-1.5 text-[15px] font-semibold", it.tone === "success" && "text-success", it.tone === "danger" && "text-danger")}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

/** "+12%" / "−8%"; null = nothing to compare with (the category is new this period). */
export function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="border border-line-strong px-[5px] py-px font-mono text-[10.5px] font-semibold text-fg-subtle">NEW</span>;
  const bad = invert ? value < 0 : value > 0;
  return (
    <span className={cn("border px-[5px] py-px font-mono text-[10.5px] font-semibold", value === 0 ? "border-line-strong text-fg-subtle" : bad ? "border-danger text-danger" : "border-success text-success")}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {Math.abs(value)}%
    </span>
  );
}

/* ---------- AI-authored copy ----------------------------------------- */

/**
 * Every AI-authored surface sits on sc1m's AiSummary painting in the
 * Ledger palette, so "the AI wrote this" reads the same everywhere.
 * Copy inside is paper on ink: use text-bg/… tints, never fg.
 */
export function AiPanel({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <AiSummary palette="ledger" className={className}>
      <AiSummaryLabel>{label}</AiSummaryLabel>
      {children}
    </AiSummary>
  );
}

/** An AiPanel holding a single finding. Mark its key phrase with <AiMark>. */
export function AiCard({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <AiPanel label={label} className={className}>
      <AiSummaryText className="mt-2.5 text-[14.5px]/[1.65]">{children}</AiSummaryText>
    </AiPanel>
  );
}

/**
 * The phrase that carries the finding, in Ledger yellow with ink text.
 * sc1m's ai-mark paints in --accent (Ledger's ink, invisible on the ink
 * painting), so the gradient is re-pointed at the brand yellow.
 */
export function AiMark({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <AiSummaryMark
      className={cn(
        "text-highlight-fg ![background-image:linear-gradient(90deg,var(--color-highlight),color-mix(in_oklab,var(--color-highlight)_86%,transparent))]",
        className,
      )}
    >
      {children}
    </AiSummaryMark>
  );
}
