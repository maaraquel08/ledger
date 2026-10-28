# Components: the Ledger vocabulary

Compose screens from these. Source: `src/components/ledger/primitives.tsx` (line numbers below), `chrome.tsx`, `icons.tsx`, `add-sheet.tsx`. Read the file before using a prop.

```tsx
import { Screen, BackBar, PageTitle, Eyebrow, EntryRow, Cta, Sheet, AiCard, AiMark } from "@/components/ledger/primitives";
import { TabBar, useChrome } from "@/components/ledger/chrome";
import { PlusIcon, Sparkle } from "@/components/ledger/icons";
import { Drawer } from "@/components/ui/drawer";   // rarely directly; use Sheet
```

## Primitives

| Primitive (line) | Props | Use when | Instead of |
| --- | --- | --- | --- |
| `Screen` :19 | `children, className, tabbed?` | root of every screen (430px column, `screen-in`, safe-top). `tabbed` reserves 84px for TabBar | hand-rolled `min-h-dvh` wrappers |
| `BackBar` :44 | `label, right?, onBack?` | detail / pushed screens | custom back buttons |
| `PageTitle` :60 | `children, right?` | tab screens' h1 + right icon buttons | bare `<h1>` |
| `Eyebrow` :69 | `children, className` | section label (mono caps) | `text-xs uppercase` |
| `AiEyebrow` :74 | `children, className` | label next to Sparkle for AI content | `Eyebrow` + manual gold |
| `Amount` :85 | `value, className, plain?` | any signed money: negative `text-danger`, else `text-success`; `plain` = no color | manual `peso()` + color |
| `ProviderMark` :95 | `provider, size=42, radius=10` | bank/wallet tile (logo, Chart/Cash icon, mono "?") | `ui/avatar` |
| `CategoryChip` :115 | `children, tone neutral\|warn` | category tag in a row; warn = needs category | `ui/badge` |
| `EntryRow` :132 | `entry, account?, meta?, onClick?` | ANY list of entries | custom rows |
| `Pill` :171 | `active?` + button props | filter / picker chips (`aria-pressed`) | `ui/toggle`, `ui/toggle-group` |
| `Cta` :194 | `variant primary\|secondary` + button props | the one full-width action on a screen/sheet | sc1m `Button` |
| `ActionButton` :211 | `variant primary\|secondary` | inline compact action (rounded-md) | sc1m `Button` |
| `Segmented<T>` :226 | `value, options, onChange` | 2-4 way mode switch (square ink control) | `ui/tabs`, `ui/toggle-group` direct |
| `Sheet` :253 | `open, onOpenChange, title?, icon?, children, className` | EVERY bottom surface | `ui/drawer` direct, modals |
| `StatGrid` :299 | `items[{label,value,tone?}]` | 2-4 stat cells in a bordered grid | ad hoc grids |
| `Delta` :312 | `value, invert?` | +/- change chip; `invert` flips good/bad | colored text |
| `AiPanel` :329 | `label, children, className` | AI surface, free-form children | raw `AiSummary` |
| `AiCard` :339 | `label, children, className` | AI surface with text body (14.5px/1.65) | raw `AiSummary` |
| `AiMark` :352 | `children, className` | the one finding phrase inside AI text | `<mark>` styling |
| `TabBar` chrome.tsx:29 | `path, fab = true` | tab screens; 4 icon-only tabs + FAB | custom nav |
| `AddSheet` add-sheet.tsx:33 | `open, accountId?, initialText?, initialDate?, onOpenChange` | the add flow; open via `useChrome().openAdd({accountId?, text?, date?})` | new add dialogs |

Key recipes (verbatim):

