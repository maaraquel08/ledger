---
type: fact
status: draft
updated: 2026-10-29
related: [glossary, users, constraints, system-map, D-0012, D-0013, D-0014, D-0015, D-0016]
---

# Ledger

<!-- Loaded on every task. Keep under one screen. Drafted from code on 2026-10-19; confirm before trusting. -->

**What it is.** Ledger is a mobile-web personal finance app for the Philippines that lets one person log what they earn, spend and invest by typing, speaking or snapping a receipt, and get a plain-language verdict on what they can still spend today. Direction since 2026-10-29: the Owner's personal CFO, with one trusted ledger in Supabase that M8 (Claude) reasons over, and a local mode that runs with no backend (D-0012, D-0013). The cloud parts are planned, not shipped.

**For.** Primary: a salaried Filipino professional who juggles a payroll bank, an e-wallet, a credit card and cash, and wants to know "can I spend this?" without spreadsheets. Secondary: none yet. Not for: households, businesses, bank-connected automation, more than one user.

**North star.** Days logged. The product is only useful once a week of entries exists (`features/insights` gate), so the number that means it is working is consecutive days with at least one entry.

**Fits with.** Standalone prototype of the "Ledger – Final UI" Claude Design project. Built on the sc1m design system with a Ledger brand layer (`design/design-system`). Mobile browser only, 430px column.

**Non-goals this phase.** Bank or statement sync ("· soon" import links are disabled), moving money, specific stock advice, multiple users or households, sharing, dark mode toggle, email. Multi-currency only for investments (`fx_rates`).

## Principles (ordered; higher wins a tie)
| # | Principle | Cost we accept |
|---|---|---|
| 1 | *Type it like you'd say it.* One line is a whole entry; Ledger files the rest. | Mis-parsed entries land in Review instead of blocking the user |
| 2 | *Every number is provable.* The ledger lives in one place (Supabase in cloud mode); every number on screen or in M8's words is computed from entries, never written by the model (D-0012, D-0013, D-0014). Still no bank login. | Data leaves the phone; sign-in and a server to run; slower, narrower M8 answers when the facts aren't there |
| 3 | *One number, then the math.* Lead with today's number; the breakdown is one tap away. | Two formulas today (see `rules/rule-daily-allowance`) |
| 4 | *M8 proposes, never moves money.* The assistant reads everything, speaks on a cadence without nagging (D-0016), and may create a goal on request, nothing else. | Fewer "smart" automations |
| 5 | *Calm ink, one yellow.* Espresso ink carries the UI; yellow marks the add button and live voice; gold marks AI. | Less colour to lean on for state |

## Metrics
| Metric | Kind | Definition | Target |
|---|---|---|---|
| Days logged | north star | Distinct local days with ≥1 entry (`src/lib/selectors.ts` `daysLogged`) | 7 in first week |
| Entries in Review | guardrail (must not get worse) | Entries with null category or account | < 10% of entries |
| Questions answered | guardrail | Chat questions that hit an intent, not the fallback | TODO |

## Roadmap (buckets, not dates)
| Bucket | Feature | Why now / why not |
|---|---|---|
| Now | all ten in `features/` (local mode) | shipped in the prototype |
| Next | cloud mode: Supabase ledger, M8 on Claude, derived balances, Today / Money / Review tabs, insight inbox and push (D-0012–D-0016) | approved 2026-10-29; spec `docs/superpowers/specs/2026-10-29-cfo-agent-design.md` |
| Later | statement import; dark mode toggle | copy already promises "· soon"; dark tokens exist unwired |
| Not doing | bank connections | the Owner logs by hand; copy says "Ledger never connects to your bank" |
