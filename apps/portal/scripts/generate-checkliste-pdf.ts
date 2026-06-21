/**
 * generate-checkliste-pdf — render the Asset-Liefer-Checkliste PDF.
 *
 * Unlike the Vertriebsleitfaden (seeded per Praxis into the DB), this checklist
 * is the same for everyone and ships as a STATIC asset, pinned in the Dokumente
 * tab next to the Portal-Anleitung. So the default output goes straight into
 * public/ — re-run this whenever content.ts changes, then commit the PDF.
 *
 * Usage (PowerShell — see CLAUDE.md gotchas):
 *   pnpm --filter portal pdf:checkliste            # writes public/anleitung/eins-asset-checkliste.pdf
 *   pnpm --filter portal pdf:checkliste out.pdf    # custom path
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateChecklistePdf } from "../src/server/reports/checkliste-pdf";

const DEFAULT_OUT = "public/anleitung/eins-asset-checkliste.pdf";

async function main() {
  const out = resolve(process.cwd(), process.argv[2] ?? DEFAULT_OUT);
  const buf = await generateChecklistePdf();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, buf);
  console.log(
    `✓ Asset-Liefer-Checkliste PDF: ${buf.byteLength.toLocaleString("de-DE")} Bytes → ${out}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
