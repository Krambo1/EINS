/**
 * Sign a vendor config into an uploadable bundle.
 *
 *   pnpm --filter eins-agent config:sign -- \
 *     --vendor tomedo-db --version 4 \
 *     --key "D:/secure/eins-pvs-2026a.pem" \
 *     --notes "Tomedo 1.152: termin.status_id heisst jetzt termin.status"
 *
 * Writes <vendor>-v<version>.signed.json, which an admin uploads at
 * /admin/pvs-bridge/konfigurationen. The portal verifies the signature, stores
 * the bundle and hands it to agents; it can never mint one, because this script
 * is the only thing that touches the private key.
 *
 * The config is VALIDATED here with the same loader the agent runs, and an
 * invalid config is never signed. That is the point at which a typo gets caught
 * once, instead of thirty times on thirty Praxis machines.
 */
import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_BUNDLE_SCHEMA,
  sha256Hex,
  signingInput,
  type SignedBundleCore,
  type VendorConfigBundle,
} from "../src/db-adapters/config-signature.js";
import { loadVendorConfigFromString } from "../src/db-adapters/vendor-config.js";
import { AGENT_VERSION } from "../src/version.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIGS_DIR = join(here, "..", "src", "db-adapters", "configs");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

function fail(message: string): never {
  console.error(`sign-vendor-config: ${message}`);
  process.exit(2);
}

/**
 * Locate the bundled YAML for a vendor id.
 *
 * Filenames and vendor ids do not match (configs/tomedo.yaml declares
 * `vendor: tomedo-db`), so we try the obvious name first and otherwise scan the
 * directory for the file that actually declares this vendor. Getting this wrong
 * would sign the wrong config under the right name, which is exactly the class
 * of mistake this tool exists to prevent.
 */
function findBundledConfig(vendor: string): string {
  const direct = join(CONFIGS_DIR, `${vendor}.yaml`);
  if (existsSync(direct)) return direct;
  const matcher = new RegExp(`^\\s*vendor:\\s*["']?${vendor}["']?\\s*$`, "m");
  for (const entry of readdirSync(CONFIGS_DIR)) {
    if (!/\.(yaml|yml)$/i.test(entry)) continue;
    const full = join(CONFIGS_DIR, entry);
    if (matcher.test(readFileSync(full, "utf8"))) return full;
  }
  fail(
    `no bundled config declares vendor '${vendor}' in ${CONFIGS_DIR}. Pass --in <path> if the config lives elsewhere.`
  );
}

async function main(): Promise<void> {
  const vendor = arg("--vendor");
  const versionRaw = arg("--version");
  const keyPath = arg("--key");
  if (!vendor || !versionRaw || !keyPath) {
    console.error(
      "usage: config:sign -- --vendor <id> --version <n> --key <private-key-path>\n" +
        "                      [--in <yaml-path>] [--out <bundle-path>]\n" +
        "                      [--notes <text>] [--min-agent <x.y.z>] [--key-id <id>]\n" +
        "\n" +
        "  --version   monotonic per vendor. Never reuse a number, and never go\n" +
        "              backwards: agents refuse a version below the one they run.\n" +
        "              To revert to an older config, sign its YAML as a NEW version.\n" +
        "  --in        defaults to src/db-adapters/configs/<vendor>.yaml\n" +
        "  --min-agent lowest agent version allowed to apply this (default: current)"
    );
    process.exit(2);
  }

  const version = Number.parseInt(versionRaw, 10);
  if (!Number.isSafeInteger(version) || version < 1) {
    fail("--version must be a positive integer");
  }

  const explicitIn = arg("--in");
  const yamlPath = explicitIn ? resolve(explicitIn) : findBundledConfig(vendor);
  if (!existsSync(yamlPath)) fail(`config not found: ${yamlPath}`);
  const yaml = readFileSync(yamlPath, "utf8");

  // Validate before signing. A signature over a broken config just makes the
  // breakage authentic.
  const cfg = await loadVendorConfigFromString(yaml, yamlPath).catch((err) => {
    fail(`config does not validate, refusing to sign:\n  ${(err as Error).message}`);
  });
  if (cfg.vendor !== vendor) {
    fail(
      `--vendor is '${vendor}' but ${yamlPath} declares vendor '${cfg.vendor}'. The signed header and the YAML must agree.`
    );
  }

  const privPath = resolve(keyPath);
  if (!existsSync(privPath)) fail(`private key not found: ${privPath}`);
  const privateKey = createPrivateKey(readFileSync(privPath, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    fail(
      `${privPath} is a ${privateKey.asymmetricKeyType ?? "unknown"} key; an Ed25519 key is required (see config:keygen)`
    );
  }

  // Key id comes from the sidecar the keygen wrote, so a rotation cannot be
  // mislabelled by a stale shell-history flag.
  let keyId = arg("--key-id");
  if (!keyId && existsSync(`${privPath}.json`)) {
    try {
      keyId = JSON.parse(readFileSync(`${privPath}.json`, "utf8")).keyId;
    } catch {
      // Fall through to the explicit-flag error below.
    }
  }
  if (!keyId) {
    fail(
      `no key id: pass --key-id, or keep the sidecar ${privPath}.json that config:keygen wrote next to the key`
    );
  }

  const core: SignedBundleCore = {
    schema: CONFIG_BUNDLE_SCHEMA,
    vendor: cfg.vendor,
    version,
    bridgeSource: cfg.bridgeSource,
    driver: cfg.driver,
    streams: cfg.streams.map((s) => s.kind),
    minAgentVersion: arg("--min-agent") ?? AGENT_VERSION,
    notes: arg("--notes") ?? null,
    signedAt: Date.now(),
    sha256: sha256Hex(yaml),
    keyId,
  };

  const signature = cryptoSign(
    null,
    Buffer.from(signingInput(core), "utf8"),
    privateKey
  ).toString("base64");

  const bundle: VendorConfigBundle = { ...core, yaml, signature };
  const outPath = resolve(arg("--out") ?? `${vendor}-v${version}.signed.json`);
  writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  console.log(`signed ${cfg.vendor} v${version}`);
  console.log(`  streams   : ${core.streams.join(", ")}`);
  console.log(`  driver    : ${core.driver} (bridgeSource ${core.bridgeSource})`);
  console.log(`  min agent : ${core.minAgentVersion}`);
  console.log(`  digest    : ${core.sha256}`);
  console.log(`  key       : ${keyId}`);
  console.log(`  bundle    → ${outPath}`);
  console.log("");
  console.log(
    "Upload it at /admin/pvs-bridge/konfigurationen. It reaches nobody until you set a rollout there."
  );
}

void main();
