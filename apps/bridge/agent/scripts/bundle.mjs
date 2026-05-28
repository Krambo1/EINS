// Assemble a self-contained, runnable agent bundle: the compiled `dist/`
// plus a FLAT, real-file production `node_modules` (native bindings
// included) and per-platform launchers. This folder is the payload the
// signed `.msi` (Windows) / `.dmg` (macOS) installer wraps and drops under
// Program Files / Applications. Run AFTER `tsc` + copy-assets.mjs.
//
// Why not `pkg` (the previous `build:bin`): pkg snapshots JS into one
// executable but does NOT embed native `.node` addons. The agent cannot
// boot without `better-sqlite3-multiple-ciphers` (the SQLCipher-encrypted
// outbox) and also loads `oracledb` (CGM M1 PRO's dominant install base).
// pkg's only work-around is to extract addons to a temp dir on first run,
// which a locked-down Praxis Windows box (AV / AppLocker / non-writable
// %TEMP%) can silently block. A folder of real files has no such failure
// mode. pkg was also never installed and is unmaintained for Node 20+.
//
// Why not `pnpm deploy`: on Windows it mangles absolute targets (prepends
// cwd to the drive-lettered path) and, even when it works, emits a
// symlinked `.pnpm` layout whose junctions do not survive being copied
// into an installer image.
//
// ABI invariant (READ THIS before changing the ship Node version):
//   • better-sqlite3-multiple-ciphers is a V8-ABI (NAN) addon, so its
//     prebuilt binary is Node-MAJOR-version specific. The filename carries
//     the ABI tag, e.g. node-v137 == Node 24, node-v127 == Node 22,
//     node-v115 == Node 20. A binding built here loads ONLY under the same
//     Node major. Therefore this bundle MUST be built under the SAME Node
//     version the installer ships, or the agent dies at startup with
//     "Could not locate the bindings file".
//   • oracledb is N-API (node-addon-api), so its `.node` is keyed by
//     platform+arch only and is ABI-stable across Node majors.
// CI builds the shipped bundle under the pinned ship-Node; this script
// asserts the binding is present and aborts the build if it is not, so a
// bundle that cannot open the outbox can never ship silently.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const agentRoot = join(here, "..");
const bundleDir = join(agentRoot, "bundle");

const pkg = JSON.parse(
  readFileSync(join(agentRoot, "package.json"), "utf8")
);
const deps = pkg.dependencies ?? {};

// Pin every production dependency to the EXACT version pnpm resolved and
// the test-suite exercised, rather than re-resolving the `^` ranges at
// bundle time. Reading each dep's installed package.json (the pnpm
// junction resolves to the store) avoids drift between what we tested and
// what we ship.
const pinned = {};
for (const name of Object.keys(deps)) {
  const manifestPath = join(agentRoot, "node_modules", name, "package.json");
  try {
    pinned[name] = JSON.parse(readFileSync(manifestPath, "utf8")).version;
  } catch {
    // Not installed locally: fall back to the declared range so the build
    // still produces something, but make the imprecision visible.
    pinned[name] = deps[name];
    process.stdout.write(
      `bundle: WARN ${name} not resolvable locally; shipping range '${deps[name]}'\n`
    );
  }
}

// Fresh bundle every time; stale node_modules from a prior Node major
// would carry a wrong-ABI binding.
rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });

// dist/ (compiled JS + copied YAML configs) is the app itself.
const distSrc = join(agentRoot, "dist");
if (!existsSync(join(distSrc, "index.js"))) {
  throw new Error(
    "bundle: dist/index.js missing; run `tsc` + copy-assets.mjs before bundling"
  );
}
cpSync(distSrc, join(bundleDir, "dist"), { recursive: true });

// A minimal production manifest: no devDependencies, no tsc/pkg scripts,
// exact-pinned runtime deps. `npm install --omit=dev` against this yields
// a flat, real-file node_modules.
const bundlePkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  type: pkg.type,
  main: "dist/index.js",
  bin: { "eins-agent": "dist/index.js" },
  dependencies: pinned,
};
writeFileSync(
  join(bundleDir, "package.json"),
  JSON.stringify(bundlePkg, null, 2) + "\n",
  "utf8"
);

