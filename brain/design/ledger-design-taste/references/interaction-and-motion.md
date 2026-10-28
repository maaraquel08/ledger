# Interaction and Motion: the house feel

Ledger is touch-first, quiet, and flat. Motion confirms; it never decorates. Source: `src/index.css:179-295` and the components cited below.

## Timing ownership

transitions.dev tokens own ALL timing when motion is added or tuned (use the `transitions-dev` / `transitions-polish` skills for values). This file only says WHICH recipe fits a moment. Do not invent durations or easings here.

Current literal durations, treat as debt to map to tokens (do not copy forward as new literals):

| Literal | Where |
| --- | --- |
| 150ms (`--duration-fast`) | Pill/Cta/ActionButton color, FAB scale, Drawer, backdrop, Tabs indicator (`index.css:34`) |
| 220ms | `.screen-in` (`index.css:292`) |
| 250ms | `--popup-open-dur`, accordion tokens (`index.css:122-131`), add-sheet input focus delay |
| 300ms | `.toast-nudge`; `duration-300` x4 |
| 500ms | `duration-500` x1 (bars/rings) |
| others | `duration-200` x1; 1.4s skeleton; 900ms wave; 40s tape; 2600ms toast timer |

Easings in use: `--popup-ease cubic-bezier(0.22, 1, 0.36, 1)` (screen-in, toast-nudge), `--ease-out-quad cubic-bezier(0.25, 0.46, 0.45, 0.94)` (Drawer, Tabs), plus ad hoc `ease-out`, `ease-in-out`. Unused: `popup-motion` utility (`index.css:158-178`), `--acc-*` tokens.

## Moment -> recipe

| Moment | Recipe | Cite |
| --- | --- | --- |
| Tappable text row | `active:opacity-60` | EntryRow, BackBar |
| Bordered card / secondary button / idle Pill / icon button | `active:bg-surface` | primitives.tsx, `ICON_BTN` |
| Primary button | `active:bg-accent-hover` | Cta, ActionButton |
| Keypad key | `active:bg-fill` | add-sheet.tsx |
| FAB | `transition-transform duration-fast ease-out motion-safe:active:scale-[0.96]` | chrome.tsx:41 |
| Color change on controls | `transition-colors duration-fast` | Pill, Cta, ActionButton |
| Screen arrives | `screen-in` on `Screen` (also toasts, ink receipt card, scan toast) | index.css:291-292 |
| Bottom surface | `Sheet` (swipe-down) | primitives.tsx:253 |
| Loading content | `.skeleton` | index.css:286-290 |
| AI surface at rest | SMIL paint drift | ai-summary.tsx:176-191 |
| Confirmation | toast, top, pill | add-sheet.tsx:370 |
| Listening | orb + waveform | home.tsx:416-446 |
| Width / height / grid-rows changes (bars, accordion, rings) | `motion-safe:transition-[width|height|grid-template-rows|stroke-dasharray]` | screens |

No hover styles anywhere in Ledger code (sc1m `Button` has hover; it is unused). Never add `hover:` to a Ledger control.

## Entrance: `screen-in`

`@keyframes ledger-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }` and `.screen-in { animation: ledger-in 220ms var(--popup-ease); }` (`index.css:291-292`). Disabled under reduced motion with `!important` (`index.css:293-295`).

## Sheet mechanics (`Sheet` over sc1m Drawer)

| Aspect | Value | Cite |
| --- | --- | --- |
| Dismiss | swipe down (`translateY(var(--drawer-swipe-movement-y))`), tap backdrop, close button | drawer.tsx |
| Transition | `transition-[transform,opacity] duration-fast ease-out-quad` (150ms) | drawer.tsx |
| Enter / exit | `translateY(calc(100%+1rem))` | drawer.tsx |
| Reduced motion | opacity only (`motion-safe:` / `motion-reduce:`) | drawer.tsx |
| Backdrop | `bg-black/40 transition-opacity duration-fast` | drawer.tsx |
| Grabber | `h-1 w-[38px]` (forced by Sheet) | primitives.tsx:253 |

## Hold-to-talk orb (`home.tsx`)

Phase machine (`home.tsx:24-30`): `idle` (with optional `hint`) -> `listening` -> `finishing` (release) or `cancelling` (slide left past `CANCEL_PX`, reversible) -> `reading` -> commit; `error` with `kind` (`denied | no-speech | unsupported | network | other | offline-question`). Press starts, release sends, slide-away cancels (`lib/voice.ts`, `lang = "en-PH"`).

| Phase | Visual |
| --- | --- |
| listening | `Orb size 200 tone "loud"`, `Wave`, red dot `size-[7px] bg-danger motion-safe:animate-pulse`, eyebrow "Listening · release to send", hint "Slide left to cancel" |
| finishing | same, text "…", eyebrow "Sending…" |
| cancelling | `Orb size 172 tone "off"`, "✕" in `text-fg-subtle`, heard text `line-through`, eyebrow `!text-danger` "Release to discard" |
| live-state rings | yellow: `shadow-[0_0_0_16px_color-mix(...highlight 18%...),0_0_0_32px_color-mix(...7%...)]`; `bg-highlight/8`, `/20`, `/45` |

