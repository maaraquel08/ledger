// Copies the app's regex parsers (src/lib) into this folder so the edge functions can run the
// same code the client runs (the capture gate checks that Claude agrees with them).
// Deno needs explicit `.ts` import extensions and has no DOM, so the copy:
//   - rewrites `from "./x"` to `from "./x.ts"`
//   - drops receipt.ts's compressImage (browser-only, canvas)
// Run from the repo root after changing src/lib/{types,providers,parse,receipt}.ts:
//   node supabase/functions/_shared/vendor/sync.mjs
// tests/functions/vendor.test.ts fails while the copy is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FILES = ["types.ts", "providers.ts", "parse.ts", "receipt.ts"];

const HEADER = "// GENERATED from src/lib by supabase/functions/_shared/vendor/sync.mjs. Do not edit.\n";

export function transform(name, source) {
  let out = source.replace(/from "\.\/([a-z-]+)"/g, 'from "./$1.ts"');
  if (name === "receipt.ts") {
    const cut = out.indexOf("/** Downscale a photo");
    if (cut < 0) throw new Error("receipt.ts: compressImage marker not found");
    out = out.slice(0, cut).trimEnd() + "\n";
  }
  return HEADER + out;
}

const here = dirname(fileURLToPath(import.meta.url));
export const SRC = join(here, "../../../../src/lib");
export const OUT = here;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const f of FILES) writeFileSync(join(OUT, f), transform(f, readFileSync(join(SRC, f), "utf8")));
  console.log(`vendored ${FILES.join(", ")}`);
}
