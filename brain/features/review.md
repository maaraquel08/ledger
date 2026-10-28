---
type: fact
status: draft
updated: 2026-10-29
related: [activity, add-entry, home, accounts, users, system-map, D-0013, D-0005, D-0015]
---

# Review

**Purpose.** Lets the Owner file entries that were saved without a category or an account.

## Scope
- In: the queue, suggestion pills, account pills, "Accept suggestions".
- Out: editing amount/description (use Activity); bulk account assignment; undo.

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | Queue of incomplete entries | Pick category/account per entry, accept all suggestions | Assign accounts in bulk |
| M8 | Entry descriptions | Suggests a category via `suggestCategory` (sparkle pill) | File anything without the Owner tapping |

## Rules
- Queue = entries with `category == null || accountId == null` (`src/screens/activity.tsx:41, 642-747`). Entries land here because missing fields save anyway (D-0005): typed, spoken, scanned, or orphaned by removing an account (`remove-account` sets `accountId: null`).
- Per entry: if category missing, up to 4 pills = suggestion (sparkle) + `Food & drink, Gifts, Groceries, Other`; if account missing, pills for all accounts.
- Entry leaves the queue (300 ms animate-out) once it has both and is updated.
- Sticky "Accept suggestions" shows only while some entry lacks a category; sets `suggestCategory(desc) ?? "Other"` on every such entry; does not assign accounts. Note: "Entries without a suggestion go to Other."
- Suggestion = first matching `KEYWORDS` regex on the description (`src/lib/providers.ts:65-78`).
- Entry point: Activity banner only; `/review` has no tab bar.

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Queue | >= 1 incomplete entry | "Review", "N left"; "These entries are missing a category or an account. Everything else is filed." | File each |
| Empty | none | "All filed." / "Every entry has a category and an account." + "Back to Activity" | Back |
| Demo start | seeded persona | "3 entries to review" (lunch w/ team, tita bday gift, 7-Eleven) | n/a |

## Flow
Banner in Activity -> `/review` -> pick pills -> row animates out -> "Accept suggestions" for the rest -> "All filed.".

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Review | `/review` | Pick category/account; "Accept suggestions" | Screen, EntryRow, Pill, CategoryChip, Cta |

## Planned (approved 2026-10-29, not shipped)
- ~~Review becomes a tab (D-0015)~~ Shipped 2026-10-29: Review has no tab (D-0018); it opens from Today's "N things to review" row, which counts entries needing a detail and balance gaps. Back returns to Today.
- Cloud mode: the queue also holds entries the capture confidence gate did not pass, each with one targeted question (e.g. which account, is this a duplicate) (D-0013). D-0005 still holds: nothing blocks logging.
- Every correction is stored and may become a learned **rule**, applied before Claude's guess next time.
- Snapshot gaps waiting for an Adjustment (D-0014) may surface here (open).

## Interactions
| | |
|---|---|
| Owns | Nothing (a view over Entry) |
| Reads | entries, accounts, `suggestCategory` |
| Writes | `update-entry` (category, accountId; balance effect reapplied) |
| Triggers | `back` to Activity |
| Exposes | "N entries to review" count to Activity banner |
| Depends on | activity, add-entry/home/receipt-scan (sources of incomplete entries), accounts |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| No suggestion for an entry | "Accept suggestions" files it as Other | handled in code |
| Account removed | Its entries re-enter the queue | handled in code |
| Many entries missing accounts | Must be done one by one | unhandled |
| Pills limit | Only 4 category pills; others via Activity edit | handled in code |
| Sign on filing | Review patches only `category` / `accountId`, never `amount`, so filing here never flips the sign (`src/screens/activity.tsx:653-662`); only the Edit sheet does | handled in code |
| Receipt-scan "Other" entries | Filed Other, not queued | handled in code |

## Open questions
- Should "Accept suggestions" confirm before filing everything as Other?
- Should the queue offer an "all to this account" shortcut?
