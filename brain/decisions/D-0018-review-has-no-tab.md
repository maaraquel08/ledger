---
type: decision
area: design
status: active
updated: 2026-10-29
related: [features/review, features/home, system-map, D-0017, D-0005, D-0014]
supersedes: [D-0017]
superseded_by: null
---

# D-0018 Three tabs: Today, Money, Analytics; Review opens from Today

**Context.** The Owner asked on 2026-10-29 to "remove the review tab as it makes no sense and no functionality". With few uncertain captures, the tab sat empty most days and spent a quarter of the bar on it.

**Decision.** The tab bar has three tabs: **Today**, **Money**, **Analytics** (each as D-0017 describes). Review stays as a screen at `/review`, reached from Today's "N things to review" row, which counts both entries that need a detail (D-0005) and balance gaps (D-0014). The row only shows when there is something to review; Review has a back bar to Today.

| Option | Outcome |
|---|---|
| Review as a Today row (chosen) | Tab bar holds only places the Owner visits; Review appears exactly when it has work |
| Keep the Review tab (D-0017) | A permanently present, mostly empty tab |
| Drop Review entirely | Uncertain captures and balance gaps would have nowhere to be resolved |

**Consequences.** No badge on the tab bar; Today's row is the only signal. Captures saved to Review still say so in their toast.
**Revisit when.** Review items regularly pile up unnoticed.
