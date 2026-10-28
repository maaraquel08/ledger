---
type: fact
status: draft
updated: 2026-10-29
related: [D-0017, features/analytics, product, features/home, features/activity, features/chat, D-0012, D-0013, D-0014, D-0015, D-0016]
---

# Glossary

Use the first column everywhere: UI, specs, decisions, code names. Words in "Don't use" are banned in UI. Drafted from UI strings in `src/` on 2026-10-19.

| Term | Means | Don't use | Note |
|---|---|---|---|
| Entry | One logged money movement: description, account, category, signed amount, date | Transaction, record | `src/lib/types.ts` `Entry`; negative = out |
| Log | Add an entry, by voice, text, form or receipt | Create, submit, post | "Hold to log", "Log ₱820" |
| File | Give an entry its category (and account) | Categorize, tag | "File it so your insights stay accurate" |
| Account | A place money sits: bank, e-wallet, cash, credit card, investments | Wallet (generic), source | Credit balance = amount owed; balance is derived from entries (D-0014) |
| Provider | The brand behind an account (GCash, BPI, RCBC…) | Bank (for e-wallets) | Internal word; UI shows the brand name |
| Category | One of 14 fixed buckets an entry files into | Tag, label | `Category` union; "Needs category" chip when null |
| Review | The queue of entries missing a category or an account, or held by the capture gate with one question (D-0013); a tab (D-0015) | Inbox, triage, unfiled | "N entries to review", "All filed." |
| Today's number | What you can still spend today | Daily budget, allowance | Home hero; "left today" / "over today" / "no budget yet" |
| The math | The sheet that shows how today's number was reached | Breakdown, details | "Show the math", "How I got the number" |
| Budget | Monthly spending cap, total or per category | Limit, cap | Set under Insights › Budgets |
| Pace | Budget spent so far vs. what the day of month allows | Burn rate | "over pace", "₱X over budget" (never "ahead of pace", which reads as good news) |
| Goal | A named amount to save by a month (`YYYY-MM`) or with no date | Target, fund | Not linked to any account |
| Transfer | Money moved between your own accounts (two linked legs), or paid to a person; never a merchant or bill (D-0007); not spending | Payment | "TRANSFER · NOT SPENDING" |
| Investments | Money put into holdings; not spending | Savings | Excluded from spend and income totals |
| Receipt | A photo read into an entry with items and a split: on-device in local mode, by Claude vision on the server in cloud mode | Scan (as a noun), invoice | "Scan a receipt" is the verb |
| Split | A receipt entry's amounts by category | Breakdown | Only stored when >1 category |
| Queued | Saved on this phone, not yet acknowledged by the server; shown as "On phone" / "Saved on this phone" | Pending, unsynced, waiting to sync | Cloud mode retries until Synced (D-0012); local mode never leaves this state's wording |
| M8 | The assistant voice that reads your data and answers | AI, bot, Sidekick, assistant (in copy) | Claude on the server in cloud mode, deterministic rules in local mode; never moves money (D-0013) |
| Synced | An entry or change the server has acknowledged | Saved to cloud, backed up | Copy may say "synced" only after the acknowledgement (D-0012) |
| Cloud mode | The app running against Supabase: sign-in, server ledger, M8 on Claude | Online mode, pro | Needs Supabase keys (D-0012); internal word |
| Local mode | The app running with no backend: localStorage, rule-based M8 | Offline mode, demo mode | Demo persona is always local; internal word |
| Snapshot | What the Owner says an account (or holding) held on a date; never changes the balance | Balance update, sync | Shown against the derived balance (D-0014) |
| Adjustment | An entry, confirmed by the Owner, that closes the gap between a derived balance and a snapshot | Correction, fix, reconcile | Category Adjustment; not spending, not income (D-0014) |
| Move | Two linked legs that sum to zero: a transfer or an invest | Linked entries, pair | Deleting one leg deletes the move (D-0007, D-0010) |
| Insight | One thing M8 has to say: daily line, weekly review, monthly close, alert, or a saved answer | Notification, tip, nudge | Lives in the in-app inbox; some are pushed (D-0016) |
| Fact | A number computed in SQL that M8's prose cites by placeholder | Stat, figure | A digit in M8's prose that isn't a fact is rejected (D-0013); internal word |
| Raw input | What the Owner gave to log: text, a voice clip or a photo, kept with what was parsed from it | Source, upload | Every captured entry points to its raw input; internal word |
| Rule (learned rule) | A filing rule learned from the Owner's correction, e.g. "Jollibee → Food & drink" | Automation, filter | Applied before Claude's guess (D-0013) |
| Today | The first tab: M8's sentence, today's number, this month so far, Review count, budgets and goals | Home, Dashboard | D-0017; `/today` |
| Analytics | The third tab: one week, month or year at a time, compared with the period before and the usual | Insights (for the tab), Reports, Stats | D-0017; `/analytics`. "Insight" stays the word for one thing M8 says |
| Like for like | Comparing an unfinished period with the same elapsed days of the one before (Oct 1–29 vs Sep 1–29) | Same period last time | UI: "VS. SEP 1–29 (SAME DAYS)" |
| Trailing average | The average of up to 8 weeks / 3 months / 5 years before the period, like for like, since the ledger began | Baseline, norm | UI: "VS AVG", "AVG OF 3 MONTHS" |
| Savings rate | Net saved as a share of income in a period | Savings ratio | Changes shown in points ("−5 PTS") |
| Recurring bill | A merchant charged about monthly, similar amount and day, in ≥ 3 of the last 6 months | Subscription (unless it is one), autopay | Detected, never scheduled; Analytics only |
| Money | The second tab: accounts, net worth and the full ledger | Wallet, Accounts tab | D-0015 |
| Verdict | Internal name for the monthly budget computation | — | `selectors.ts` `verdict()`; never shown as a word |
| Refunded | An expense entry reversed; struck through, excluded from spend, balance restored (D-0009) | Reversed, voided | Expenses only |
| Side income | Irregular extra income named during onboarding | Bonus | "Irregular · not budgeted" |
| Payday / take-home | Net amount that lands per pay period | Salary (as the field) | Frequency: Twice a month, Monthly, Weekly, Irregular |
| Net worth | Cash + invested − credit owed | Balance (total) | Accounts header "TOTAL NET WORTH" |
| ₱ | The peso sign, always, no decimals | PHP, P, Php | `peso()` in `src/lib/format.ts` |
