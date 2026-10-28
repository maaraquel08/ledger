import * as React from "react";
import { useChrome } from "@/components/ledger/chrome";
import { CloseIcon, SearchIcon, SortIcon } from "@/components/ledger/icons";
import { ActionButton, Amount, Cta, EntryRow, Eyebrow, Pill, Sheet } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { addDays, dayHeading, localDay, monthName, monthShort, peso, signed, startOfDay } from "@/lib/format";
import { SPEND_CATEGORIES } from "@/lib/providers";
import { navigate, query } from "@/lib/router";
import { inRange, monthBounds, totals } from "@/lib/selectors";
import { useLedger } from "@/lib/store";
import type { Category, Entry } from "@/lib/types";

/*
 * The ledger: every entry, newest first, filtered by type, account,
 * category, date range and search. Money shows it under the accounts;
 * an account page shows the same list pinned to that account. Filters
 * live in the URL so Analytics can link straight into it.
 */

export type EntryKind = "income" | "expense" | "transfer" | "invest";

/** Same split the selectors use: investments and transfers are never spend or income. */
export function entryKind(e: Entry): EntryKind {
  if (e.category === "Investments") return "invest";
  // an Adjustment (cloud) is neither spend nor income; it files with the moves
  if (e.category === "Transfer" || e.category === "Adjustment" || e.linkId != null) return "transfer";
  return e.amount > 0 ? "income" : "expense";
}

/** Missing a category or an account: lands in Review. */
export const needsReview = (e: Entry) => e.category == null || e.accountId == null || e.status === "review";

const KINDS: { id: EntryKind | null; label: string }[] = [
  { id: null, label: "All" },
  { id: "income", label: "Income" },
  { id: "expense", label: "Expense" },
  { id: "transfer", label: "Transfer" },
  { id: "invest", label: "Invest" },
];
const isKind = (s: string | null): s is EntryKind => s === "income" || s === "expense" || s === "transfer" || s === "invest";

type Sort = "new" | "old" | "large";
const SORT_LABEL: Record<Sort, string> = { new: "Newest", old: "Oldest", large: "Largest" };
const ALL_CATEGORIES: Category[] = [...SPEND_CATEGORIES, "Income", "Salary", "Investments", "Transfer"];
const DAY_PAGE = 60;
const ENTRY_PAGE = 100;
const ICON_BTN = "flex size-11 items-center justify-center rounded-full text-fg active:bg-surface";

/** "YYYY-MM-DD" → local midnight */
const dayOf = (k: string) => new Date(`${k}T00:00:00`);

/**
 * A link into the ledger, e.g. ledgerHref({ type: "expense", from, to }). Dates are inclusive.
 * `ids` pins the list to exactly those entries (the ones behind a claim), named by `label`.
 */
export function ledgerHref(f: { type?: EntryKind; cat?: Category; from?: Date; to?: Date; acct?: string; ids?: string[]; label?: string }, base = "/money") {
  const p = new URLSearchParams();
  if (f.ids) p.set("ids", f.ids.join(","));
  if (f.label) p.set("label", f.label);
  if (f.type) p.set("type", f.type);
  if (f.cat) p.set("cat", f.cat);
  if (f.acct) p.set("acct", f.acct);
  if (f.from) p.set("from", localDay(f.from));
  if (f.to) p.set("to", localDay(f.to));
  const s = p.toString();
  return `${base}${s ? `?${s}` : ""}`;
}

interface Structural {
  kind: EntryKind | null;
  cat: Category | null;
  /** "YYYY-MM-DD", inclusive */
  from: string | null;
  to: string | null;
  accts: string[];
}

/** The ledger's type, category, account and date filters; search and pinned ids aside. */
function passes(e: Entry, f: Structural) {
  const t = new Date(e.date).getTime();
  if (f.from && t < dayOf(f.from).getTime()) return false;
  if (f.to && t >= addDays(dayOf(f.to), 1).getTime()) return false;
  if (f.kind && entryKind(e) !== f.kind) return false;
  if (f.accts.length && !f.accts.includes(e.accountId ?? "")) return false;
  if (f.cat && e.category !== f.cat && !e.split?.some((s) => s.category === f.cat)) return false;
  return true;
}

/**
 * A link to exactly `picked`: the readable filter link when that filter shows the same
 * entries, otherwise the entries pinned by id under `label`.
 */
export function entriesHref(all: Entry[], picked: Entry[], label: string, filter?: { type?: EntryKind; cat?: Category; from?: Date; to?: Date }) {
  if (filter) {
    const f: Structural = {
      kind: filter.type ?? null,
      cat: filter.cat ?? null,
      from: filter.from ? localDay(filter.from) : null,
      to: filter.to ? localDay(filter.to) : null,
      accts: [],
    };
    const want = new Set(picked.map((e) => e.id));
    let n = 0;
    let same = true;
    for (const e of all) {
      if (!passes(e, f)) continue;
      n++;
      if (!want.has(e.id)) {
        same = false;
        break;
      }
    }
    if (same && n === want.size) return ledgerHref(filter);
  }
  return ledgerHref({ ids: picked.map((e) => e.id), label });
}

