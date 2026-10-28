---
type: decision
area: product
status: draft   # inferred from UI strings; confirm to activate
updated: 2026-10-19
related: [glossary, features/activity, features/add-entry]
supersedes: []
superseded_by: null
---

# D-0004 We say "entry", "log" and "file", never "transaction"

**Context.** Banking words make a personal notebook feel like a statement. The welcome headline is "Type it like you'd say it."

**Decision.** A logged item is an **entry**. Adding one is **logging**. Giving it a category is **filing**. "Transaction" never appears in user copy; it may appear in code.

| Option | Outcome |
|---|---|
| Entry / log / file (chosen) | Notebook feel, short verbs |
| Transaction / add / categorize | Bank-statement feel, longer labels |

**Consequences.** Glossary rows for Entry, Log, File, Review ("All filed."). Any imported-statement feature must still call its rows entries.
**Revisit when.** User testing shows "entry" is misread.
