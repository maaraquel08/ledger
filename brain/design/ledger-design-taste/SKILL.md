---
name: ledger-design-taste
description: >-
  The house design taste for the Ledger mobile prototype: paper-and-ink surfaces, one yellow, gold
  for M8, flat bordered cards, mono eyebrows, bottom sheets for everything, and correct use of the
  Ledger primitives over the sc1m registry. Use it whenever you build, restyle or judge any UI in
  this repo: a new screen, sheet, card, state or empty state; translating a Claude Design study,
  Figma frame or raw HTML into the Ledger look; or checking that a prototype still looks like
  Ledger. Fills the `taste` slot for the Sova `design` skill. Not for copy (use ux-writing) or for
  store/parse logic with no visual surface.
---

# Ledger design taste

Ledger is a 430px mobile column that reads like a notebook: white paper, espresso ink, one yellow
button, and M8's gold whispers. The reference standard is **Home** (`src/screens/home.tsx`) with
the primitives in `src/components/ledger/`. When in doubt, match what Home and Activity already do.

Product facts (vocabulary, rules, users, decisions) live in `brain/`; read `brain/product.md` and
`brain/glossary.md` before naming anything. This skill only says how Ledger should look and move.

## Entry points

1. **From scratch.** A new screen, sheet or state. Compose from the primitives and tokens below so
   it is native on arrival.
2. **Translating a study.** A Claude Design artifact, Figma frame or vibecoded HTML arrives. Keep
   its structure and intent; replace every raw element with a Ledger primitive, every literal
   colour or size with a token, every custom overlay with `Sheet`.
3. **Judging.** A prototype drifted. Run the self-check at the end and name each miss with the
   token or primitive that fixes it.

Always read the ground truth first: `src/styles/brands/ledger.css`, `src/index.css`, and the
primitive you will use in `src/components/ledger/primitives.tsx`.

## The five taste principles

### 1. Paper and ink; decoration only where something is alive
The canvas is `bg-bg` white, flat, no shadows. Cards are a hairline border (`border border-line`,
`rounded-md` or `rounded-lg`), never elevated. Dividers are borders (`divide-y divide-line`), not
space. The only shadow is `shadow-overlay` under sheets and toasts. Colour appears when something
is alive: the yellow add button, the yellow rings of a listening orb, the espresso paint of an AI
card. A dense screen earns its hierarchy from type and hairlines, not from backgrounds.

### 2. One ink, one yellow, gold for M8, green in and red out
`--accent` is the espresso ink and carries every CTA (`Cta`), active tab, hero number and
selected pill. `--highlight` yellow is reserved for **act now**: the add button and the live voice
state. Yellow never carries text. Gold ink (`text-gold-ink`) with a `Sparkle` marks everything M8
says; AI panels use `AiPanel` / `AiCard` with `palette="ledger"` (espresso field, gold masses).
Money in is `text-success`, money out is `text-danger`, goals are `info`, "needs attention" is
`warning` border + gold text. Never raw Tailwind colours, never hex in a screen. Full map:
`references/design-tokens.md`.

### 3. Mono eyebrows, tabular numbers, system type
Two voices: the Helvetica Neue stack for reading, `ui-monospace` for labels. Every section opens
with an `Eyebrow` (9.5px mono, uppercase, `.16em`) or an `AiEyebrow`. Every amount is `tnum`,
`₱`, no decimals, typographic minus, via `peso()` / `signed()`. Display sizes are few and fixed:
hero 40px, page title 26px, h2 19px, row title 14.5px, body 14px, amounts 18px semibold, meta
10.5px mono. Weights 400 / 500 / 600 only. Keep at least three levels on a screen.

### 4. Everything secondary is a bottom sheet; everything primary is one tap
No modals, no second pages for small tasks. Pickers, edits, confirmations and "the math" open in
`Sheet` (22/30px corners, grabber, swipe to dismiss). Tab screens use `PageTitle`; detail screens
use `BackBar`; Home uses the date eyebrow and avatar. Primary actions are a full-width `Cta`, or a
sticky footer on non-tab screens. Lists are `EntryRow` under day headings. Empty states are a
19px line, one quoted example entry, and one `Cta`. No illustrations.

### 5. Touch-first, press feedback, motion only where the state changed
There are no hover styles. Rows dim on press (`active:opacity-60`), bordered controls tint
(`active:bg-surface`), the add button scales (`motion-safe:active:scale-[0.96]`). Screens enter with
`screen-in`. The orb and the AI paint are the only things that move on their own, and both stop
under `prefers-reduced-motion`. When adding or tuning motion, timing comes from transitions.dev
tokens; this skill only picks which recipe fits a moment. Full map:
`references/interaction-and-motion.md`.

## Working method

1. **Read the ground truth.** Tokens in `ledger.css`; the nearest existing screen; the primitive's
   source. Vocabulary from `brain/glossary.md`.
2. **Lay out the column.** `Screen` (tabbed or not), header pattern, `px-6` gutter, section
   rhythm `pt-6/7/8`, safe-area padding on anything that touches the bottom.
3. **Set the hierarchy first.** Eyebrow → title or hero number → rows → meta. Then colour, only
   where the principles allow it.
4. **Compose from primitives.** `Cta`, `Pill`, `Sheet`, `EntryRow`, `StatGrid`, `Segmented`,
   `CategoryChip`, `AiCard`. If a primitive is missing, propose it (closest existing, smallest
   change); do not hand-roll a button or input. `references/components.md`.
5. **Mark M8.** Any computed sentence gets an `AiEyebrow` or `AiCard` and one `AiMark` on the
   finding. Never more than one highlighted phrase.
6. **Add motion last,** with transitions.dev tokens and the reduced-motion guard.
7. **Run the self-check.** Then `better-interface` once for polish.

## Self-check before you finish

- No raw colours or hex; every colour is a Ledger token. Yellow only on the add button and live
  voice; gold only beside M8.
- Cards flat and bordered; only sheets and toasts cast a shadow.
- Type uses the fixed roles above; eyebrows are mono uppercase; amounts are `tnum` with `₱` and `−`.
- Secondary tasks live in `Sheet`; primary actions are a `Cta` or sticky footer with safe-area padding.
- Every interactive element is a Ledger primitive, 40px or taller to touch, with `aria-label` if icon-only.
- Every list of entries is `EntryRow`; every empty state follows the recipe.
- Press feedback present; no hover; new motion uses transitions.dev tokens and a reduced-motion guard.
- M8 copy is a fixed template with one `AiMark`; wording checked with `ux-writing` and `brain/glossary.md`.
- Nothing promises a network, a sync or a bank.

## Reference files

- `references/design-tokens.md`: the neutral ramp, semantic colours, radius, type roles, spacing
  and safe-area recipes, and the intent-to-token map.
- `references/components.md`: the primitives, their props and snippets, the sc1m components used
  and unused, the AI surface anatomy, icons, and the layout recipes with verbatim classes.
- `references/interaction-and-motion.md`: press feedback, orb phases, sheet and toast mechanics,
  accessibility conventions, and the known drift not to copy forward.
