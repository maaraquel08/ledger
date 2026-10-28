---
type: fact
status: draft
updated: 2026-10-19
related: [constraints, D-0003]
---

# Design system (external)

Ledger consumes the **sc1m** design system plus a Ledger brand layer, and the taste for composing them lives in the `ledger-design-taste` skill. This brain points at them and never copies them.

```yaml
name: sc1m + Ledger brand layer
repo: https://github.com/maaraquel08/sc1m        # components installed from the @sc1m shadcn registry
entry: src/index.css                              # token contract, merged; brand at src/styles/brands/ledger.css
pinned: as installed on 2026-10-05 (no lockfile for the registry)
taste: brain/design/ledger-design-taste/SKILL.md   # the Sova taste slot; symlinked from .claude/skills/
claude_design: https://claude.ai/design/p/cb67ab0a-4a18-49b6-b505-37d4b1e32b10   # synced by /design-sync; inputs in .design-sync/, entry src/ds/
```

**`ds:` references** resolve as follows:

| Brain ref | Lives at |
|---|---|
| `ds:<primitive>` (screen, sheet, cta, pill, entry-row, ai-card, stat-grid, segmented, tab-bar…) | `src/components/ledger/primitives.tsx`, `chrome.tsx`, `add-sheet.tsx`; documented in `ledger-design-taste/references/components.md` |
| `ds:<sc1m component>` (ai-summary, drawer, tabs, button, badge, banner, input, progress, avatar, toggle, toggle-group, switch) | `src/components/ui/<name>/` |
| `ds:tokens` | `src/styles/brands/ledger.css` over `src/index.css`; map in `ledger-design-taste/references/design-tokens.md` |
| `ds:motion` | transitions.dev recipes installed per snippet in `src/index.css` (`22-toast` so far: `--toast-*` tokens); the universal `_root.css` is not imported because its `--duration-fast` collides with sc1m's; other literal durations are debt; house recipes in `ledger-design-taste/references/interaction-and-motion.md` |
| `ds:voice` | no voice guide exists; inferred rules in the taste skill; wording via `ux-writing` |
| `ds:a11y` | conventions in `interaction-and-motion.md`; review with `better-accessibility` |

**Precedence.** sc1m wins on anything reusable; the Ledger brand layer overrides only tokens (neutral ramp, semantic colours, radii, fonts, overlay shadow). Ledger primitives exist where sc1m's component did not fit a 430px touch surface (Cta, Pill, Sheet, EntryRow). Overriding a system rule needs a `decisions/D-*` with `area: design`. Gaps go to sc1m first; log them here as `status: draft` until answered.

**Known local modification.** `src/components/ui/ai-summary/ai-summary.tsx` carries a local `ledger` paint palette (espresso + gold). Re-pulling that component from the registry drops it; re-add it.

**What stays here vs there.** How a sheet looks: there (taste skill). Which sheets Ledger has and what each says: here, in `design/screens.md` and the feature files.
