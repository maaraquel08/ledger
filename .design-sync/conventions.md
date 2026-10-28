# Building with Ledger

Ledger is a 430px mobile column that reads like a notebook: white paper, espresso ink, one yellow
button, and gold for M8 (the assistant). Everything below is enforced by the shipped CSS and
components; read `styles.css` (tokens) and each component's `.prompt.md` before composing.

## 1. Wrap once, then build inside

Every design starts with the root wrapper. It scopes the brand tokens (also onto `<html>`, so
sheets that portal to `body` keep the brand), sets paper/ink defaults, and provides the store
and chrome context that `AddSheet`, `TabBar` and the AI surfaces read. Without it, components
render in the registry's orange fallback with a serif font.

```tsx
import { LedgerDesignSystem, Screen, PageTitle, Eyebrow, EntryRow, Cta } from "ledger";

<LedgerDesignSystem>
  <Screen tabbed>
    <PageTitle>Activity</PageTitle>
    <div className="px-6 pt-6">
      <Eyebrow className="mb-3">TODAY · 19 OCTOBER</Eyebrow>
      <EntryRow entry={entry} account={account} onClick={() => {}} />
    </div>
    <div className="px-6 pt-7"><Cta>Add an entry</Cta></div>
  </Screen>
</LedgerDesignSystem>
```

## 2. Compose from Ledger primitives, not raw elements

Use the component for the job; the registry parts exist but Ledger's own come first.

| Job | Use | Not |
|---|---|---|
| Screen column | `Screen` (`tabbed` when a `TabBar` is present) | a bare `div` |
| Tab-screen header / detail header | `PageTitle` / `BackBar` | custom headers |
| Section label | `Eyebrow`; `AiEyebrow` when M8 speaks | plain uppercase text |
| Main action | `Cta` (`variant="secondary"` for the quiet one) | `Button` |
| Small inline action | `ActionButton` | `Button` |
| Selectable option | `Pill` (`active`) | `Toggle` |
| 2–3 exclusive views | `Segmented` | `Tabs` |
| Any secondary task | `Sheet` (`open`, `title`) | `Drawer`, modals |
| A ledger entry | `EntryRow` with an `Entry` and `Account` | hand-built rows |
| Money | `Amount` (signed, coloured) or `peso()` / `signed()` / `balance()` | string math |
| Small stats | `StatGrid`; change chip `Delta` | tables |
| Anything M8 says | `AiCard` (label + body) or `AiPanel`, with ONE `AiMark` on the finding | plain text |
| Bottom nav + add button | `TabBar` with `path` | custom nav |
| Logging | `AddSheet` | custom forms |

## 3. Styling idiom: Tailwind utilities on semantic tokens

Colours are semantic classes, never hex or raw Tailwind palettes. Available classes (from
`styles.css`): `bg-bg`, `bg-surface`, `bg-surface-raised`, `bg-fill`, `bg-accent`, `bg-highlight`,
`text-fg`, `text-fg-muted`, `text-fg-subtle`, `text-accent-fg`, `text-highlight-fg`,
`text-gold-ink`, `text-success`, `text-danger`, `text-info`, `border-warning/60` (needs-attention edge), `border-line`,
`border-line-strong`, `border-accent`, `outline-ring`. Rules the app follows:

- Cards are flat and bordered: `rounded-md border border-line p-3.5` (or `rounded-lg`), no shadow.
- Lists divide with hairlines: `divide-y divide-line border-y border-line`; rows `min-h-12`.
- Yellow (`bg-highlight`) is for the add button and live voice only; it never carries text.
- Gold (`text-gold-ink`) and the `Sparkle` only appear beside M8's words.
- Money in is `text-success`, money out `text-danger`; amounts carry `tnum` and `₱`, no decimals,
  typographic minus.
- Type roles: hero `text-[40px] font-semibold tracking-[-0.04em]`, page title 26px (PageTitle),
  h2 `text-[19px] font-semibold tracking-[-0.01em]`, body `text-[14px] leading-[1.5]`, meta
  `font-mono text-[10.5px]`, eyebrow via `Eyebrow`. Weights 400/500/600 only. Inputs ≥16px.
- Gutter `px-6`; sections `pt-6` / `pt-7` / `pt-8`; sticky footers pad with
  `pb-[max(20px,env(safe-area-inset-bottom))]`.
- Press feedback, no hover: `active:opacity-60` on rows, `active:bg-surface` on bordered controls.
- Empty state: a 19px line, one quoted example entry ("“grab gcash 248” is enough."), one `Cta`.

## 4. Where the truth lives

- Tokens and utilities: `styles.css` (the brand layer `[data-brand="ledger"]` overrides the
  registry defaults).
- Component APIs and intent: `components/<group>/<Name>/<Name>.d.ts` and `.prompt.md`.
- Product vocabulary, rules and screens: `guidelines/` (say "entry", "log", "file", "Review",
  "today's number", "the math", "M8"; never "transaction"). Money rules there are not optional.
