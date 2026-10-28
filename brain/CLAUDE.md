# Ledger brain

Personal product knowledge for Ledger (the mobile personal-finance prototype in this repo), written for AI agents and for me. One topic per file. Filenames are IDs.

**Non-negotiable:** every change to any file in this folder ends with a dated line in `CHANGELOG.md`. No changelog line, the change is not done. See *Write protocol*.

## Read in this order
1. `product.md` and `glossary.md`, always.
2. Then only what the task needs:

| Task | Open |
|---|---|
| Design a screen or flow | `users.md`, `features/<slug>.md`, `design/screens.md`, design system via `design/design-system.md` |
| Review or critique | `users.md`, `decisions/` (don't re-open a settled one), DS patterns + a11y |
| Write copy | `glossary.md`, `users.md`, DS voice guide |
| Scope or spec a feature | `product.md`, `rules/`, `system-map.md`, `research/RI-*`, open `feedback/` on that feature |
| Change an existing feature | `features/<slug>.md` Interactions section, `system-map.md`, `feedback/` with `about:` that feature |
| Answer "why did we…" | `decisions/`, then `CHANGELOG.md` for when |
| Answer "what changed since…" | `CHANGELOG.md` |
| Triage feedback | `feedback/` with `status: new`, the feature file, `decisions/` |
| Add or change anything here | this file (*Write protocol*), `_templates/`, then `CHANGELOG.md` |

## Layout
```
product.md        what it is, principles, metrics, roadmap      (loaded every time, keep short)
glossary.md       canonical words; the only vocabulary source
users.md          role matrix + personas
constraints.md    stack, integrations, limits that shape design
rules/            business rules, one per file          rule-<slug>.md
features/         current truth per feature, one file   <slug>.md
system-map.md     how features interact: objects, matrix, events, shared surfaces
CHANGELOG.md      dated log of every meaning change; the time axis
design/           the design pack: product.md (Sova config), design-system.md, screens.md,
                  ledger-design-taste/ (taste skill), work/ (Sova working files per feature)
decisions/        append-only why                       D-0001-<slug>.md
feedback/         what users and stakeholders said      FB-<n>-<slug>.md
research/         RN-<n>-<slug>.md raw notes, RI-<n>-<slug>.md synthesized insights
_templates/       feature.md, decision.md, feedback.md
```
The design system (sc1m + the Ledger brand layer) lives in `src/` and its taste in the `ledger-design-taste` skill. Never copy either here. Reference it as `ds:<name>`; `design/design-system.md` maps the refs. Sova (the `design` skill) reads this brain through `design/product.md` `sources`; the repo's root `CLAUDE.md` names this folder with `design_pack: brain/design`; there is no `.design/`. Files under `design/ledger-design-taste/` and `design/work/` are Sova's and are exempt from the brain frontmatter and changelog rules.

## Frontmatter (every file)
```yaml
type: fact | rule | decision | research | feedback | index
status: draft | active | superseded      # trust only active
updated: YYYY-MM-DD
related: [D-0001, requests, ds:data-table]   # filenames without extension, or ds: refs
```
Decisions add `area: product | design` and `supersedes:` / `superseded_by:`. Feedback adds `from`, `source`, `about`, `resolved_by`.

## Rules
- Trust `active`. `draft` is a hypothesis. `superseded` is history; leave the file in place and set `superseded_by`.
- Never edit an active decision. Write a new one that supersedes it.
- Glossary terms are canonical. If a word isn't there, add it before using it.
- State what is *not* true or *not* allowed. Negative space stops hallucination.
- A guess goes in `research/` or as `status: draft`, never as an active fact.
- Keep files under ~150 lines. Split by topic, not by document type.
- Every feature file has an **Interactions** section (owns, reads, writes, triggers, exposes, depends on). `system-map.md` aggregates them and is the source of truth for cross-feature behavior. Update both in the same change.
- Feedback is input, not truth. It becomes truth only through a decision (`resolved_by`) or a feature-file change. Research is what we went looking for; feedback is what came to us.
- Bump `updated:` on every edit. Git tracks text; the changelog tracks meaning and time.

## Write protocol (follow for every change, no exceptions)
1. **Edit** the file(s). New files start from `_templates/`.
2. **Bump** `updated:` to today in each file you touched.
3. **Log it** in `CHANGELOG.md`, before you consider the task done:
   - Under `## <year>` then `### <YYYY-MM-DD>` for today. Create the headings if today's don't exist. Newest date on top.
   - One line per change: `- <kind> — <what changed, one sentence> — <files>`
   - `kind` is one of: `shipped` (reached users), `decided` (new or superseded D-*), `changed` (meaning of an active file changed), `added` (new file), `feedback` (new FB-* or its status changed), `brain` (structure, conventions, templates, this file).
   - Several files for one reason is one line. Several reasons is several lines.
   - Typos and formatting are the only edits exempt.
4. **Cross-link.** If the change touched a feature's behavior, update `system-map.md`. If it resolved feedback, set its `resolved_by`. If it supersedes a decision, set both `supersedes` and `superseded_by`.

An AI asked to update the brain must do all four steps in the same turn and must not report completion until the changelog line exists.
