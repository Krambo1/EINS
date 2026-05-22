/**
 * FHIR driver — proves HealthHub + RED adapters against either:
 *
 *   1. A local HAPI FHIR server (set FHIR_BASE_URL or use the default
 *      http://127.0.0.1:8090/fhir — start with docker-compose, then seed),
 *   2. A fixture FHIR Bundle (no docker required, fastest smoke-test).
 *
 * Both produce the same canonical events, because both HealthHub and RED
 * delegate to apps/bridge/src/adapters/_fhir/normalize-shared.ts.
 *
 * Mode is auto-detected: if HAPI is reachable we fetch from it; otherwise
 * we fall back to the on-disk fixture and proceed without a server.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeFhirBundle,
  type FhirBundle,
} from "../../src/adapters/_fhir/normalize-shared.js";
import { startStubPortal } from "./stub-portal.js";
import {
  FHIR_BASE_URL,
  STUB_PORTAL_URL,
  TEST_CLINIC_ID,
  signBody,
  banner,
  isMain,
  summarise,
} from "./shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "..", "fixtures", "fhir-bundle.json");
const PORTAL = process.env.PORTAL_BASE_URL?.replace(/\/$/, "") ?? STUB_PORTAL_URL;

async function fetchAllFromHapi(): Promise<FhirBundle> {
  const types = ["Patient", "Appointment", "Encounter", "Invoice"];
  const out: FhirBundle = { resourceType: "Bundle", type: "collection", entry: [] };
  for (const t of types) {
    const url = `${FHIR_BASE_URL}/${t}?_count=200`;
    const res = await fetch(url, {
      headers: { accept: "application/fhir+json" },
    });
    if (!res.ok) {
      throw new Error(`GET ${t} ${res.status}: ${await res.text()}`);
    }
    const bundle = (await res.json()) as FhirBundle;
    for (const entry of bundle.entry ?? []) {
      out.entry!.push(entry);
    }
  }
  return out;
}

async function loadFixture(): Promise<FhirBundle> {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as FhirBundle;
}

async function probeHapi(): Promise<boolean> {
  try {
    const res = await fetch(`${FHIR_BASE_URL}/metadata?_format=json`, {
      headers: { accept: "application/fhir+json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function postEvent(event: unknown): Promise<boolean> {
  const raw = JSON.stringify(event);
  const sig = signBody(raw);
  const res = await fetch(`${PORTAL}/api/pvs/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-eins-signature": sig },
    body: raw,
  });
  if (!res.ok) {
    console.error(`  ✗ POST ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return res.ok;
}

export async function runFhirDriver(opts: {
  needsStubPortal: boolean;
}): Promise<{ posted: number; failed: number; mode: "hapi" | "fixture" }> {
  banner("fhir driver (healthhub + red share this code path)");
  const stubPortal = opts.needsStubPortal ? await startStubPortal() : null;

  let posted = 0;
  let failed = 0;
  let mode: "hapi" | "fixture";
  try {
    const hapiUp = await probeHapi();
    let bundle: FhirBundle;
    if (hapiUp) {
      mode = "hapi";
      console.log(`Mode: HAPI FHIR (${FHIR_BASE_URL})`);
      bundle = await fetchAllFromHapi();
    } else {
      mode = "fixture";
      console.log(`Mode: fixture (no HAPI at ${FHIR_BASE_URL})`);
      bundle = await loadFixture();
    }
    console.log(`Loaded ${bundle.entry?.length ?? 0} FHIR resources`);

    // Same code path BOTH adapters use (decodeFhirBundle is in
    // _fhir/normalize-shared.ts; healthHubAdapter.decodePush + redAdapter.
    // decodePush both delegate here). Running once with each bridgeSource
    // proves vendor-independence of the shared decoder.
    for (const source of ["healthhub", "red"] as const) {
      console.log(`  decoding as ${source}…`);
      const events = decodeFhirBundle(TEST_CLINIC_ID, source, bundle);
      for (const event of events) {
        const ok = await postEvent(event);
        if (ok) {
          posted += 1;
          console.log(`    → ${summarise(event)}`);
        } else {
          failed += 1;
        }
      }
    }
  } finally {
    if (stubPortal) await stubPortal.stop();
  }
  console.log(`Done. posted=${posted} failed=${failed} mode=${mode!}`);
  return { posted, failed, mode: mode! };
}

if (isMain(import.meta.url)) {
  const needsStubPortal = !process.env.PORTAL_BASE_URL;
  runFhirDriver({ needsStubPortal })
    .then(({ failed }) => process.exit(failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
