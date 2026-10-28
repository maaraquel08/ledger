# Design Tokens: the Ledger semantic layer

Source of truth: `src/styles/brands/ledger.css` (brand) and `src/index.css` (sc1m base + `@theme inline` exposure). Read them before applying a token. This file is an *intent -> token* map; the CSS wins if they diverge. Use the Tailwind utility, not the raw var. Citations are `file:line` relative to `src/`.

## Golden rules

1. No raw Tailwind colors (`text-gray-500`, `bg-green-100`) and no hex in screens. Blends use `color-mix(in oklab, var(--color-x) N%, ...)`. Only exception: the AI paint palettes (`components/ui/ai-summary/ai-summary.tsx:18-21`, "paint, not semantics") and the Sparkle gradient (`components/ledger/icons.tsx:151-152`).
2. Minus is the typographic `−` (U+2212), never a hyphen. Use `signed()`.
3. Money is `₱`, no decimals, via `peso()` / `signed()` / `compact()` (`lib/format.ts:1-15`). Never "PHP". Keypad in the add sheet is the only place cents appear.
4. Amounts always carry `tnum`.
5. Weights are 400 / 500 (`font-medium`) / 600 (`font-semibold`) only.

## How the brand is applied

| Fact | Where |
| --- | --- |
| Brand switch is `data-brand="ledger"` on `<html>` | `index.html:2` |
| Brand tokens live in `[data-brand="ledger"]` | `ledger.css:11-74`, imported `index.css:242` |
| sc1m base contract in `:root` | `index.css:83-134` |
| Ledger wins over `:root` by source order (both 0,1,0) | `index.css:242` after `:root` |
| Tailwind exposure: `@theme inline` | `index.css:5-33`, Ledger extras `index.css:245-256` |
| Dark CSS exists: `[data-brand="ledger"].dark` | `ledger.css:78-102` |
| Dark is NOT wired: nothing adds `.dark` (no toggle, no matchMedia) | grep `src` |
| `theme-color` meta hard-coded `#ffffff` | `index.html:8` |

Dark needs `class="dark"` on the same element as `data-brand` (html). Design light-only; do not add `dark:` variants as if they work.

## Neutral ramp (Ledger light / dark), `ledger.css`

| Var | Intent word | Light | Dark | Line |
| --- | --- | --- | --- | --- |
| `--n-0` | canvas (page backdrop >520px) | #eceae6 | #0f0d0a | :13 / :79 |
| `--n-50` | weak (surface, focused input fill) | #f7f6f4 | #1d1a15 | :14 / :80 |
| `--n-100` | fill (tracks, disabled CTA) | #ececea | #26221c | :15 / :81 |
| `--n-200` | line | #e6e4e0 | #2e2a23 | :16 / :82 |
| `--n-300` | edge (chip / secondary borders) | #dcdad6 | #3a352d | :17 / :83 |
| `--n-400` | mute (placeholder) | #b5b5b5 | #6b665e | :18 / :84 |
| `--n-500` | quiet (eyebrows, meta) | #6e6e6e | #9a958c | :19 / :85 |
| `--n-700` | body | #5a5a5a | #c4bfb6 | :20 / :86 |
| `--n-900` | ink (espresso) | #252017 | #f5f2ec | :21 / :87 |

Brand primitives (`ledger.css:24-27, 89-91`): `--ledger-ink` #252017, `--ledger-paper` #ffffff (dark #15120e), `--ledger-yellow` #fcc305 (no dark override), `--ledger-gold-ink` #7a6300 (dark #e3c04a). sc1m orange is inherited but never referenced.

## Semantic color tokens -> Tailwind utility

