/**
 * CSV driver — generates Honorar-style CSV exports (semicolon, comma
 * decimals, ISO-8859-15) for each of the agent's five streams, parses
 * with the agent's real csv-parser, maps via mapCsvRow + auto-detected
 * mapping, and POSTs the canonical events.
 *
 * Proves the long-tail "any PVS that can dump a CSV" path works without
 * any vendor sandbox.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv } from "../../agent/src/csv-parser.js";
import {
  autoDetectMapping,
  mapCsvRow,
} from "../../agent/src/csv-mapper.js";
import { startStubPortal } from "./stub-portal.js";
import {
  STUB_PORTAL_URL,
  TEST_CLINIC_ID,
  signBody,
  banner,
  isMain,
  summarise,
} from "./shared.js";

const PORTAL = process.env.PORTAL_BASE_URL?.replace(/\/$/, "") ?? STUB_PORTAL_URL;

interface CsvFile {
  name: string;
  content: string;
}

const files: CsvFile[] = [
  {
    name: "patients.csv",
    content: [
      "Patient-Nr;Vorname;Nachname;Geburtsdatum;Geschlecht;E-Mail;Mobil;Bemerkung",
      "701;Hannah;Klein;12.04.1990;w;hannah.klein@example.test;+49 30 5550701;EINS-Lead-cafef00d",
      "702;Felix;Bauer;28.11.1985;m;felix.bauer@example.test;+49 89 5550702;Hyaluron Lippen Erstkontakt",
    ].join("\r\n"),
  },
  {
    name: "appointments.csv",
    content: [
      "Patient-Nr;Termin-Nr;Termindatum;Behandlungs-Code;Behandlungs-Bezeichnung;Status;Bemerkung",
      "701;a-701;25.05.2026;BTX-STIRN;Botox Stirnpartie;geplant;Erstberatung",
      "702;a-702;26.05.2026;HYAL-LIP;Hyaluron Lippen;abgesagt;Patient verschoben",
    ].join("\r\n"),
  },
  {
    name: "encounters.csv",
    content: [
      "Patient-Nr;Behandlungs-Nr;Termin-Nr;Behandlungsdatum;Leistungsziffer;Bezeichnung;Behandler",
      "701;e-701;a-701;25.05.2026;BTX-STIRN;Botox Stirnpartie;Dr. Müller",
    ].join("\r\n"),
  },
  {
    name: "recalls.csv",
    content: [
      "Patient-Nr;Recall-Nr;Recall-Datum;Leistungsziffer;Bezeichnung",
      "701;r-701;25.11.2026;BTX-STIRN-FU;Auffrischung",
    ].join("\r\n"),
  },
  {
    name: "invoices.csv",
    content: [
      "Patient-Nr;Rechnungs-Nr;Termin-Nr;Behandlungs-Nr;Endbetrag;Bezahlt am",
      "701;inv-701;a-701;e-701;390,00;25.05.2026",
    ].join("\r\n"),
  },
];

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

export async function runCsvDriver(opts: {
  needsStubPortal: boolean;
}): Promise<{ posted: number; failed: number; folder: string }> {
  banner("csv driver");
  const stubPortal = opts.needsStubPortal ? await startStubPortal() : null;
  const folder = join(tmpdir(), `eins-csv-${Date.now()}`);
  await mkdir(folder, { recursive: true });
  console.log(`Writing CSV files to ${folder}`);

  for (const f of files) {
    await writeFile(join(folder, f.name), f.content, "utf8");
  }

  let posted = 0;
  let failed = 0;
  try {
    for (const f of files) {
      const path = join(folder, f.name);
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(path);
      const csv = parseCsv(bytes);
      const mapping = autoDetectMapping(csv.headers);
      if (!mapping) {
        console.warn(`  ${f.name}: no auto-mapping found → skip`);
        continue;
      }
      console.log(
        `  ${f.name}: stream=${mapping.stream} rows=${csv.rows.length}`
      );
      for (let i = 0; i < csv.rows.length; i++) {
        const result = mapCsvRow({
          clinicId: TEST_CLINIC_ID,
          fileHash: csv.contentHash,
          rowIndex: i,
          row: csv.rows[i]!,
          mapping,
        });
        if (!result.ok) {
          console.warn(`    row ${i}: ${result.reason}`);
          continue;
        }
        for (const event of result.events) {
          const ok = await postEvent(event);
          if (ok) {
            posted += 1;
            console.log(`    → ${summarise(event as { kind: string })}`);
          } else {
            failed += 1;
          }
        }
      }
    }
  } finally {
    if (stubPortal) await stubPortal.stop();
  }
  console.log(`Done. posted=${posted} failed=${failed}`);
  return { posted, failed, folder };
}

if (isMain(import.meta.url)) {
  const needsStubPortal = !process.env.PORTAL_BASE_URL;
  runCsvDriver({ needsStubPortal })
    .then(({ failed }) => process.exit(failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
