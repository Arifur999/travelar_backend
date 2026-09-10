// Node's strict ESM resolver requires explicit file extensions and doesn't
// resolve directory imports to their index file. This project (and Prisma's own
// generated client) writes plain extensionless relative imports, which only ever
// ran successfully via tsx's looser resolution. This script rewrites them
// in-place to be ESM-resolution-correct, so `node dist/...` (used by Vercel's
// function runtime, and by `pnpm start` on persistent hosts) actually works.
// Runs after every `prisma generate`, since the generated client needs the same
// fix and gets regenerated from scratch.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const importRe = /((?:import|export)(?:\s+type)?\s+(?:[^'"]*?\bfrom\s+)?)(['"])(\.\.?\/[^'"]*)\2/g;
const roots = ["src", "api"];

let scanned = 0;
let fixed = 0;
const unresolved = [];

const fixFile = (file) => {
  scanned++;
  const src = readFileSync(file, "utf8");

  const out = src.replace(importRe, (match, head, quote, spec) => {
    if (/\.(js|json|ts|mjs|cjs)$/.test(spec)) return match;

    const abs = resolve(dirname(file), spec);
    let next = null;

    if (existsSync(abs + ".ts")) next = spec + ".js";
    else if (existsSync(join(abs, "index.ts"))) next = spec + "/index.js";
    else if (existsSync(abs + ".d.ts")) next = spec + ".js";

    if (!next) {
      unresolved.push(`${file}: ${spec}`);
      return match;
    }

    fixed++;
    return `${head}${quote}${next}${quote}`;
  });

  if (out !== src) writeFileSync(file, out);
};

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) fixFile(full);
  }
};

for (const root of roots) {
  if (existsSync(root)) walk(root);
}

console.log(`[fix-esm-imports] Files scanned: ${scanned}, specifiers fixed: ${fixed}`);
if (unresolved.length) {
  console.warn("[fix-esm-imports] unresolved specifiers:", unresolved);
}
