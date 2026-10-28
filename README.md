# Ledger

Mobile-browser implementation of the **Ledger – Final UI** Claude Design project. It is built with React 19, Vite, Tailwind CSS v4 and the [sc1m](https://github.com/maaraquel08/sc1m) design system.

```bash
npm install
npm run dev        # open on your phone via the LAN URL: npm run dev -- --host
npm run build
```

- **Design system**: sc1m components were installed from the `@sc1m` shadcn registry into `src/components/ui/*`, and its token contract is merged into `src/index.css`. Ledger is a brand layer at `src/styles/brands/ledger.css`, activated with `data-brand="ledger"` on `<html>`. Dark-mode values are defined but no toggle is wired yet.
- **AI surfaces**: every AI-authored block uses sc1m's `AiSummary` through `AiPanel` / `AiCard` / `AiMark` in `src/components/ledger/primitives.tsx`. It uses a local `ledger` palette (espresso + gold) added to `src/components/ui/ai-summary/ai-summary.tsx`. **If you re-pull that component, re-add the `ledger` palette entry.**
- **Receipt scanning** (`src/screens/scan.tsx`, `src/lib/receipt.ts`, `src/lib/ocr.ts`): reads receipts on the device with Tesseract.js. Its engine and English data download from a CDN the first time you scan, and the photo never leaves the phone. Receipt photos are downscaled and kept in localStorage, capped at the 40 newest.
- **Data**: `src/lib/store.tsx` (reducer) saving through `src/lib/persistence.ts` (localStorage). "Sign in" loads a demo persona built in `src/lib/seed.ts`. "Create an account" runs onboarding from zero.
- **Data layer**: `src/lib/persistence.ts` is the one place that reads and writes the ledger. It defines `LedgerRepository` (state) and `PhotoStore` (receipt photos) with a localStorage implementation: state under `ledger:v1`, photos under `ledger:photos:v1`, photos capped at the 40 newest. To move to a real API or database, implement those two interfaces and swap them in `src/lib/store.tsx`; screens and the reducer do not change. A failed save shows a storage banner.
- **Entry parsing**: `src/lib/parse.ts` turns text like "grab gcash 248" into description · account · amount · category.
- **AI**: the verdict, notes and chat answers are computed locally from your data by rules. No model or network call is made.

- **Claude Design**: the components are synced to the "Ledger Design System" project with `/design-sync`. The design-system entry is `src/ds/index.ts` + `src/ds/provider.tsx` (`npm run build:ds` → `dist-ds/`); sync inputs (config, notes, conventions, authored previews, doc stubs) live in `.design-sync/`.
