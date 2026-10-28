---
type: decision
area: product
status: active
updated: 2026-10-29
related: [constraints, glossary, system-map, features/add-entry, features/receipt-scan, features/onboarding, rules/rule-nothing-leaves-the-phone, D-0013, docs/superpowers/specs/2026-10-29-cfo-agent-design]
supersedes: [D-0001, D-0011, rules/rule-nothing-leaves-the-phone]
superseded_by: null
---

# D-0012 Supabase holds the ledger; the phone syncs to it

**Context.** The Owner wants Ledger to be a personal CFO: one trusted record of every account and entry that Claude can reason over (spec `docs/superpowers/specs/2026-10-29-cfo-agent-design.md`). A localStorage-only ledger cannot back that up, reach a model, or survive a cleared browser. Decided by the Owner on 2026-10-29 ("do what you recommend"; "yes" to retiring "nothing leaves the phone").

**Decision.** In **cloud mode** Supabase Postgres is the source of truth for the ledger: accounts, entries, moves, snapshots, goals, rules, raw inputs and insights, every row owned by one user and protected by row-level security. Receipt photos and voice clips go to private Storage buckets. Auth is an email magic link for a single Owner. The app runs in **local mode** (localStorage, regex parsers, canned chat, exactly as before) when the Supabase URL and anon key are absent; the demo persona is local-only. There is still no bank or statement sync.

Sync states for an entry in cloud mode:

| State | Means | Copy |
|---|---|---|
| Saved on this phone (`queued`) | Written locally, not yet acknowledged by the server (offline, or request in flight or failed) | "Saved on this phone" / chip "On phone" |
| Synced | The server acknowledged the write (RPC returned) | "Synced" may be shown only now |

Rules: IDs are generated on the client so a retried write is idempotent; a queued entry retries until acknowledged; copy never says "synced" before the acknowledgement. In local mode D-0011's wording stays: "saved on your phone", never "sync".

| Option | Outcome |
|---|---|
| Supabase as source of truth, local mode kept (chosen) | Backup, a second device later, server-side Claude; needs auth, a privacy story and honest sync copy |
| Stay local only | No real AI, no backup; contradicts the CFO direction |
| Bank aggregation | Still a non-goal; Ledger never connects to a bank |

**Consequences.** `rules/rule-nothing-leaves-the-phone` is superseded: entries, photos, voice clips and questions do leave the phone in cloud mode and copy must stop promising otherwise (e.g. "the photo never leaves the phone"). Welcome "Sign in" means a real sign-in in cloud mode. Erase all data must say whether it erases the phone or the account (open). The spec owns the schema (`supabase/CONTRACT.md`).
**Revisit when.** A second user, household sharing or bank sync is requested.
