/**
 * generate-leitfaden-pdf — regenerate the full Vertriebsleitfaden PDF to a
 * file so it can be eyeballed. The same `generateLeitfadenPdf()` is used by
 * the db seed to publish the document into /dokumente, so what you preview
 * here is byte-for-byte what lands in the Dokumente list.
 *
 * Usage (PowerShell — see CLAUDE.md gotchas):
 *   pnpm --filter portal pdf:leitfaden            # writes ./leitfaden.pdf
 *   pnpm --filter portal pdf:leitfaden out.pdf    # custom path
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateLeitfadenPdf } from "../src/server/reports/leitfaden-pdf";

async function main() {
  const out = resolve(process.cwd(), process.argv[2] ?? "leitfaden.pdf");
  const buf = await generateLeitfadenPdf();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, buf);
  console.log(
    `✓ Vertriebsleitfaden PDF: ${buf.byteLength.toLocaleString("de-DE")} Bytes → ${out}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