// Materialise the production dependency tree as real files. npm (not pnpm)
// gives a flat, junction-free node_modules that copies cleanly into an
// installer image. Build scripts run (prebuild-install fetches the
// SQLCipher binding for THIS Node major; oracledb ships its binaries in
// the tarball).
process.stdout.write(`bundle: npm install --omit=dev in ${bundleDir}\n`);
// Single fixed command string + shell:true (no args array) so cmd.exe finds
// npm.cmd on Windows without tripping Node's DEP0190 (args+shell) warning.
// The command is a literal with no interpolated input, so there is no shell
// injection surface.
const install = spawnSync(
  "npm install --omit=dev --no-audit --no-fund --loglevel=error",
  { cwd: bundleDir, stdio: "inherit", shell: true }
);
if (install.status !== 0) {
  throw new Error(`bundle: npm install failed (exit ${install.status})`);
}

// FAIL-LOUD: the encrypted outbox is mandatory; a bundle without a
// loadable SQLCipher binding is a bundle that bricks at startup. Assert the
// `.node` exists rather than discovering it on a Praxis machine.
const cipherDir = join(
  bundleDir,
  "node_modules",
  "better-sqlite3-multiple-ciphers"
);
const cipherBinding = findFile(cipherDir, (n) => n.endsWith(".node"));
if (!cipherBinding) {
  throw new Error(
    "bundle: FATAL no better-sqlite3-multiple-ciphers .node binding in the " +
      "bundle. The agent cannot open its outbox and will not boot. Check " +
      "that the build host has network access to the prebuild release and " +
      "is running the intended ship-Node major."
  );
}
process.stdout.write(
  `bundle: SQLCipher binding present (${cipherBinding.replace(bundleDir, ".")})\n`
);

// Slim the bundle: oracledb ships prebuilt binaries for all 5 platforms;
// a single-platform installer needs only the host one. Pruning the others
// is safe (oracledb only loads the matching file) and trims ~40 MB.
pruneForeignOracleBinaries(bundleDir);

// Launchers. Prefer a co-located `node`/`node.exe` (the installer can drop
// a pinned runtime next to this folder for a fully self-contained install)
// and fall back to a PATH `node` otherwise.
writeFileSync(
  join(bundleDir, "eins-agent.cmd"),
  [
    "@echo off",
    "setlocal",
    'set "HERE=%~dp0"',
    'if exist "%HERE%node.exe" (',
    '  "%HERE%node.exe" "%HERE%dist\\index.js" %*',
    ") else (",
    '  node "%HERE%dist\\index.js" %*',
    ")",
    "",
  ].join("\r\n"),
  "utf8"
);
const sh = join(bundleDir, "eins-agent");
writeFileSync(
  sh,
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'if [ -x "$DIR/node" ]; then exec "$DIR/node" "$DIR/dist/index.js" "$@"; fi',
    'exec node "$DIR/dist/index.js" "$@"',
    "",
  ].join("\n"),
  "utf8"
);
try {
  chmodSync(sh, 0o755);
} catch {
  // Non-POSIX filesystem (e.g. building the macOS launcher on Windows):
  // the .dmg packaging step re-applies the executable bit.
}

process.stdout.write(
  `bundle: done → ${bundleDir} (${dirSizeMb(bundleDir)} MB, Node ${process.version}, ${process.platform}-${process.arch})\n`
);

// ---------- helpers --------------------------------------------------------

function findFile(root, pred) {
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (pred(entry.name)) return full;
    }
  }
  return null;
}

function pruneForeignOracleBinaries(root) {
  const relDir = join(
    root,
    "node_modules",
    "oracledb",
    "build",
    "Release"
  );
  if (!existsSync(relDir)) return;
  const keep = `${process.platform}-${process.arch}.node`;
  for (const entry of readdirSync(relDir)) {
    if (entry.endsWith(".node") && !entry.endsWith(keep)) {
      rmSync(join(relDir, entry), { force: true });
      process.stdout.write(`bundle: pruned foreign oracle binary ${entry}\n`);
    }
  }
}

function dirSizeMb(root) {
  let bytes = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else
        try {
          bytes += statSync(full).size;
        } catch {
          /* ignore races */
        }
    }
  }
  return Math.round(bytes / 1_048_576);
}