function rangeLabel(from: string | null, to: string | null) {
  const a = from ? dayOf(from) : null;
  const b = to ? dayOf(to) : null;
  const short = (d: Date) => `${d.getDate()} ${monthShort(d)}`;
  if (a && b) {
    if (from === to) return dayHeading(a);
    const [mf, mt] = monthBounds(a);
    if (a.getTime() === mf.getTime() && addDays(b, 1).getTime() === mt.getTime()) return `${monthName(a)} ${a.getFullYear()}`;
    if (a.getMonth() === 0 && a.getDate() === 1 && b.getMonth() === 11 && b.getDate() === 31 && a.getFullYear() === b.getFullYear()) return `${a.getFullYear()}`;
    return `${short(a)} – ${short(b)}`;
  }
  if (a) return `From ${short(a)}`;
  if (b) return `Until ${short(b)}`;
  return "Any time";
}

function Chip({ children, onRemove, onClick }: { children: string; onRemove?: () => void; onClick?: () => void }) {
  return (
    <span className="flex h-11 flex-none items-center rounded-[22px] text-[12.5px] ring-1 ring-line-strong ring-inset whitespace-nowrap">
      <button type="button" onClick={onClick} className="h-full pl-3.5 active:opacity-60" style={{ paddingRight: onRemove ? 6 : 14 }}>
        {children}
      </button>
      {onRemove ? (
        <button type="button" aria-label={`Remove ${children} filter`} onClick={onRemove} className="flex h-full w-9 items-center justify-center text-fg-subtle active:opacity-60">
          <CloseIcon size={11} />
        </button>
      ) : null}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="min-w-0 px-3">
      <div className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-fg-subtle">{label}</div>
      <div className="tnum mt-1.5 text-[clamp(0.875rem,4.4vw,1rem)] font-semibold whitespace-nowrap">{value}</div>
      <div className="mt-1 truncate font-mono text-[9.5px] tracking-[0.05em] text-fg-subtle uppercase">{sub}</div>
    </div>
  );
}

