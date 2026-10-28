// The edge functions run a copy of the app's regex parsers (Deno needs .ts import extensions).
// This fails while the copy is stale: run `node supabase/functions/_shared/vendor/sync.mjs`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error plain .mjs helper without types
import { FILES, OUT, SRC, transform } from "../../supabase/functions/_shared/vendor/sync.mjs";

describe("vendored regex parsers", () => {
  test.each(FILES as string[])("%s matches src/lib", (f) => {
    expect(readFileSync(join(OUT, f), "utf8")).toBe(transform(f, readFileSync(join(SRC, f), "utf8")));
  });
});
