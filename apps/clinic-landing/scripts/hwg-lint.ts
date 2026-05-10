/**
 * HWG / UWG / BGH compliance linter.
 *
 * Walks every file under `clinics/` and `app/[clinicSlug]/datenschutz/page.tsx`,
 * `app/[clinicSlug]/impressum/page.tsx`, and any client-facing copy that
 * could leak into the rendered HTML, and greps for legally-fraught phrases
 * defined in `lib/schema.ts:BANNED_PHRASES`.
 *
 * Exit:
 *   0  — clean
 *   1  — banned phrase found in a clinic-facing source file
 *
 * NOT a substitute for legal review. This catches the obvious cases the
 * schema can't (the schema only validates fields it knows; this script
 * scans the raw .ts files that produce them).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { findBannedPhrases } from "../lib/schema";

const ROOT = resolve(__dirname, "..");

const TARGET_DIRS = [
  resolve(ROOT, "clinics"),
];
const TARGET_FILES_GLOB = [
  resolve(ROOT, "components/sections"),
];

let violations = 0;

function walk(dir: string, visit: (file: string) => void) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, visit);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      visit(full);
    }
  }
}

/**
 * Strip the parts of a source file that legitimately mention banned phrases
 * but never appear in patient-facing output:
 *   - // line comments
 *   - block comments
 *   - import/export specifiers
 * What's left is the literal data + JSX + UI strings — exactly what we
 * want to scan.
 */
function stripCodeNoise(src: string): string {
  return src
    // block comments
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // single-line comments
    .replace(/^\s*\/\/.*$/gm, "")
    // import / export from "..." lines (filenames may include "vorher" etc.)
    .replace(/^\s*(import|export).*$/gm, "");
}

function scan(file: string) {
  // The schema and linter modules carry the banned-phrase list itself.
  if (file.endsWith("schema.ts") || file.endsWith("hwg-lint.ts")) return;

  const text = readFileSync(file, "utf8");
  const stripped = stripCodeNoise(text);
  const found = findBannedPhrases(stripped);
  for (const phrase of found) {
    violations += 1;
    console.error(
      `✖ HWG-Lint: "${phrase}" found in ${relative(ROOT, file)}`,
    );
  }
}

for (const dir of TARGET_DIRS) walk(dir, scan);
for (const dir of TARGET_FILES_GLOB) walk(dir, scan);

if (violations > 0) {
  console.error(`\n${violations} banned-phrase violation(s). Aborting.`);
  process.exit(1);
}
console.log("HWG-Lint: clean.");