Heard text: `<p aria-live="polite" class="min-h-[60px] px-8 text-center text-[22px] leading-[1.4] font-medium tracking-[-0.02em] text-pretty">`; `text-fg-subtle` until words arrive. Stage column `flex flex-1 flex-col items-center justify-center gap-[30px]`. Auto-commit after `READ_MS + items.length * 250` ms in `reading`.

## Skeleton, AI paint, waveform, tape

| Piece | Recipe | Cite |
| --- | --- | --- |
| Skeleton | `linear-gradient(90deg, fill 25%, surface 50%, fill 75%)`, `background-size: 200% 100%`, `ledger-shimmer 1.4s linear infinite` | index.css:286-290 |
| AI paint drift | SMIL `<animate>` per mass 25-84s (ledger: cx 49s, ry 55s, opacity 37/63s), noise freq 42s, displacement scale 54s, `driftDur: 58`; CSS `.vf-drift` 38s, `.vf-shimmer` 11s (opacity .45<->.7). SMIL removed from the DOM under reduced motion | ai-summary.tsx:176-191, index.css:227-234 |
| Waveform | `ledger-wave`: `scaleY(.45 -> 1)`, `900ms ease-in-out infinite alternate`, per-bar delay `(i*67)%600ms`, `motion-safe:` | home.tsx:639, index.css:295 |
| Welcome marquee | `ledger-tape` `translateY(0 -> -50%)` 40s linear infinite, `[data-tape]` | welcome.tsx:63 |

## Toast recipe

`fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] z-[100] mx-auto flex w-fit max-w-[calc(100%-32px)] items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-fg shadow-overlay screen-in`, CheckIcon 14, auto-dismiss 2600ms (`add-sheet.tsx:370`). Copy terse: "Expense saved · ₱248" (+ " · waiting to sync" offline). Give it `role="status"`.

## Accessibility conventions to keep

| Convention | Rule | Cite |
| --- | --- | --- |
| Icon-only controls | always `aria-label` (43 uses); icons are `aria-hidden` | stroke() |
| Toasts, banners, helper text | `role="status"` (danger/blocking: `role="alert"`) | add-sheet.tsx, home.tsx |
| Voice stage | `aria-live="polite"` | home.tsx:422 |
| Toggle buttons | `aria-pressed` (Pill, mic) | primitives.tsx:171 |
| Nav | `<nav aria-label="Main">`, `aria-current="page"` | chrome.tsx |
| Route change | `document.title = "{Route} · Ledger"` and `mainRef.current?.focus({preventScroll:true})` | App.tsx:~55-60 |
| Inputs | `text-[16px]` minimum (no iOS zoom); never disable viewport scaling | |
| Targets | 40px min (`size-10`), tabs `min-h-11`, rows `min-h-12`; small visuals extend hit area (`after:-inset-[9px]`); Pill needs `min-h-10` from caller | primitives.tsx:285 |
| Reduced motion | `motion-safe:` on loops and press-scale; `@media (prefers-reduced-motion: reduce)` kills `.skeleton, .screen-in, [data-tape]`; Drawer opacity-only; SMIL removed | index.css:216-226, 293-295 |
| Tap-to-top | active tab scrolls top, `behavior: auto` when reduced | chrome.tsx |
| Focus on custom inputs | if you use `outline-none`, you must supply `focus:border-accent` and ideally `focus-visible:outline-2 outline-offset-2 outline-ring` | add-sheet.tsx camera label |

## Known drift: do NOT copy forward

| Drift | Detail | Cite |
| --- | --- | --- |
| Yellow beyond FAB | brand comment says add button only; `bg-highlight` used 15x (orb, rings, voice stage). Allowed uses are add button, live voice state, AiMark. Do not spread it to CTAs, badges, or decoration | ledger.css:5-6,43 |
| Radius soup | 18/26/27/28/14/9/6/4/3/2px ad hoc beside the 5/10/12/22 ramp | scan.tsx:335 |
| Focus-visible missing | Pill, Cta, ActionButton, EntryRow, tab buttons have no focus style; no global `:focus-visible`; `outline-none` x9 | primitives.tsx |
| Placeholder contrast | `text-mute` #b5b5b5 on white is about 2:1 | add-sheet.tsx:247 |
| Dark unwired | `.dark` CSS dead; hard-coded hex (Sparkle, receipt shadow, welcome fade, heat colors) and AI veil from `--fg` would break | ledger.css:78-102 |
| Gutter variance | px-6 default vs px-5 / px-4 / px-8; BackBar `px-4` does not align with PageTitle `px-6` | primitives.tsx:44,60 |
| Duplicated speech | add-sheet has its own SpeechRecognition (`interimResults false`) beside `useVoice` | add-sheet.tsx:90-123 |
| Send glyph | literal "↑" instead of `ArrowUpIcon` | home.tsx:~330 |
| Other | three CTA heights, four input heights (h-11/12/14/[50px]), 25 arbitrary font sizes, `ai-wash`/`ai-pulse` blue leftovers, raw z-index, mixed easings, unguarded `animate-pulse` x3 / `animate-spin` x1, tab bar has no visible labels | inventory section 9 |
