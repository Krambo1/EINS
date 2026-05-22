// Copy non-TS assets from src/ into dist/ after tsc.
// Currently: db-adapters/configs/*.yaml.
//
// Why a script and not `tsc --copyFiles`: TypeScript doesn't ship one.
// Vite-style bundlers would handle this but we deliberately avoid one for
// the agent build (pkg single-binary path is simpler against plain tsc).
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const COPIES = [
  {
    from: join(root, "src", "db-adapters", "configs"),
    to: join(root, "dist", "db-adapters", "configs"),
    glob: /\.ya?ml$/i,
  },
];

for (const { from, to, glob } of COPIES) {
  let entries;
  try {
    entries = await readdir(from);
  } catch (err) {
    if (err.code === "ENOENT") continue;
    throw err;
  }
  await mkdir(to, { recursive: true });
  for (const entry of entries) {
    if (!glob.test(entry)) continue;
    const src = join(from, entry);
    const dst = join(to, entry);
    const s = await stat(src);
    if (!s.isFile()) continue;
    await cp(src, dst);
    process.stdout.write(`copied ${src} -> ${dst}\n`);
  }
}
