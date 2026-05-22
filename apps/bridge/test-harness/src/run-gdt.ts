/**
 * GDT driver — generates valid GDT files, parses them with the agent's real
 * parser, normalizes via the agent's real translator, signs + POSTs each
 * canonical event to the portal.
 *
 * This is the cheapest "PVS" of all: GDT is a flat ASCII / ISO-8859 file
 * format defined by KBV. Any PVS that exports GDT — i.e. nearly all of them
 * — can be smoke-tested here without paying anyone anything.
 *
 * The generated files live in a temp folder under the OS temp dir. To wire
 * a *running* agent against them (chokidar watcher → outbox → portal), see
 * the README's "Live agent + GDT folder" recipe; this driver does the same
 * work inline so it doesn't need better-sqlite3 installed.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGdtFile } from "../../agent/src/gdt-parser.js";
import { gdtToCanonical } from "../../agent/src/normalize.js";
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

/**
 * Build one GDT record line per the KBV spec:
 *   LLLFFFFCONTENT\r\n   (LLL = 3-digit length, FFFF = 4-digit Feldkennung)
 * The total LLL includes itself + the field id + the content + CRLF, so
 * length = content.length + 9.
 */
function gdtLine(fk: string, content: string): string {
  const total = content.length + 9;
  const lll = String(total).padStart(3, "0");
  return `${lll}${fk}${content}\r\n`;
}

/** Compose a Satzart 8316 file with Honorar-Positionen — the path that
 *  yields PatientUpserted + EncounterCompleted + InvoicePaid. */
function buildHonorarGdt(opts: {
  pvsPatientId: string;
  firstName: string;
  lastName: string;
  dob: string; // DDMMYYYY
  gender: "1" | "2";
  email: string;
  phone: string;
  bemerkung: string;
  invoiceNumber: string;
  paidAtDmyHms: string; // DDMMYYYYHHMMSS — the GDT spec's date format
  treatmentCode: string;
  treatmentLabel: string;
  amountStrings: string[]; // "12,50" / "1250" / "EUR 12,50"
}): string {
  const lines: string[] = [];
  lines.push(gdtLine("8000", "8316")); // Satzart
  lines.push(gdtLine("3000", opts.pvsPatientId)); // Patient-Nr
  lines.push(gdtLine("3101", opts.lastName));
  lines.push(gdtLine("3102", opts.firstName));
  lines.push(gdtLine("3103", opts.dob));
  lines.push(gdtLine("3110", opts.gender));
  lines.push(gdtLine("3617", opts.email)); // E-Mail
  lines.push(gdtLine("3628", opts.phone)); // Mobil
  lines.push(gdtLine("3622", opts.bemerkung)); // Bemerkung
  lines.push(gdtLine("8410", opts.treatmentCode));
  lines.push(gdtLine("8411", opts.treatmentLabel));
  lines.push(gdtLine("8431", opts.paidAtDmyHms.slice(0, 8))); // date DDMMYYYY
  lines.push(gdtLine("6225", opts.invoiceNumber)); // Rechnungs-Nr.
  lines.push(gdtLine("6228", opts.paidAtDmyHms)); // Zahldatum (DDMMYYYYHHMMSS)
  for (const amt of opts.amountStrings) {
    lines.push(gdtLine("8420", amt));
  }
  return lines.join("");
}

/** A minimal Satzart 6301 (Patient export) — yields only PatientUpserted. */
function buildPatientGdt(opts: {
  pvsPatientId: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender: "1" | "2";
  email: string;
  phone: string;
}): string {
  return [
    gdtLine("8000", "6301"),
    gdtLine("3000", opts.pvsPatientId),
    gdtLine("3101", opts.lastName),
    gdtLine("3102", opts.firstName),
    gdtLine("3103", opts.dob),
    gdtLine("3110", opts.gender),
    gdtLine("3617", opts.email),
    gdtLine("3628", opts.phone),
  ].join("");
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
    console.error(
      `  ✗ POST ${res.status} ${(await res.text()).slice(0, 200)}`
    );
  }
  return res.ok;
}

export async function runGdtDriver(opts: {
  needsStubPortal: boolean;
}): Promise<{ posted: number; failed: number; folder: string }> {
  banner("gdt driver");
  const stubPortal = opts.needsStubPortal ? await startStubPortal() : null;

  const folder = join(tmpdir(), `eins-gdt-${Date.now()}`);
  await mkdir(folder, { recursive: true });
  console.log(`Writing GDT files to ${folder}`);

  const files: Array<{ name: string; content: string }> = [
    {
      name: "patient-601.gdt",
      content: buildPatientGdt({
        pvsPatientId: "601",
        firstName: "Clara",
        lastName: "Lehmann",
        dob: "07071982",
        gender: "2",
        email: "clara.lehmann@example.test",
        phone: "+49 30 5550601",
      }),
    },
    {
      name: "honorar-602.gdt",
      content: buildHonorarGdt({
        pvsPatientId: "602",
        firstName: "Tobias",
        lastName: "Fischer",
        dob: "15031975",
        gender: "1",
        email: "tobias.fischer@example.test",
        phone: "+49 89 5550602",
        bemerkung: "EINS-Lead-baddecaf — Hyaluron Nasolabial",
        invoiceNumber: "2026-00042",
        // GDT 2.x dates are DDMMYYYY, so DDMMYYYYHHMMSS for FK 6228.
        // 20.05.2026 14:05:30
        paidAtDmyHms: "20052026140530",
        treatmentCode: "HYAL-NL",
        treatmentLabel: "Hyaluron Nasolabialfalten",
        amountStrings: ["25000", "EUR 49,90"], // 250.00 + 49.90 = 299.90 EUR
      }),
    },
  ];

  // Write the files to disk — proves the on-prem watcher path works
  // (chokidar can stat what we just wrote).
  for (const f of files) {
    await writeFile(join(folder, f.name), f.content, "latin1");
  }

  let posted = 0;
  let failed = 0;
  try {
    for (const f of files) {
      const path = join(folder, f.name);
      // The parser reads raw bytes (Buffer) and auto-detects encoding.
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(path);
      const parsed = await parseGdtFile(bytes);
      console.log(
        `  ${f.name}: satzart=${parsed.satzart} records=${parsed.records.length} hash=${parsed.contentHash.slice(0, 12)}…`
      );
      const events = gdtToCanonical(parsed, {
        clinicId: TEST_CLINIC_ID,
        contentHash: parsed.contentHash,
      });
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
    // Leave the files on disk so a curious user can inspect them — the temp
    // dir name is printed above. Comment out the next line to auto-clean.
    void rm;
  }
  console.log(`Done. posted=${posted} failed=${failed}`);
  return { posted, failed, folder };
}

if (isMain(import.meta.url)) {
  const needsStubPortal = !process.env.PORTAL_BASE_URL;
  runGdtDriver({ needsStubPortal })
    .then(({ failed }) => process.exit(failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
