/**
 * Seed a local HAPI FHIR server with the same resources our fixture bundle
 * carries, so the bridge's HealthHub + RED adapters can exercise their
 * `initialSync` (FHIR search) and `decodePush` (FHIR Subscription) paths
 * against real HTTP rather than an in-process fixture.
 *
 * Usage:
 *   docker compose -f apps/bridge/test-harness/docker-compose.yml up -d
 *   pnpm --filter bridge-test-harness fhir:seed
 *
 * Defaults to http://127.0.0.1:8090/fhir; override via FHIR_BASE_URL to seed
 * the public HAPI test server (https://hapi.fhir.org/baseR4).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FHIR_BASE_URL, banner, isMain } from "./shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "..", "fixtures", "fhir-bundle.json");

interface FhirBundleEntry {
  fullUrl?: string;
  resource?: { resourceType: string; id?: string; [k: string]: unknown };
}
interface FhirBundle {
  entry?: FhirBundleEntry[];
}

async function putResource(
  resourceType: string,
  id: string,
  resource: unknown
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${FHIR_BASE_URL}/${resourceType}/${id}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/fhir+json",
      accept: "application/fhir+json",
    },
    body: JSON.stringify(resource),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

async function probeMetadata(): Promise<boolean> {
  try {
    const res = await fetch(`${FHIR_BASE_URL}/metadata?_format=json`, {
      headers: { accept: "application/fhir+json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function seedFhir(): Promise<{ wrote: number; failed: number }> {
  banner("fhir seeder");
  console.log(`FHIR base: ${FHIR_BASE_URL}`);

  const reachable = await probeMetadata();
  if (!reachable) {
    console.error(
      `\n  ✗ Cannot reach ${FHIR_BASE_URL}/metadata.\n` +
        `    Start HAPI FHIR first:\n` +
        `      docker compose -f apps/bridge/test-harness/docker-compose.yml up -d\n` +
        `    Or point at the public test server:\n` +
        `      FHIR_BASE_URL=https://hapi.fhir.org/baseR4 pnpm harness:fhir-seed\n`
    );
    return { wrote: 0, failed: 1 };
  }

  const raw = await readFile(FIXTURE_PATH, "utf8");
  const bundle = JSON.parse(raw) as FhirBundle;
  const entries = bundle.entry ?? [];
  let wrote = 0;
  let failed = 0;
  for (const entry of entries) {
    const r = entry.resource;
    if (!r || !r.id || !r.resourceType) continue;
    const result = await putResource(r.resourceType, r.id, r);
    if (result.ok) {
      console.log(`  ✓ PUT ${r.resourceType}/${r.id}`);
      wrote += 1;
    } else {
      console.error(
        `  ✗ PUT ${r.resourceType}/${r.id} → ${result.status} ${result.body.slice(0, 200)}`
      );
      failed += 1;
    }
  }
  console.log(`Seeded. wrote=${wrote} failed=${failed}`);
  return { wrote, failed };
}

if (isMain(import.meta.url)) {
  seedFhir()
    .then(({ failed }) => process.exit(failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
