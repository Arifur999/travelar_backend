// Fails when a relative import in the backend lacks an explicit file extension.
//
// The project runs as ESM, where Node's resolver needs `./x.js`, not `./x`.
// Hand-written code follows that convention; Prisma's generated client does
// too, because schema.prisma sets `importFileExtension = "js"`. This script
// only checks — it never rewrites a file.
//
// It replaces fix-esm-imports.mjs, which rewrote every file under src/ in place
// on each `pnpm generate` (hand-written code included) and matched its regex
// inside comments, so it warned about "unresolved" imports that were only
// example code in Prisma's doc comments.
//
// Imports are found with TypeScript's own pre-processor, which understands
// comments, strings, `export … from`, `import type` and dynamic `import()`.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const roots = ["src", "test", "scripts", "prisma.config.ts", "vitest.config.ts"];
const sourceFile = /\.(ts|mts|cts)$/;
const hasExtension = /\.(js|mjs|cjs|json)$/;

const offenders = [];
let files = 0;
let imports = 0;

const check = (file) => {
  files += 1;
  const { importedFiles } = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
  for (const { fileName } of importedFiles) {
    if (!fileName.startsWith("./") && !fileName.startsWith("../")) continue;
    imports += 1;
    if (!hasExtension.test(fileName)) offenders.push(`${relative(process.cwd(), file)}: "${fileName}"`);
  }
};

const walk = (path) => {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules") continue;
      walk(join(path, entry));
    }
  } else if (sourceFile.test(path) && !path.endsWith(".d.ts")) {
    check(path);
  }
};

for (const root of roots) walk(root);

if (offenders.length > 0) {
  console.error(`[check-esm-imports] ${offenders.length} relative import(s) without a file extension:`);
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error('Add the runtime extension (".js" for a .ts file). For the generated client, check importFileExtension in prisma/schema/schema.prisma.');
  process.exit(1);
}

console.log(`[check-esm-imports] ok: ${imports} relative imports in ${files} files all carry an extension`);