export function LedgerList({ path, base, accountId }: { path: string; base: string; accountId?: string }) {
  const { state } = useLedger();
  const { openAdd } = useChrome();
  const params = query(path);
  const q = params.get("q") ?? "";
  const kind = isKind(params.get("type")) ? (params.get("type") as EntryKind) : null;
  const accts = accountId ? [accountId] : (params.get("acct") ?? "").split(",").filter(Boolean);
  const cat = (params.get("cat") as Category | null) || null;
  const from = params.get("from");
  const to = params.get("to");
  const sort = (["new", "old", "large"].includes(params.get("sort") ?? "") ? params.get("sort") : "new") as Sort;
  const idsParam = params.get("ids");
  const pinned = React.useMemo(() => (idsParam ? new Set(idsParam.split(",").filter(Boolean)) : null), [idsParam]);
  const pinnedLabel = params.get("label") || "Selected entries";

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(path.split("?")[1] ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    navigate(`${base}${s ? `?${s}` : ""}`, { replace: true });
  };

  const [searchOpen, setSearchOpen] = React.useState(q !== "");
  const [text, setText] = React.useState(q);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);
  const [pages, setPages] = React.useState(1);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // debounce the search text into the URL
  React.useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => setParams({ q: text.trim() ? text : null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  React.useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const now = new Date();
  const accountById = React.useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts]);
  const scope = React.useMemo(() => (accountId ? state.entries.filter((e) => e.accountId === accountId) : state.entries), [state.entries, accountId]);
  const [mf, mt] = monthBounds(now);
  const monthList = inRange(scope, mf, mt);
  const monthT = totals(monthList);

  // filters beyond the account an account page is pinned to
  const filtering = pinned !== null || q.trim() !== "" || kind !== null || cat !== null || from !== null || to !== null || (!accountId && accts.length > 0);

  const matches = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f: Structural = { kind, cat, from, to, accts };
    const list = scope.filter((e) => {
      if (pinned && !pinned.has(e.id)) return false;
      if (!passes(e, f)) return false;
      if (needle) {
        const acc = e.accountId ? accountById.get(e.accountId) : undefined;
        const hay = `${e.desc} ${e.raw ?? ""} ${e.category ?? ""} ${acc?.name ?? ""} ${acc?.providerLabel ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const sorted = [...list];
    if (sort === "old") sorted.sort((x, y) => x.date.localeCompare(y.date));
    else if (sort === "large") sorted.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
    else sorted.sort((x, y) => y.date.localeCompare(x.date));
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, pinned, q, kind, cat, from, to, sort, accts.join(","), accountById]);

  const groups = React.useMemo(() => {
    const out: { key: string; heading: string | null; items: Entry[] }[] = [];
    if (sort === "large") return [{ key: "all", heading: null, items: matches.slice(0, ENTRY_PAGE * pages) }];
    const byMonth = filtering && !(from && to && from === to);
    const list = byMonth ? matches.slice(0, ENTRY_PAGE * pages) : matches;
    for (const e of list) {
      const d = new Date(e.date);
      const key = byMonth ? `${d.getFullYear()}-${d.getMonth()}` : startOfDay(d).toISOString();
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else
        out.push({
          key,
          heading: byMonth ? `${monthName(d)}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`.toUpperCase() : dayHeading(d, now),
          items: [e],
        });
    }
    return byMonth ? out : out.slice(0, DAY_PAGE * pages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, sort, filtering, pages, from, to]);

  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const hasMore = shown < matches.length;
  const matchSum = matches.reduce((n, e) => n + e.amount, 0);
  const clearAll = () => {
    setText("");
    setParams({ q: null, acct: null, cat: null, type: null, from: null, to: null, ids: null, label: null });
  };
  const setPeriod = (p: "month" | "year" | "all") => {
    if (p === "all") return setParams({ from: null, to: null });
    const a = p === "month" ? mf : new Date(now.getFullYear(), 0, 1);
    const b = p === "month" ? addDays(mt, -1) : new Date(now.getFullYear(), 11, 31);
    setParams({ from: localDay(a), to: localDay(b) });
  };
  const periodIs = (p: "month" | "year" | "all") => {
    if (p === "all") return !from && !to;
    if (p === "month") return from === localDay(mf) && to === localDay(addDays(mt, -1));
    return from === `${now.getFullYear()}-01-01` && to === `${now.getFullYear()}-12-31`;
  };
  const searchActive = searchOpen || q !== "";

  /* ---- no entries at all ---- */
  if (scope.length === 0) {
    return (
      <div className="flex flex-col items-center px-8 pt-12 pb-10 text-center">
        <h2 className="text-[19px] leading-[1.25] font-semibold tracking-[-0.01em] text-balance">{accountId ? "Nothing here yet" : "No entries yet"}</h2>
        <p className="mt-2.5 max-w-[260px] text-[14px] leading-[1.5] text-fg-muted">Type it however you want. “grab gcash 248” is enough.</p>
        <Cta className="mt-7 max-w-[280px]" onClick={() => openAdd(accountId ? { accountId } : undefined)}>
          Add an entry
        </Cta>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between px-6 pt-2">
        <Eyebrow>{accountId ? "ENTRIES HERE" : "LEDGER"}</Eyebrow>
        <div className="-mr-2.5 flex items-center">
          <button type="button" aria-label="Search" aria-pressed={searchActive} className={cn(ICON_BTN, searchActive && "bg-surface")} onClick={() => (searchActive && !q ? setSearchOpen(false) : setSearchOpen(true))}>
            <SearchIcon />
          </button>
          <button type="button" aria-label="Sort" className={cn(ICON_BTN, sort !== "new" && "bg-surface")} onClick={() => setSortOpen(true)}>
            <SortIcon />
          </button>
        </div>
      </div>

      {searchActive ? (
        <div className="px-6 pt-2">
          <div className="flex h-11 items-center gap-2.5 rounded-md border border-line-strong px-3 focus-within:border-accent">
            <SearchIcon size={16} className="flex-none text-fg-subtle" />
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Search entries"
              placeholder="Search description, category, account"
              enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-subtle"
            />
            {text ? (
              <button
                type="button"
                aria-label="Clear search"
                className="relative flex size-8 items-center justify-center text-fg-subtle after:absolute after:-inset-[6px] after:content-['']"
                onClick={() => {
                  setText("");
                  setParams({ q: null });
                  inputRef.current?.focus();
                }}
              >
                <CloseIcon size={12} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div role="group" aria-label="Entry type" className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto px-6">
        {KINDS.map((k) => (
          <Pill key={k.label} active={kind === k.id} className="min-h-11 flex-none px-4 text-[12.5px]" onClick={() => setParams({ type: k.id })}>
            {k.label}
          </Pill>
        ))}
      </div>

      <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto px-6">
        {pinned ? <Chip onRemove={() => setParams({ ids: null, label: null })}>{pinnedLabel}</Chip> : null}
        {!accountId
          ? accts.map((id) => (
              <Chip key={id} onRemove={() => setParams({ acct: accts.filter((x) => x !== id).join(",") || null })}>
                {accountById.get(id)?.providerLabel ?? "Account"}
              </Chip>
            ))
          : null}
        <Chip onClick={() => setFilterOpen(true)} onRemove={from || to ? () => setParams({ from: null, to: null }) : undefined}>
          {rangeLabel(from, to)}
        </Chip>
        <Chip onClick={() => setFilterOpen(true)} onRemove={cat ? () => setParams({ cat: null }) : undefined}>
          {cat ?? "Category"}
        </Chip>
        {!accountId && accts.length === 0 ? <Chip onClick={() => setFilterOpen(true)}>+ Account</Chip> : null}
      </div>

      {!filtering ? (
        <div className="px-6 pt-4">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))] gap-y-3 rounded-md border border-line py-3.5">
            <Stat label="IN" value={<span className="text-success">{peso(monthT.in)}</span>} sub={`${monthT.deposits} deposit${monthT.deposits === 1 ? "" : "s"}`} />
            <Stat label="OUT" value={<span className="text-danger">{peso(monthT.out)}</span>} sub={`${monthT.outs} ${monthT.outs === 1 ? "entry" : "entries"}`} />
            <Stat label="NET" value={<span className={monthT.net < 0 ? "text-danger" : "text-success"}>{signed(monthT.net)}</span>} sub={monthName(now).slice(0, 3).toUpperCase()} />
          </div>
        </div>
      ) : (
        <div className="flex items-baseline justify-between px-6 pt-5">
          <span className="text-[13.5px] text-fg-muted">
            {matches.length} match{matches.length === 1 ? "" : "es"}
          </span>
          {matches.length ? <Amount value={matchSum} className="text-[15px] font-semibold" /> : null}
        </div>
      )}

      {matches.length === 0 ? (
        <div className="px-8 pt-14 pb-10 text-center">
          <div className="text-[16px] font-semibold">No matches</div>
          <p className="mt-2 text-[13.5px] text-fg-muted">Nothing fits those filters.</p>
          <ActionButton variant="secondary" className="mt-5 min-h-11" onClick={clearAll}>
            Clear filters
          </ActionButton>
        </div>
      ) : (
        <div className="px-6 pt-7 pb-10">
          {groups.map((g) => (
            <section key={g.key} className="mb-8">
              {g.heading ? <Eyebrow className="mb-4">{g.heading}</Eyebrow> : null}
              <div className="flex flex-col gap-[22px]">
                {g.items.map((e) => (
                  <EntryRow key={e.id} entry={e} account={e.accountId ? accountById.get(e.accountId) : undefined} onClick={() => navigate(`/activity/${e.id}`)} />
                ))}
              </div>
            </section>
          ))}
          {hasMore ? (
            <ActionButton variant="secondary" className="mb-6 min-h-11 w-full" onClick={() => setPages((p) => p + 1)}>
              Show earlier
            </ActionButton>
          ) : null}
        </div>
      )}

      <Sheet open={sortOpen} onOpenChange={setSortOpen} title="Sort by">
        <div className="flex flex-wrap gap-2 pt-5 pb-3">
          {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
            <Pill
              key={s}
              active={sort === s}
              className="min-h-11 px-4 text-[13px]"
              onClick={() => {
                setParams({ sort: s === "new" ? null : s });
                setSortOpen(false);
              }}
            >
              {SORT_LABEL[s]}
            </Pill>
          ))}
        </div>
      </Sheet>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen} title="Filter">
        <div className="space-y-6 pt-5 pb-3">
          <div>
            <Eyebrow className="mb-3">PERIOD</Eyebrow>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["month", "This month"],
                  ["year", "This year"],
                  ["all", "All time"],
                ] as const
              ).map(([p, label]) => (
                <Pill key={p} active={periodIs(p)} className="min-h-11 px-4 text-[13px]" onClick={() => setPeriod(p)}>
                  {label}
                </Pill>
              ))}
            </div>
          </div>
          {!accountId ? (
            <div>
              <Eyebrow className="mb-3">ACCOUNT</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {state.accounts.map((a) => {
                  const on = accts.includes(a.id);
                  return (
                    <Pill
                      key={a.id}
                      active={on}
                      className="min-h-11 max-w-full px-4 text-start text-[13px] whitespace-normal"
                      onClick={() => setParams({ acct: (on ? accts.filter((x) => x !== a.id) : [...accts, a.id]).join(",") || null })}
                    >
                      {a.name}
                    </Pill>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div>
            <Eyebrow className="mb-3">CATEGORY</Eyebrow>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map((c) => (
                <Pill key={c} active={cat === c} className="min-h-11 px-4 text-[13px]" onClick={() => setParams({ cat: cat === c ? null : c })}>
                  {c}
                </Pill>
              ))}
            </div>
          </div>
          <Cta onClick={() => setFilterOpen(false)}>
            Show {matches.length} {matches.length === 1 ? "entry" : "entries"}
          </Cta>
        </div>
      </Sheet>
    </>
  );
}
