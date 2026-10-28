// tsc keeps `@/…` path aliases in emitted .d.ts files; consumers without the
// tsconfig `paths` (the design-sync converter's ts-morph project) can't resolve
// them. Rewrite every `@/x` import/export in dist-ds/**/*.d.ts to a relative path.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist-ds");
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".d.ts")) files.push(p);
  }
})(root);

let changed = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const out = src.replace(/(["'])@\/([^"']+)\1/g, (_, q, rest) => {
    let rel = relative(dirname(f), join(root, rest)).split("\\").join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `${q}${rel}${q}`;
  });
  if (out !== src) {
    writeFileSync(f, out);
    changed++;
  }
}
console.error(`ds-rewrite-paths: ${changed}/${files.length} .d.ts files rewritten`);
