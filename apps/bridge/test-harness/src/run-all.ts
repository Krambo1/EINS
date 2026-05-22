/**
 * Run every driver against a single shared stub portal and print one
 * consolidated pass/fail report.
 *
 * Usage:
 *   pnpm --filter bridge-test-harness harness:all
 *
 * Optional:
 *   FHIR_BASE_URL=http://127.0.0.1:8090/fhir
 *   PORTAL_BASE_URL=http://localhost:3001     # point at a real portal
 */
import { startStubPortal } from "./stub-portal.js";
import { runCanonicalDriver } from "./run-canonical.js";
import { runTomedoDriver } from "./run-tomedo.js";
import { runFhirDriver } from "./run-fhir.js";
import { runGdtDriver } from "./run-gdt.js";
import { runCsvDriver } from "./run-csv.js";
import { STUB_PORTAL_URL, banner } from "./shared.js";

interface DriverResult {
  name: string;
  posted: number;
  failed: number;
  extra?: Record<string, unknown>;
}

async function main(): Promise<void> {
  banner("EINS PVS Bridge — end-to-end harness");
  const usingRealPortal = !!process.env.PORTAL_BASE_URL;
  const stub = usingRealPortal ? null : await startStubPortal();
  if (!usingRealPortal) {
    console.log(`Stub portal listening on ${STUB_PORTAL_URL}`);
  } else {
    console.log(`Using real portal at ${process.env.PORTAL_BASE_URL}`);
  }

  const results: DriverResult[] = [];
  try {
    const canon = await runCanonicalDriver();
    results.push({
      name: "canonical",
      posted: canon.posted,
      failed: canon.failed,
      extra: { ingested: canon.ingested, deduped: canon.deduped },
    });

    const tomedo = await runTomedoDriver({ needsStubPortal: false });
    results.push({
      name: "tomedo",
      posted: tomedo.posted,
      failed: tomedo.failed,
    });

    const fhir = await runFhirDriver({ needsStubPortal: false });
    results.push({
      name: "fhir",
      posted: fhir.posted,
      failed: fhir.failed,
      extra: { mode: fhir.mode },
    });

    const gdt = await runGdtDriver({ needsStubPortal: false });
    results.push({
      name: "gdt",
      posted: gdt.posted,
      failed: gdt.failed,
      extra: { folder: gdt.folder },
    });

    const csv = await runCsvDriver({ needsStubPortal: false });
    results.push({
      name: "csv",
      posted: csv.posted,
      failed: csv.failed,
      extra: { folder: csv.folder },
    });
  } finally {
    if (stub) {
      banner("stub-portal final stats");
      console.log(JSON.stringify(stub.getStats(), null, 2));
      await stub.stop();
    }
  }

  banner("summary");
  let anyFailed = false;
  for (const r of results) {
    const status = r.failed === 0 ? "✓ pass" : "✗ FAIL";
    const extra = r.extra
      ? ` ${Object.entries(r.extra)
          .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join(" ")}`
      : "";
    console.log(
      `  ${status}  ${r.name.padEnd(12)} posted=${r.posted} failed=${r.failed}${extra}`
    );
    if (r.failed > 0) anyFailed = true;
  }
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
