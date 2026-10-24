/**
 * Generate the Ed25519 keypair that signs vendor configs.
 *
 *   pnpm --filter eins-agent config:keygen -- --key-id eins-pvs-2026a \
 *        --out "D:/secure/eins-pvs-2026a.pem" --install
 *
 * The PRIVATE key is the most sensitive secret in the product: whoever holds it
 * can make every enrolled agent run arbitrary SQL against a Praxis patient
 * database. It is written to the path you name and nowhere else. Put that path
 * somewhere offline (password manager, encrypted USB), never in this repo, never
 * in a portal environment variable, never in a CI secret.
 *
 * The PUBLIC half goes into the agent's compiled trust anchor (`--install`
 * rewrites it for you) and into the portal's PVS_CONFIG_PUBLIC_KEYS, where it
 * can only verify.
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TRUST_FILE = join(here, "..", "src", "db-adapters", "config-trust.ts");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

function fail(message: string): never {
  console.error(`pvs-config-keygen: ${message}`);
  process.exit(2);
}

const keyId = arg("--key-id");
const out = arg("--out");
const install = process.argv.includes("--install");

if (!keyId || !out) {
  console.error(
    "usage: config:keygen -- --key-id <id> --out <private-key-path> [--install]\n" +
      "  --key-id   short identifier baked into every bundle, e.g. eins-pvs-2026a\n" +
      "  --out      where to write the PRIVATE key (keep this file offline)\n" +
      "  --install  also rewrite the agent's trust anchor with the public key"
  );
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(keyId)) {
  fail("--key-id must be 3-64 chars of [a-z0-9._-]");
}

const outPath = resolve(out);
if (existsSync(outPath)) {
  fail(
    `${outPath} already exists. Refusing to overwrite a private key: if you meant to rotate, pick a new path and a new --key-id.`
  );
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
// The raw 32 bytes are the tail of the SPKI DER; the 12-byte prefix is the
// fixed Ed25519 algorithm identifier that config-signature.ts re-attaches.
const publicRaw = (
  publicKey.export({ format: "der", type: "spki" }) as Buffer
).subarray(12);
const publicB64 = publicRaw.toString("base64");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, privatePem, { encoding: "utf8", mode: 0o600 });
// Sidecar so the signing script can pick up the key id without being told
// twice (and so a stray .pem is identifiable a year from now).
writeFileSync(
  `${outPath}.json`,
  `${JSON.stringify(
    { keyId, publicKey: publicB64, createdAt: new Date().toISOString() },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`private key  → ${outPath}  (mode 0600; move this offline)`);
console.log(`sidecar      → ${outPath}.json`);
console.log(`key id       : ${keyId}`);
console.log(`public key   : ${publicB64}`);
console.log("");
console.log("Portal env (verify-only, safe to deploy):");
console.log(
  `  PVS_CONFIG_PUBLIC_KEYS='${JSON.stringify([{ keyId, publicKey: publicB64 }])}'`
);

if (install) {
  const source = readFileSync(TRUST_FILE, "utf8");
  const entry = `  { keyId: ${JSON.stringify(keyId)}, publicKey: ${JSON.stringify(
    publicB64
  )} },`;
  const marker = /export const TRUSTED_CONFIG_KEYS: ReadonlyArray<TrustedConfigKey> = \[[\s\S]*?\n\];/;
  if (!marker.test(source)) {
    fail(
      `could not find the TRUSTED_CONFIG_KEYS array in ${TRUST_FILE}; add the entry by hand:\n${entry}`
    );
  }
  // Keep any existing entries: rotation means both keys are trusted for one
  // release, so a fresh keygen must never silently drop the key that every
  // deployed agent is currently verifying against.
  const existing = [
    ...source.matchAll(/^\s*\{\s*keyId:.*$/gm),
  ].map((m) => m[0].trimEnd());
  const kept = existing.filter((line) => !line.trimStart().startsWith("//"));
  const body = [...kept.map((l) => (l.startsWith("  ") ? l : `  ${l}`)), entry].join(
    "\n"
  );
  const next = source.replace(
    marker,
    `export const TRUSTED_CONFIG_KEYS: ReadonlyArray<TrustedConfigKey> = [\n${body}\n];`
  );
  writeFileSync(TRUST_FILE, next, "utf8");
  console.log("");
  console.log(`trust anchor updated → ${TRUST_FILE}`);
  console.log(
    "Rebuild and roll out the agent BEFORE signing anything with this key: an agent that does not carry it will refuse the bundle."
  );
}
