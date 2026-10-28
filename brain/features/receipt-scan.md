---
type: fact
status: draft
updated: 2026-10-29
related: [home, add-entry, activity, accounts, users, system-map, D-0012, rules/rule-signed-money, D-0013, D-0005, D-0015]
---

# Receipt scan

**Purpose.** Lets the Owner photograph a receipt and have M8 read it on the phone into one entry with a split.

## Scope
- In: camera, reading, routing (unreadable / duplicate / review / auto-log), `parseReceipt` rules, doubts, image storage, duplicate rule.
- Out: cloud OCR in local mode (cloud mode reads with Claude vision, planned, see below); languages other than English; scan cap (none); the Add entry sheet's Camera mode (same camera and reader, its own states; see `add-entry`).

## Permissions
| Role | Sees | Does | Cannot |
|---|---|---|---|
| Owner | Camera, reading, review | Scan, retake, type total, fix paid-with and categories, log | Log a doubtful receipt without review. In local mode the photo stays on the phone; in cloud mode it is uploaded (D-0012), so copy never promises it stays |
| M8 | Photo text via local OCR | Reads merchant, total, items, date, payer; flags doubts | Log a doubtful receipt without the Owner's review |

## Rules
- Full-screen entry from Home scan icon to `/scan` (no tab bar) (`src/screens/home.tsx:333-340`). The camera stream, capture, photo fallback and torch are `useCamera` / `fileToCanvas` in `src/lib/camera.ts` and the brackets are `ReceiptFrame`, shared with the Add entry sheet's Camera mode, which reads with the same `recognize` + `parseReceipt` but has no duplicate check and no Review screen. OCR is Tesseract.js, English, loaded dynamically; engine and language data are downloaded from a CDN on first use, then cached (`src/lib/ocr.ts:1-5`). `warmUp()` on mount (`src/screens/scan.tsx:45`).
- Stages `camera` -> `reading` -> `review | unreadable | auto-log | duplicate handoff` (`scan.tsx:31-35`).
- Compression: max edge 720 px, JPEG q 0.6 (`src/lib/receipt.ts:198-205`). Reading hold `READ_HOLD_MS=900`.
- Routing (`scan.tsx:74-84`), in order: total not found -> unreadable; OCR threw -> unreadable with `failed: !readerRan`; possible duplicate -> Home duplicate card; any doubts -> review; else auto-log with no confirmation.
- Extraction `parseReceipt` (`receipt.ts:102-154`):
  - Merchant: first line with >= 3 letters and no run of 3+ digits; title-cased, max 40; fallback "Receipt".
  - Store category: GROCERS -> Groceries; RESTAURANTS -> Food & drink; FUEL -> Transport; PHARMACY -> Health; else keyword `suggestCategory`.
  - Total: first non-"subtotal" line with total / amount due / amt due / grand total / total due plus a price.
  - Items: lines ending in a 2-decimal price; name >= 2 letters; `NOT_ITEM` words (subtotal, total, cash, change, vat, tax, discount, card, gcash, tin, cashier...) skipped.
  - Item category: ambiguous words (tissue/napkin, vitamin/alcohol/cotton, water/ice) take the first category and `unsure`; a non-grocery store forces all items to its category; Household/Health keywords override.
  - Reconciliation: no total but items -> total = sum; if |sum - total| > 1 add an "Other items" line (unsure) and doubt.
  - Paid-with: last4 pattern; G-CASH; MAYA; VISA/MASTERCARD/JCB/AMEX/CREDIT -> first credit; BPI; BDO; DEBIT -> first bank; CASH -> first cash; else none.
  - Date: d/m/y or d-m-y read as MM/DD unless first part > 12; accepted within 400 days; future clamped to now.
- Doubts: "<First word> could be A or B."; "I couldn't tell how you paid." (only if accounts exist); "I couldn't tell what this was for."; "The items add up to X, not Y.".
- Save `draftToEntry` (`receipt.ts:168-182`): desc = merchant; `amount = -Math.round(total)` (whole pesos); category = largest split else merchant category; `source:"receipt"`; `split` only if > 1 category; `receipt = {image, items}`; `queued` if offline.
- Duplicate `findDuplicate` (`receipt.ts:185-195`): existing expense WITHOUT a receipt, amount within ±₱1 of total, within 3 hours of receipt time.
- Photos live under their own localStorage key `ledger:photos:v1` (a map of entry id to data URL), not inside `ledger:v1`. Each save writes new photos there first, drops photos whose entry is gone, and keeps only the newest 40 (`PHOTO_CAP`, `src/lib/persistence.ts:28-30, 55-62, 105-113`). On load the photo is re-attached to its entry; a legacy photo embedded in an entry is moved across (`persistence.ts:33-43`).
- A failed write of the entry state sets `persistError`, which shows the storage banner "Couldn't save on this phone. Free up space or delete receipt photos." (`src/lib/store.tsx:111-113`, `App.tsx:67`, `home.tsx:266`). A failed write of the photo key does NOT raise the banner (`PhotoStore.put` returns false but `save()` ignores it, `persistence.ts:57`); the entry still saves and the photo is retried on the next save.

