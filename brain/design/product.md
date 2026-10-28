---
product: Ledger
platforms: [mobile-web]
frameworks: [react]
work_dir: brain/design/work
brand_locked: true
tokens: src/styles/brands/ledger.css
motion_tokens: null            # transitions.dev _root.css not imported yet; literal durations are debt
components: src/components/ledger
slots:
  taste: ledger-design-taste   # brain/design/ledger-design-taste (symlinked from .claude/skills)
  voice: ux-writing
  handoff: []
  critique: []
sources:
  - path: brain/product.md
    role: product
  - path: brain/glossary.md
    role: product
  - path: brain/users.md
    role: product
  - path: brain/constraints.md
    role: product
  - path: brain/features/*.md
    role: requirements
    match: slug
  - path: brain/rules/*.md
    role: domain
  - path: brain/decisions/*.md
    role: domain
  - path: brain/system-map.md
    role: architecture
  - path: brain/design/screens.md
    role: architecture
---
Sova pack config, nothing else. This folder (`brain/design/`) is the real home of the design
pack; the repo's root `CLAUDE.md` names it with `design_pack: brain/design`, which is how the global
`design` skills find it (there is no `.design/` folder). It holds
the taste skill (`ledger-design-taste/`, symlinked into `.claude/skills/`), design working files
(`work/<feature-slug>/`), the design-system pointer and the screen inventory. Every product fact,
rule, decision, edge case and system map lives one level up in `brain/` and reaches Sova through
`sources` above. There is no `decisions.md`, `system-map.md` or `edge-cases.md` here by design;
use `brain/decisions/`, `brain/system-map.md` (with its cross-feature edge cases) and
`brain/features/*.md`.
