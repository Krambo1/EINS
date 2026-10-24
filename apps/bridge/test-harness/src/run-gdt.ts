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
 * Build one GDT line per the GDT 2.1 spec (QMS):
 *   LLLFFFFCONTENT
   (LLL = total BYTE length of the line, including
 *   itself, the 4-digit Feldkennung, the content and CR LF).
 * Content is encoded CP437 (the spec default when FK 9206 is absent), so
 * the byte length equals the character count for the characters used here.
 */
function gdtLine(fk: string, content: string): string {
  const total = content.length + 9;
  const lll = String(total).padStart(3, "0");
  return `${lll}${fk}${content}
`;
}

/** CP437 for the German letters the fixtures use (spec default charset). */
const CP437: Record<string, number> = {
  "Ä": 0x8e, "Ö": 0x99, "Ü": 0x9a, "ä": 0x84, "ö": 0x94, "ü": 0x81, "ß": 0xe1,
};
function encodeCp437(text: string): Buffer {
  return Buffer.from(
    Array.from(text, (ch) => CP437[ch] ?? (ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : 0x3f))
  );
}

interface PatientFields {
  pvsPatientId: string;
  firstName: string;
  lastName: string;
  dob: string; // DDMMYYYY
  gender: "1" | "2";
  email?: string; // GDT 3.x FK 3619
  mobile?: string; // GDT 3.x FK 3618
}

/**
 * One PVS→device Satz addressed to EINS: what a PVS sends when the MFA opens
 * a patient for the "EINS" GDT device. Satzart 6301 (Stammdaten übermitteln)
 * or 6302 (neue Untersuchung anfordern, carries 8402). GDT has no billing
 * fields: the agent turns these into PatientUpserted and nothing else.
 */
function buildPatientSatz(
  satzart: "6301" | "6302",
  p: PatientFields,
  extra: Array<[string, string]> = []
): string {
  const lines = [
    gdtLine("8000", satzart),
    gdtLine("8315", "EINS"), // receiver GDT-ID
    gdtLine("8316", "PVS1"), // sender GDT-ID (a FIELD, not a Satzart)
    gdtLine("9218", "02.10"),
    gdtLine("3000", p.pvsPatientId),
    gdtLine("3101", p.lastName),
    gdtLine("3102", p.firstName),
    gdtLine("3103", p.dob),
    gdtLine("3110", p.gender),
  ];
  if (p.mobile) lines.push(gdtLine("3618", p.mobile));
  if (p.email) lines.push(gdtLine("3619", p.email));
  if (satzart === "6302") lines.push(gdtLine("8402", "EINS01"));
  for (const [fk, v] of extra) lines.push(gdtLine(fk, v));
  return lines.join("");
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

  // File names follow the spec: <receiver><sender>.NNN or .GDT. The agent only
  // consumes files addressed to its receiver id ("EINS").
  const files: Array<{ name: string; content: string; expectIds: string[] }> = [
    {
      name: "EINSPVS1.001",
      content: buildPatientSatz("6301", {
        pvsPatientId: "601",
        firstName: "Clara",
        lastName: "Lehmann",
        dob: "07071982",
        gender: "2",
      }),
      expectIds: ["601"],
    },
    {
      name: "EINSPVS1.GDT",
      // GDT 3.x contact fields + the EINS lead token in a free-text field
      // (6227 Kommentar): the only way a token reaches the agent over GDT.
      content: buildPatientSatz(
        "6302",
        {
          pvsPatientId: "602",
          firstName: "Jürgen",
          lastName: "Größmann",
          dob: "15031975",
          gender: "1",
          email: "juergen.groessmann@example.test",
          mobile: "+49 89 5550602",
        },
        [["6227", "Anfrage EINS-Lead-baddecaf Hyaluron"]]
      ),
      expectIds: ["602"],
    },
    {
      name: "EINSPVS1.002",
      // Two Sätze in one file (allowed by the spec).
      content:
        buildPatientSatz("6301", {
          pvsPatientId: "603",
          firstName: "Änne",
          lastName: "Schäfer",
          dob: "01011990",
          gender: "2",
        }) +
        buildPatientSatz("6301", {
          pvsPatientId: "604",
          firstName: "Sören",
          lastName: "Weiß",
          dob: "31121969",
          gender: "1",
        }),
      expectIds: ["603", "604"],
    },
  ];

  for (const f of files) {
    await writeFile(join(folder, f.name), encodeCp437(f.content));
  }

  let posted = 0;
  let failed = 0;
  const problems: string[] = [];
  try {
    for (const f of files) {
      const path = join(folder, f.name);
      // The parser reads raw bytes (Buffer) and auto-detects the charset.
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(path);
      const parsed = await parseGdtFile(bytes);
      console.log(
        `  ${f.name}: saetze=${parsed.saetze.length} encoding=${parsed.encoding} hash=${parsed.contentHash.slice(0, 12)}…`
      );
      const events = gdtToCanonical(parsed, {
        clinicId: TEST_CLINIC_ID,
        contentHash: parsed.contentHash,
      });
      // GDT carries patient master data only: anything else is a regression.
      const ids = events.map((e) => String(e.pvsPatientId));
      if (events.some((e) => e.kind !== "PatientUpserted")) {
        problems.push(`${f.name}: non-patient event ${events.map((e) => e.kind).join(",")}`);
      }
      if (ids.join(",") !== f.expectIds.join(",")) {
        problems.push(`${f.name}: patient ids ${ids.join(",")} != ${f.expectIds.join(",")}`);
      }
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
    const umlaut = files[1];
    const reparsed = gdtToCanonical(
      await parseGdtFile(encodeCp437(umlaut.content)),
      { clinicId: TEST_CLINIC_ID, contentHash: "x" }
    )[0];
    if (reparsed?.fullName !== "Jürgen Größmann") {
      problems.push(`CP437 umlauts decoded as '${String(reparsed?.fullName)}'`);
    }
    if (reparsed?.bemerkung !== "EINS-Lead-baddecaf") {
      problems.push(`lead token read as '${String(reparsed?.bemerkung)}'`);
    }
  } finally {
    if (stubPortal) await stubPortal.stop();
    // Leave the files on disk so a curious user can inspect them — the temp
    // dir name is printed above. Comment out the next line to auto-clean.
    void rm;
  }
  for (const p of problems) console.error(`  ✗ ${p}`);
  failed += problems.length;
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