| Token | Utility | Light value | Intent | Line |
| --- | --- | --- | --- | --- |
| `--bg` | `bg-bg` | #fff (paper) | page background | :30 |
| `--surface` | `bg-surface` | n-50 | pressed state, close button, keypad keys | :31 |
| `--surface-raised` | `bg-surface-raised` | paper | raised panels | :32 |
| `--fg` | `text-fg` | #252017 | primary text | :33 |
| `--fg-muted` | `text-fg-muted` | #5a5a5a | body / secondary | :34 |
| `--fg-subtle` | `text-fg-subtle` | #6e6e6e | eyebrow, meta, empty values | :35 |
| `--line` | `border-line` | n-200 | flat card and divider borders | :36 |
| `--line-strong` | `border-line-strong` | n-300 | control / chip / input borders | :37 |
| `--accent` | `bg-accent` `text-accent` | ink #252017 | every CTA, active nav, hero number (ink, not a hue) | :40 |
| `--accent-hover` | `bg-accent-hover` | #3b3428 | primary press (`active:`) | :41 |
| `--accent-fg` | `text-accent-fg` | #ffffff | text on ink | :42 |
| `--highlight` | `bg-highlight` | #fcc305 | add button, live voice state, AiMark | :43 |
| `--highlight-fg` | `text-highlight-fg` | ink | text on yellow | :44 |
| `--ring` | `outline-ring` | ink | focus outline | :45 |
| `--success` | `text-success` | #0f7a45 | money in, gains, headroom | :60 |
| `--danger` / `--danger-fg` | `text-danger` | #c0362a / #fff | spend, overspend, losses | :61-62 |
| `--info` | `text-info` | #0f4fb0 | goals | :63 |
| `--warning` | `border-warning/60` | #d9a400 | needs-attention borders (pair with gold-ink text) | :64 |
| gold-ink | `text-gold-ink` | #7a6300 | AI eyebrow text, "Choose"/unset values, warn chips | `index.css:245` |
| canvas | `bg-canvas` | n-0 | page backdrop above 520px | `index.css:272` |
| fill | `bg-fill` | n-100 | tracks, disabled CTA, key press | `index.css:245-256` |
| mute | `text-mute` | n-400 | placeholder only | same |