## States
| State | Trigger | User sees | Exit |
|---|---|---|---|
| Camera | open `/scan` | "Fit the whole receipt in the frame", shutter, "Choose a photo", torch if supported; header "RECEIPT" or "Done · N" | Shutter / close |
| No camera API | no `getUserMedia` | "This browser can't open the camera. Choose a photo instead." | Choose photo |
| Denied | `NotAllowedError` | "Camera access is off. Allow it in your browser's site settings, or choose a photo." | Choose photo |
| No camera | other error | "No camera here. Choose a photo of the receipt instead." | Choose photo |
| Reading | photo taken | "READING · N%" bar, then fields MERCHANT, TOTAL, PAID WITH, WHEN; "READING · N ITEMS FOUND" | Auto route |
| Unreadable | no total | "COULDN'T READ THE TOTAL" / "Hold steady and fill the frame. Flat and well-lit works best."; "Retake", "Type the total" | Retake / Next |
| Reader failed | engine never started | "COULDN'T START THE READER" / "The reader downloads the first time you scan. Connect to the internet and retake, or type the total." | Retake |
| Review | doubts or typed total | "Review"; "‹ Retake"; PAID WITH ("· CHECK"), SPLIT ("N categories", "· CHECK"); button "Log ₱total" | Log |
| Logged | log | Toast "Logged <merchant> −₱X SCAN ANOTHER"; stays on camera | Scan / Done |
| Duplicate | match | Handoff to Home "ALREADY LOGGED?" | Attach / Log as new / Discard |

## Flow
Camera -> compress -> OCR -> route. Auto-log or Review -> "Log" -> camera for next scan; "Done" or close -> `/home` (handoff in sessionStorage `ledger:handoff`).

## Screens
| Screen | Route | Primary action | Components |
|---|---|---|---|
| Scan | `/scan` | Shutter / "Log ₱X" | Screen, Sheet (Paid with, item category), Cta, CategoryChip, AiCard |
| Receipt photo (in detail) | sheet in `/activity/:id` | View | Sheet |

## Planned (approved 2026-10-29, not shipped)
- `/scan` stops being a separate screen; receipt capture is the Camera mode of Add (D-0015).
- Cloud mode (D-0012, D-0013): the photo is uploaded to a private Storage bucket and read by Claude vision server-side; it **does leave the phone**, so no copy may say otherwise. Line items go to `receipt_items`. The duplicate check (same amount and merchant within 48 h) is part of the confidence gate; a failing gate sends the receipt to Review with one question.
- Local mode keeps on-device Tesseract and everything above.

## Interactions
| | |
|---|---|
| Owns | Nothing persistent (receipt photo and items live on the Entry) |
| Reads | accounts, entries (duplicate check), `suggestCategory` |
| Writes | `add-entry` (source "receipt"); on Home: `update-entry` (attach) |
| Triggers | sessionStorage `ledger:handoff`; navigate `/home`; `back("/home")` on close |
| Exposes | `receipt` and `split` fields used by activity (edit split, photo tile, M8's note) |
| Depends on | home (duplicate card), accounts (paid-with), Tesseract CDN on first use |

## Edge cases
| Case | Behavior | Decided |
|---|---|---|
| Typed total after unreadable | One item named after merchant, category Other, unsure, doubt "I couldn't read the total, so check the category." | handled in code |
| Totals mismatch | "Other items" line + doubt | handled in code |
| Future receipt date | Clamped to now | handled in code |
| Duplicate of typed/spoken entry | Attach / Log as new / Discard | handled in code |
| Duplicate of an entry that already has a receipt | Not matched | unhandled |
| First scan offline | "COULDN'T START THE READER" | handled in code |
| Many photos | Capped at the 40 newest; a full state write shows the storage banner; a full photo write fails silently | partly handled (D-0011) |
| Total rounding | Stored whole pesos | handled in code |
| Investment accounts | Excluded from Paid with picker | handled in code |
| Confidence from OCR | Ignored | unhandled |

## Open questions
- Doubt-free receipts auto-log with no confirmation. Intended?
- Photo write failures are silent (see Rules); surface them in the storage banner?
- Offline after first use depends on cache; no service worker seen (unverified).
