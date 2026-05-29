// Smoke-probe a built agent bundle's encrypted outbox.
//
// `bundle.mjs` already FAILS LOUD if the SQLCipher `.node` is missing from
// the bundle. This probe goes one step further: it actually LOADS the
// shipped binding and proves the encrypted outbox works end-to-end, the way
// the agent uses it. It is the runtime half of the packaging guarantee:
//   bundle.mjs  → "the binding file is in the bundle"
//   probe       → "the binding loads on THIS platform and really encrypts"
//
// Run after `build:bundle`:
//   node scripts/probe-outbox.mjs <bundleDir>      (defaults to ./bundle)
//
// It is platform-agnostic on purpose: CI runs it on a macOS runner to close
// the darwin unknown (arm64 + Intel), and it doubles as the one command a
// human on a borrowed Mac can run. Exit code is 0 on PASS, non-zero on any
// failure, so a CI step turns red without anyone reading the log.
//
// What it asserts (all four must hold):
//   1. The binding RESOLVES from inside the bundle, not a parent node_modules
//      (guards the resolution-leak that masked a missing prod dep on Windows).
//   2. A keyed round-trip works: create table, insert a secret, read it back,
//      and it survives a close + reopen with the same key.
//   3. The file is ENCRYPTED on disk: the plaintext SQLite magic header
//      ("SQLite format 3") is absent.
//   4. A WRONG key cannot read it (the first page read throws).
//
// The key pragma mirrors apps/bridge/agent/src/outbox.ts exactly: a raw
// 256-bit key via `key = "x'HEX'"` (no PBKDF2), so this exercises the same
// cipher path the agent ships.

import { createRequire } from "node:module";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const bundleDir = resolve(process.argv[2] ?? "bundle");

function fail(msg) {
  process.stdout.write(`\nMAC BUNDLE FAIL ❌  ${msg}\n`);
  process.exit(1);
}

process.stdout.write(
  `probe: node ${process.version} on ${process.platform}-${process.arch}\n`
);
process.stdout.write(`probe: bundle ${bundleDir}\n`);

if (!existsSync(join(bundleDir, "package.json"))) {
  fail(
    `no package.json in ${bundleDir}; run \`pnpm --filter eins-agent build:bundle\` first`
  );
}

// (1) Resolve the binding from INSIDE the bundle. createRequire anchored at
// the bundle's package.json resolves modules from <bundle>/node_modules, so a
// path that escapes the bundle means the bundle is missing the dependency and
// Node fell back to a parent tree (the exact leak that hid a missing prod dep
// on Windows).
const requireFromBundle = createRequire(join(bundleDir, "package.json"));
const MODULE = "better-sqlite3-multiple-ciphers";
let resolvedEntry;
try {
  resolvedEntry = requireFromBundle.resolve(MODULE);
} catch (err) {
  fail(`${MODULE} is not in the bundle's node_modules: ${err}`);
}
if (!resolvedEntry.startsWith(bundleDir)) {
  fail(
    `${MODULE} resolved OUTSIDE the bundle (${resolvedEntry}); the bundle is incomplete and only works because a parent node_modules leaked in`
  );
}
process.stdout.write(`probe: binding resolves to ${resolvedEntry}\n`);

let Database;
try {
  Database = requireFromBundle(MODULE);
} catch (err) {
  fail(
    `${MODULE} failed to LOAD on ${process.platform}-${process.arch} ` +
      `(wrong-ABI or wrong-platform .node?): ${err}`
  );
}

// Raw 256-bit key, hex, exactly as outbox.ts derives from secure-store.
const KEY_HEX =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const SECRET = "patient: Mustermann, Erika; invoice EUR 1.234,56";
const dbPath = join(bundleDir, "__probe-outbox.sqlite");
rmSync(dbPath, { force: true });

function open(path, keyHex) {
  const conn = new Database(path);
  // Mirror outbox.ts:applyKey — raw key, no KDF.
  conn.pragma(`key = "x'${keyHex}'"`);
  return conn;
}

// (2a) Write with the key.
try {
  const w = open(dbPath, KEY_HEX);
  w.exec("CREATE TABLE outbox (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
  w.prepare("INSERT INTO outbox (payload) VALUES (?)").run(SECRET);
  w.close();
} catch (err) {
  fail(`keyed write failed: ${err}`);
}

// (2b) Reopen with the SAME key and read it back (persistence across restart).
try {
  const r = open(dbPath, KEY_HEX);
  const row = r.prepare("SELECT payload FROM outbox WHERE id = 1").get();
  r.close();
  if (!row || row.payload !== SECRET) {
    fail(`round-trip mismatch: got ${JSON.stringify(row)}`);
  }
} catch (err) {
  fail(`keyed reopen/read failed: ${err}`);
}
process.stdout.write("probe: keyed round-trip + reopen OK\n");

// (3) The file must be encrypted on disk: the plaintext SQLite magic header
// must be absent. (ChaCha20 default cipher encrypts the whole file; SQLCipher
// mode replaces the header with a random salt. Neither yields the magic.)
const head = readFileSync(dbPath).subarray(0, 16).toString("latin1");
if (head.startsWith("SQLite format 3")) {
  fail(
    "outbox file is PLAINTEXT on disk (encryption not applied); patient-event rows would be readable at rest"
  );
}
process.stdout.write("probe: on-disk header is not plaintext SQLite OK\n");

// (4) A wrong key must NOT be able to read the file. Close the handle in a
// `finally`: the read throws before a plain `.close()` would run, and a
// leaked handle keeps a file lock that blocks cleanup on Windows.
let wrongKeyRejected = false;
let bad = null;
try {
  bad = open(dbPath, "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  bad.prepare("SELECT count(*) AS n FROM sqlite_master").get();
} catch {
  wrongKeyRejected = true;
} finally {
  try {
    bad?.close();
  } catch {
    /* already failed to open */
  }
}
if (!wrongKeyRejected) {
  fail("a WRONG key was able to read the outbox; encryption is not enforced");
}
process.stdout.write("probe: wrong-key read rejected OK\n");

// Best-effort cleanup: a leftover temp file (or a -wal lock on Windows) must
// never turn an otherwise-passing probe red.
for (const f of [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try {
    rmSync(f, { force: true });
  } catch {
    /* ignore */
  }
}

process.stdout.write(
  `\nMAC BUNDLE OK ✅  ${MODULE} loads and encrypts on ${process.platform}-${process.arch} (node ${process.version})\n`
);