| Piece | Classes |
| --- | --- |
| Screen | `screen-in relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg` + `pt-[env(safe-area-inset-top)]` |
| BackBar | `flex items-center justify-between px-4 pt-3`; button `-ml-1 flex h-10 items-center gap-0.5 rounded-md pr-2 text-[15px] text-fg active:opacity-60`, ChevronLeft 20 |
| PageTitle | `flex items-center justify-between px-6 pt-4`; h1 `text-[26px] leading-[1.2] font-semibold tracking-[-0.02em]` |
| AiEyebrow | Sparkle 13 + `span.eyebrow !text-gold-ink`, `flex items-center gap-[7px]` |
| CategoryChip | `rounded-sm border px-1.5 py-0.5 font-mono text-[9.5px] font-medium tracking-[0.05em] whitespace-nowrap uppercase`; neutral `border-line-strong text-fg-muted`; warn `border-warning/60 text-gold-ink` |
| EntryRow | `flex w-full items-center gap-3.5 text-left active:opacity-60`; meta row `mt-[7px] flex flex-wrap items-center gap-2`; refunded `line-through opacity-60` |
| Pill | `rounded-[18px] border px-3 py-[7px] text-[11.5px] whitespace-nowrap transition-colors duration-fast`; active `border-accent bg-accent font-medium text-accent-fg`; idle `border-line-strong text-fg active:bg-surface` |
| Cta | `w-full rounded-lg py-4 text-center text-[14.5px] font-semibold transition-colors duration-fast`; primary `bg-accent text-accent-fg active:bg-accent-hover disabled:bg-fill disabled:text-fg-subtle`; secondary `border border-line-strong text-fg active:bg-surface` |
| ActionButton | `rounded-md px-[17px] py-[11px] text-[13px]`; primary `bg-accent font-semibold text-accent-fg active:bg-accent-hover` |
| Sheet popup | `max-h-[88dvh] max-w-[410px] overflow-y-auto overscroll-contain rounded-t-[22px] rounded-b-[30px] border-0 px-[22px] pt-2.5 pb-5 shadow-overlay mb-[env(safe-area-inset-bottom)]`; grabber `h-1 w-[38px]`; title `text-[15px] font-semibold`; close `size-[26px] rounded-full bg-surface text-fg-subtle` + `after:-inset-[9px]` (44px hit) |
| StatGrid | `grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-y-3 rounded-md border border-line py-[13px]`; label mono `text-[9.5px] font-semibold tracking-[0.1em] text-fg-subtle uppercase` |
| Delta | `border px-[5px] py-px font-mono text-[10.5px] font-semibold`, square, typographic minus |
| Segmented | `TabsList gap-0 rounded-none border border-accent bg-bg p-0`; tab `z-1 rounded-none py-2 text-[12px] data-active:bg-accent data-active:font-semibold data-active:text-accent-fg`, `border-l border-accent` between |

Snippets:

```tsx
<Screen tabbed>
  <PageTitle right={<button aria-label="Search" className={ICON_BTN}><SearchIcon /></button>}>Activity</PageTitle>
  <Eyebrow className="px-6 pt-7">{dayHeading(d)}</Eyebrow>
  {entries.map((e) => <EntryRow key={e.id} entry={e} account={a} onClick={() => open(e)} />)}
  <AiCard label="This week" className="mx-6 mt-6">
    You spent <AiMark>₱3,240</AiMark> on food.
  </AiCard>
  <TabBar path="/activity" />
</Screen>

<Sheet open={open} onOpenChange={setOpen} title="Sort">
  <Pill active={s === "new"} onClick={() => setS("new")}>Newest</Pill>
  <Cta className="mt-3" onClick={apply}>Apply</Cta>
</Sheet>
```

## sc1m `ui/*` (Base UI registry, `src/components/ui/`)

| Component | Status | Why Ledger has its own |
| --- | --- | --- |
| `ai-summary` | USED, modified (local `ledger` palette :144-164) | wrapped by AiPanel/AiCard/AiMark |
| `drawer` | USED via `Sheet` | Sheet overrides radius, width, padding, border, grabber |
| `tabs` | USED via `Segmented` with heavy overrides | square ink control |
| `button` | unused | `Cta` / `ActionButton` (hover styles, h-8/9/10; Ledger is touch-first, 52px CTA) |
| `badge` | unused | `CategoryChip`, `Delta` |
| `banner` | unused | offline banner hand-rolled (`home.tsx:~255`) |
| `input` | unused | h-9 stock; screens hand-roll 16px inputs |
| `progress` | unused | screens draw own bars |
| `avatar` | unused | initials avatar hand-rolled; `ProviderMark` |
| `toggle`, `toggle-group` | unused | `Pill`, `Segmented` |

Do not reach for an unused one; reuse the Ledger primitive. If none fits, extend primitives.tsx, do not mix sc1m styling in.

## AI surface anatomy

One `AiCard` (or `AiPanel`) = label (`AiSummaryLabel`, mono 9.5px, `.16em`) + body + exactly one `AiMark` on the finding phrase (the number or the verdict, a short phrase, never a sentence). Always `palette="ledger"` (done inside AiPanel; never pass another palette). Espresso field with gold masses, text `text-bg/[0.86]`, `AiSummary` is `relative isolate overflow-hidden rounded-lg bg-fg`, inner `px-[22px] pt-5 pb-[22px]`. Placement: `className="mx-6 mt-6"` (`mt-8` for "M8's note"). Persona is **M8**, first person ("I").

Local palette note, verbatim (`ai-summary.tsx:144-146`): "Ledger: espresso field, gold masses — the brand's ink and yellow as paint. Added locally; re-add this entry if the component is re-pulled." WARNING: re-pulling `ai-summary` from the sc1m registry deletes the `ledger` palette and AiPanel falls back to default paint. Re-add it from the source file (stops `#15120c / #252017 / #33291a / #17130d`; masses `#d9a400`, `#8a7000`, `#fcc305`, `#0d0b07`). Other palettes (ember :63, tide :84, moss :106, ink :128) are unused by Ledger. `.ai-wash` / `.ai-pulse` in `index.css:182-214` are blue sc1m leftovers; do not use.

