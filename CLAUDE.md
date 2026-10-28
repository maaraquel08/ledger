# Ledger

Mobile-web personal finance prototype (React 19, Vite, Tailwind v4, sc1m design system). See `README.md` for running it.

design_pack: brain/design

- **Product knowledge** lives in `brain/`. Read `brain/CLAUDE.md` first; it sets the read order and the write protocol (every change to the brain ends with a `CHANGELOG.md` line).
- **Design pack for Sova** (the `design`, `design-critique` and `design-context` skills) is `brain/design/`: `product.md` is the pack config, `ledger-design-taste/` the taste skill, `work/` the per-feature working files. Product facts are not duplicated there; the pack points at `brain/` through `sources`.
- **Taste skill** `ledger-design-taste` is discovered through the symlink `.claude/skills/ledger-design-taste`; do not copy it.
- Everything in `brain/` is `status: draft` until the Owner confirms it.