No `--warning-fg`, `--success-fg`, `--info-fg` exist. `--brand-icon` (#252017) / `-fg` (#fcc305) exist (`ledger.css:48-49`) but are unused by components.

Camera set (theme-stable, always dark, never flips; `ledger.css:51-57`): `bg-cam` #14110c, `bg-cam-sheet` #252017, `bg-cam-cell` #2d281f, `border-cam-line` #3a342a, `text-cam-ink` #f2f1ef, `text-cam-muted` #a59f93. Scan overlay only.

## Which token for which intent

| Intent | Token |
| --- | --- |
| Money in, income, gain, headroom | `text-success` |
| Money out, spend, overspend, loss, offline banner | `text-danger` |
| Goals | `text-info` |
| AI text / AI eyebrow | `text-gold-ink` (+ `AiEyebrow`) |
| Primary CTA, active nav, active Pill, hero number | `bg-accent` / `text-fg`, ink |
| Hero number when over budget | `text-danger` |
| No budget hero | `₱—` in `text-fg-subtle` |
| Add (FAB) | `bg-highlight text-highlight-fg` |
| Live voice state (orb, rings) | `bg-highlight`, `/8`, `/20`, `/45` |
| Finding inside an AI statement | `AiMark` (yellow, ink text) |
| Needs-attention chip | `border-warning/60 text-gold-ink` |
| Placeholder | `placeholder:text-mute` |
| Flat card border | `border-line`; chip/control border `border-line-strong` |
| Disabled CTA | `disabled:bg-fill disabled:text-fg-subtle` |

## Radius (`ledger.css:67-70`, mapped `index.css:27-30`)

| Class | Value | Use |
| --- | --- | --- |
| `rounded-sm` | 5px | CategoryChip, tiny tags |
| `rounded-md` | 10px | ActionButton, StatGrid, keypad keys, small cards, BackBar button |
| `rounded-lg` | 12px | Cta, large bordered cards, inputs in add sheet, AiSummary |
| `rounded-xl` | 22px | sc1m Drawer default (Sheet overrides) |
| `rounded-full` | pill | icon buttons, FAB, toast, close button |

Sanctioned extras: `rounded-[18px]` for Pill, filter chips, ink receipt card (`primitives.tsx` Pill, `home.tsx:668,711`); Sheet corners `rounded-t-[22px] rounded-b-[30px]` (`primitives.tsx:272`); search pill `rounded-[26px]` at h-[50px].
Avoid (ad hoc drift): 27/28/14/9/6/4/3/2px (`rounded-[28px]` scan sheet, `[14px]` scan toast). Delta and Segmented are intentionally square; AiMark is `rounded-[3px]`.

## Type

| Item | Value | Line |
| --- | --- | --- |
| Sans | `"Helvetica Neue", Helvetica, Arial, sans-serif` (Arial off-Apple; no web fonts, no Geist) | `ledger.css:71` |
| Mono (label voice) | `ui-monospace, Menlo, monospace` | `ledger.css:72` |
| `.eyebrow` | `font: 600 9.5px/1.2 var(--font-mono); letter-spacing: .16em; text-transform: uppercase; color: var(--color-fg-subtle)` | `index.css:275-280` |
| `.tnum` | `font-variant-numeric: tabular-nums` | `index.css:274` |

| Role | Recipe | Cite |
| --- | --- | --- |
| Hero number | `tnum text-[40px] leading-none font-semibold tracking-[-0.04em]` | home.tsx TodayNumber |
| Hero sub | `text-[14px] whitespace-nowrap text-fg-subtle` | home.tsx |
| Welcome h1 | `text-[34px] leading-[1.1] font-semibold tracking-[-0.032em] text-balance` | welcome.tsx:70 |
| Page title (h1) | `text-[26px] leading-[1.2] font-semibold tracking-[-0.02em]` | primitives.tsx:63 |
| h2 empty state | `text-[19px] leading-[1.25] font-semibold tracking-[-0.01em] text-balance` | activity.tsx:168 |
| h2 section | `mt-7 text-[19px] leading-[1.3] font-semibold tracking-[-0.01em]` | insights.tsx:525 |
| Row title | `text-[14.5px] leading-[1.3]` | primitives.tsx:149 |
| Body | `text-[14px] leading-[1.5] text-fg-muted` | activity.tsx:169 |
| AI body | `text-[14.5px]/[1.65]` | primitives.tsx:342 |
| Meta (mono) | `text-[10.5px] font-medium tracking-[0.05em]` | primitives.tsx EntryRow |
| Eyebrow | 9.5px mono, `.16em` | index.css:275 |
| Row amount | `text-[18px] font-semibold tracking-[-0.01em]` | EntryRow |
| Stat value | `tnum mt-1.5 text-[15px] font-semibold` | StatGrid |
| Keypad amount | `tnum text-[44px] leading-none font-semibold tracking-[-0.02em]` | add-sheet.tsx |
| Inputs | `text-[16px]` minimum (iOS no-zoom); add-sheet main input 20px | |

No `text-xs/sm` in Ledger code. Do not invent new half-pixel sizes; pick the nearest role above.

## Shadows

Cards are flat (border, no shadow). `shadow-overlay` = `0 8px 34px rgb(0 0 0 / 0.2)` (`ledger.css:73`) is for Sheet and toast only. `shadow-raised` (`index.css:31`) is only the Tabs indicator. Sanctioned ad hoc: FAB `shadow-[0_8px_20px_color-mix(in_oklab,var(--color-highlight)_45%,transparent)]` (`chrome.tsx:41`), orb rings `0_0_0_16px` (highlight 18%) + `0_0_0_32px` (7%) (`home.tsx`). Receipt photo `shadow-[0_10px_30px_rgba(0,0,0,.4)]` (`scan.tsx:318`) is raw; do not copy.

## Spacing and safe area

| Convention | Value | Cite |
| --- | --- | --- |
| Screen gutter | `px-6` (24px), 48 uses | screens |
| Narrow gutters | `px-5` home input row / onboarding footer; `px-4` BackBar, chat footer; `px-8` empty states | |
| Section top | `px-6 pt-6` (x11), `pt-7`, `pt-8`; `mt-7` between sections | |
| Safe top | `pt-[env(safe-area-inset-top)]` | primitives.tsx:33 |
| Tabbed bottom | `pb-[calc(84px+env(safe-area-inset-bottom))]` | primitives.tsx:34 |
| TabBar inner | `pb-[max(14px,env(safe-area-inset-bottom))]` | chrome.tsx:46 |
| Sheet | `mb-[env(safe-area-inset-bottom)]` | primitives.tsx:273 |
| Sticky CTA | `pb-[max(20px,env(safe-area-inset-bottom))]` (24 fade, 12 chat, 32 scan) | onboarding.tsx:122, activity.tsx:740, chat.tsx:589 |
| Toast | `top-[max(12px,env(safe-area-inset-top))]` | add-sheet.tsx:370 |
| Scroll pad | `scroll-padding-bottom: calc(96px + env(safe-area-inset-bottom))` | index.css:270 |

Touch targets: `size-10`/`h-10` common, `min-h-11` tabs, `min-h-12` rows/keys. Viewport is one 430px column (`max-w-[430px]`); above 520px the body is `canvas` (`index.css:272`).

## z-index (raw, no tokens)

| z | Where |
| --- | --- |
| `z-1` | Segmented tab (`primitives.tsx:235`) |
| `z-10` | chat sticky header and footer |
| `z-20` | TabBar (`chrome.tsx:34`) |
| `z-30` | scan overlay (`scan.tsx:98`) |
| `z-[100]` | add-sheet toast (`add-sheet.tsx:370`) |

Drawer layers (Base UI portal) have no explicit z. Reuse these values; do not add new ones without reason.