## Icons (`icons.tsx`)

Hand-drawn inline SVG, no icon library. Helper `stroke(size = 20, props)` (:5-16): `viewBox 0 0 24 24`, `fill none`, `stroke currentColor`, `strokeWidth 1.6`, round caps and joins, `aria-hidden`. Overrides: 1.8 (CloseIcon, PlusIcon, ScanIcon), 2 (ArrowUpIcon, CheckIcon). Color comes from `currentColor`; size via `size` prop.

| Icon | Default size | Note |
| --- | --- | --- |
| HomeIcon, ActivityIcon, AccountsIcon, InsightsIcon | 20 | `filled` prop = active nav |
| ChartIcon, CashIcon | 17 | ProviderMark fallback at 0.42*size |
| SearchIcon, SortIcon, MicIcon, CameraIcon, MoreIcon | 18 | MoreIcon filled dots r=1.6 |
| ChevronLeft, ChevronRight | 18 | BackBar uses 20 |
| CloseIcon | 14 | Sheet uses 12 |
| PlusIcon | 18 | FAB uses 26 |
| ArrowUpIcon, CheckIcon | 16 | send, toast (14) |
| ScanIcon | 22 | |
| Sparkle | 13 | only beside AI eyebrows; gradient `#f5c518` -> `#d9a400` hard-coded |

Active nav uses filled variants. Sparkle belongs only in `AiEyebrow`. Do not add an icon library; draw with `stroke()`.

## Layout patterns (verbatim)

| Pattern | Classes |
| --- | --- |
| Screen column | `mx-auto w-full max-w-[430px] min-h-dvh` (via `Screen`) |
| Home header | `flex items-center justify-between px-6 pt-4` with `eyebrow` date ("MONDAY 9 AUG") + avatar `size-[30px] rounded-full border border-line-strong font-mono text-[10px] font-semibold` inside a `size-10` hit target |
| Tab header | `PageTitle` |
| Detail header | `BackBar` |
| Chat header | `sticky top-0 z-10 bg-bg/95 backdrop-blur-sm` (chat.tsx:426) |
| Icon button | `ICON_BTN = "flex size-10 items-center justify-center rounded-full text-fg active:bg-surface"` (activity.tsx:31); group `-mr-2.5 flex items-center` |
| List rows + day headings | `EntryRow` under `dayHeading()` eyebrow ("TODAY · 10 AUGUST"); dividers `divide-y divide-line border-y border-line`, rows `min-h-12` |
| Bordered flat card | `rounded-md border border-line p-3.5`; tappable `flex min-h-[64px] items-center gap-3.5 rounded-lg border border-line px-4 text-left active:bg-surface` |
| Inverted ink card | `mx-5 mb-3 rounded-[18px] bg-accent p-4 text-accent-fg screen-in` (home.tsx:668,711) |
| Section header | `eyebrow` (`mt-5..7`) or h2 `mt-7 text-[19px] leading-[1.3] font-semibold tracking-[-0.01em]` |
| Empty state | `flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center`; h2 19px; body `mt-2.5 max-w-[260px] text-[14px] leading-[1.5] text-fg-muted` with a quoted example; `<Cta className="mt-7 max-w-[280px]">`; soft link `mt-4 flex min-h-10 items-center text-[13px] text-fg-subtle`. No illustrations (activity.tsx:161-176) |
| Sticky footer (plain) | `sticky bottom-0 bg-bg px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]` |
| Sticky footer (fade) | `sticky bottom-0 mt-auto bg-gradient-to-t from-bg from-70% to-transparent px-6 pt-4 pb-[max(24px,env(safe-area-inset-bottom))]` (activity.tsx:740) |
| Chat composer | `sticky bottom-0 z-10 border-t border-line bg-bg px-4 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))]` (chat.tsx:589) |
| Search pill | `flex h-[50px] ... rounded-[26px] border border-line-strong bg-bg pr-1.5 pl-[18px] focus-within:border-accent` |
| Form input | `h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] ... outline-none focus:border-accent` (activity.tsx:30, accounts.tsx:27) |
| Add-sheet input | `h-14 min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-4 text-[20px] outline-none placeholder:text-mute focus:border-accent` (add-sheet.tsx:247) |
| Offline banner | `border-b border-danger/15 bg-[color-mix(in_oklab,var(--color-danger)_5%,var(--color-bg))] px-6 py-2.5 text-[12px] text-danger`, `role="status"` (home.tsx:~255) |
| TabBar | `fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] border-t border-line bg-bg/95 backdrop-blur-sm`; tab `flex min-h-11 flex-col items-center gap-[3px] py-1`, active `text-fg` + filled icon + `size-1` dot `bg-fg` |
| FAB | `absolute right-5 bottom-[calc(100%+14px)] flex size-[60px] items-center justify-center rounded-full bg-highlight text-highlight-fg`, PlusIcon 26, `aria-label="Add entry"` |
