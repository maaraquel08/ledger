# design-sync notes — Ledger

Repo-specific facts a future sync needs. One bullet per gotcha.

## Shape and build
- This repo is a Vite app, not a library. The DS entry is `src/ds/index.ts` (barrel) + `src/ds/provider.tsx` (`LedgerDesignSystem`), built by `npm run build:ds` into `dist-ds/` (ESM `index.js`, compiled Tailwind `styles.css`, `.d.ts` tree). `package.json` `module`/`types` point there; the app build is untouched.
- tsc leaves `@/` path aliases in emitted `.d.ts`; `scripts/ds-rewrite-paths.mjs` rewrites them to relative paths after `tsc`. Without it the converter's ts-morph project resolves 1 export and reports `[ZERO_MATCH]`.
- `srcDir` is pinned to `src/ds` on purpose: with `src/` the fuzzy src-finder assigns path-derived groups (`ledger`, `ai-summary`, `toggle-group`) that beat the doc-stub categories. With `src/ds` every component is `general` and `.design-sync/docs/<Name>.md` frontmatter `category:` drives the four groups (Ledger, AI, Icons, sc1m).
- `.design-sync/docs/` holds one stub per component (category + one-line purpose). They are the `.prompt.md` bodies; keep them in sync with the brain's `design/ledger-design-taste/references/components.md`.
- Brand tokens live under `[data-brand="ledger"]`. Sheets/Drawers portal to `<body>`, so `LedgerDesignSystem` also sets `data-brand` on `<html>` in a layout effect; without it portaled surfaces render in sc1m orange with a serif fallback.
- Provider logos are `/assets/logo-*.{jpg,png}` absolute paths that don't resolve outside the app; `ProviderMark` now falls back to the brand initial on image error. Previews show initials, by design.
- Tailwind v4 only emits utilities used under `src/`. The design agent gets every class the app uses; novel utilities may be missing. Prefer primitives and the documented class recipes.
- Compiled CSS references `--active-tab-width`, `--active-tab-left`, `--transform-origin`, `--drawer-swipe-movement-y`: Base UI sets these at runtime (`[TOKENS_MISSING]` is expected, non-blocking).

- Preview authoring: only utilities used under `src/` exist in the compiled CSS (`justify-around` is not one); use utilities the app uses or inline styles for layout glue.
- `AiSummaryMark` (stock sc1m) paints olive on the ledger palette; only `AiMark` re-points to Ledger yellow. Faithful, not a defect.
- `AddSheet` keypad mode is tap-only and not previewed. `TabBar` (`fixed`) is contained by a `position: relative` 430x160 wrapper under `cardMode: single`.
- `Screen` preview uses `className="!min-h-0 pb-6"` so the cell isn't a full viewport; review sheets render small primitives in tall cells (capture layout, not the card).

## Known render warns
- Headless captures show Chromium's focus ring (blue outline) on auto-focused dialog popups (Sheet, AddSheet, DrawerContent). Not product styling; the app opens sheets from a tap so `:focus-visible` never matches.
- Icons alone render under 5KB PNGs (`[RENDER_BLANK]`) until their authored previews put several sizes on one card (done; the warn is gone).
- `[RENDER_THIN] … rendered height is 0px` on Sheet, AddSheet and Drawer: their content is a Base UI portal outside the card root, so the validator measures 0px. Both are authored, `cardMode: single`, and graded good from the single-story captures.
- `[TOKENS_MISSING]` for Base UI runtime vars (see above).
- `[GRID_OVERFLOW]` was fixed by `cardMode: column` on every 382px-framed card (47 overrides in config); a new preview framed at 382px needs the same override.

## Sync record
- 2026-10-19 first sync → project `cb67ab0a-4a18-49b6-b505-37d4b1e32b10` ("Ledger Design System"), 349 files, 68 components, 46 authored previews all graded good, 22 sc1m parts on the floor card. Incremental path (empty project), one approval, no deletes.
- Re-sync: `npm run build:ds`, re-copy the staged scripts, fetch `_ds_sync.json` into `.design-sync/.cache/remote-sync.json`, then `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./dist-ds/index.js --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json`.

## Re-sync risks
- `src/ds/index.ts` is a hand-kept barrel: a new primitive must be added there or it never reaches the bundle.
- `ai-summary.tsx` carries a local `ledger` palette; re-pulling the sc1m component drops it (README warning).
- System fonts only (Helvetica Neue stack, ui-monospace); nothing to ship, renders as Arial on non-Apple hosts.
- `guidelines/` mirrors `brain/` files by glob; when the brain changes, the next sync re-uploads them (sourceHashes catch it). Adding a brain file outside the globs in `config.json` means it never ships.
- Preview grades live only in the uploaded `_ds_sync.json` and the gitignored `.cache/`; a fresh clone re-verifies everything unless the project anchor is fetched first.
- The converter staged under `.ds-sync/` is the 2.1.303 skill copy; re-copy on every sync (instructions say so) or old scripts run against new instructions.
- Chromium for the render check is the macOS Playwright cache (`~/Library/Caches/ms-playwright`, playwright 1.64.1 in `.ds-sync/`); a different machine needs the install step again.
