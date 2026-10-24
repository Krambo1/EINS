import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLINIC_A,
  CLINIC_B,
  DROPPER_LEDGER,
  DROPPER_STATE_FILE,
} from "./lib/env.js";
import {
  appendJsonl,
  centsToDe,
  chance,
  csvDate,
  ensureDir,
  log,
  pick,
  pickWeighted,
  randInt,
  readJsonFile,
  sleep,
  writeJsonFile,
} from "./lib/util.js";

/**
 * PVS-export simulator for the file path. Praxis B gets Honorar-CSV drops
 * (the ONLY revenue path of the file agent) plus GDT patient files; Praxis A
 * (DB path) gets GDT patient files only. Everything the portal must end up
 * with is recorded in an append-only ledger (dropper-ledger.jsonl), the
 * source of truth the reconciliation compares the portal against.
 *
 * GDT NEVER CARRIES REVENUE. GDT 2.1 has no billing fields (8420 is an
 * "Ergebnis-Wert", a measurement). The agent emits only PatientUpserted from
 * Satzarten 6301 / 6302 / 6311 (PVS -> device) and 6100 (BDT Patientenstamm);
 * every other Satz gives zero events. So no GDT case writes a "paid" or
 * "refund" ledger entry; those come exclusively from the CSV cases.
 *
 * GDT cases (what real PVS such as medatixx / CGM Turbomed do):
 *   gdtPatientCounter     EINSPVS1.NNN (counter 001..999, wraps, skips taken
 *                         names); 6301 / 6302 (+8402) / 6311; optional 8100;
 *                         encodings CP437 (with and without FK 9206), ISO-8859-1
 *                         (9206=3), DIN 66003 (9206=1); optional e-mail/mobile.
 *                         expect: consumed
 *   gdtPatientFixedName   EINSPVS1.GDT; like a conformant PVS it waits (<=60 s)
 *                         until the receiver deleted the previous file.
 *                         expect: consumed
 *   gdtTorn               file visible without its last bytes, completed 4-8 s
 *                         later. expect: consumed
 *   gdtNoFinalCrlf        final CR LF never written (accepted after the torn
 *                         grace). expect: consumed
 *   gdtMultiSatz          2-4 patient Saetze in one file. expect: consumed
 *   gdtForeignDevice      EKG1PVS1.NNN (PVS->ECG) and PVS1EKG1.NNN (ECG->PVS,
 *                         Satzart 6310). Not addressed to EINS: the agent must
 *                         never touch them. Checked by sha256 later, then
 *                         deleted like the device would. expect: untouched
 *   bdtExport             export-<ts>.bdt, 0020 header + 6100 Saetze. Read but
 *                         never deleted. expect: untouched (+ patientIds)
 *   gdtUtf16Garbage       valid 6301 as UTF-16LE addressed to EINS.
 *                         expect: quarantined (zero events, .eins/failed)
 *
 * CSV cases (unchanged): batch, re-drop (must dedup to zero), torn write,
 * refund, duplicate header (must fail loudly), "offen" rows (no revenue),
 * thousands-separator amounts.
 */

interface PendingFile {
  file: string;
  sha256: string;
  /** Epoch ms after which the simulated device/PVS consumes (deletes) it. */
  dueAt: number;
  clinic: "A" | "B";
}

interface DropperState {
  csvN: number;
  patN: number;
  /** Paid-but-not-yet-refunded CSV invoices, with cents. */
  openCsv: Array<{ id: string; cents: number }>;
  /** Last CSV data rows (for verbatim re-drop). */
  lastCsvRows: string[][];
  /** GDT file counters, key `<clinic>:<name prefix>`; value = last used NNN. */
  counters: Record<string, number>;
  /** Files addressed to other receivers / BDT exports that must stay untouched. */
  pending: PendingFile[];
}

export interface DropperOpts {
  /** Mean milliseconds between drops. */
  dropEveryMs?: number;
  edge?: boolean;
}

export interface DropperHandle {
  stop: () => Promise<void>;
  stats: () => { drops: number; paidCents: number; refundCents: number };
}

const VORNAMEN = ["Jürgen", "Käthe", "Björn", "Änne", "Sören", "Marie-Luise"];
const NACHNAMEN = ["Müller", "Größmann", "Schäfer", "Öztürk", "Weiß", "Straßer"];

// ---- GDT encoding ---------------------------------------------------------

export type GdtEnc = "cp437" | "latin1" | "din66003";

const CP437_BYTES: Record<string, number> = {
  Ä: 0x8e, Ö: 0x99, Ü: 0x9a, ä: 0x84, ö: 0x94, ü: 0x81, ß: 0xe1,
};
const DIN66003_CHARS: Record<string, string> = {
  Ä: "[", Ö: "\\", Ü: "]", ä: "{", ö: "|", ü: "}", ß: "~",
};

/** Encode text for a GDT file. Only the umlauts of the name lists + ASCII. */
export function encodeGdtText(value: string, enc: GdtEnc): Buffer {
  if (enc === "latin1") return Buffer.from(value, "latin1");
  const out: number[] = [];
  for (const ch of value) {
    if (enc === "cp437" && CP437_BYTES[ch] !== undefined) {
      out.push(CP437_BYTES[ch]);
    } else if (enc === "din66003" && DIN66003_CHARS[ch] !== undefined) {
      out.push(DIN66003_CHARS[ch].charCodeAt(0));
    } else if (ch.charCodeAt(0) < 0x80) {
      // 7-bit DIN 66003 reuses "@[\]{|}~" for umlauts/§, so a literal one is a bug.
      if (enc === "din66003" && "@[\\]{|}~".includes(ch)) {
        throw new Error(`character ${JSON.stringify(ch)} not representable in DIN 66003`);
      }
      out.push(ch.charCodeAt(0));
    } else {
      throw new Error(`character ${JSON.stringify(ch)} not encodable as ${enc}`);
    }
  }
  return Buffer.from(out);
}

/** One GDT line: `LLLFFFFvalue\r\n`, LLL = whole line in bytes incl. CRLF. */
export function gdtLine(fk: string, value: string, enc: GdtEnc): Buffer {
  const content = encodeGdtText(value, enc);
  const len = 3 + 4 + content.length + 2;
  return Buffer.concat([
    Buffer.from(String(len).padStart(3, "0") + fk, "ascii"),
    content,
    Buffer.from("\r\n", "ascii"),
  ]);
}

/** Encoding plus the FK 9206 value to declare (undefined = omit; spec default CP437). */
export interface EncProfile {
  enc: GdtEnc;
  fk9206?: "1" | "2" | "3";
}

const ENC_PROFILES: ReadonlyArray<readonly [number, EncProfile]> = [
  [3, { enc: "cp437" }],
  [3, { enc: "cp437", fk9206: "2" }],
  [3, { enc: "latin1", fk9206: "3" }],
  [1, { enc: "din66003", fk9206: "1" }],
];

/**
 * Assemble a Satz from FK/value pairs: 8000 first, then (optional) 8100 with
 * the exact byte length of the whole Satz including the 8100 line itself
 * (FK 8100 is written 5 digits wide, so that line is a constant 14 bytes).
 */
export function buildSatz(
  satzart: string,
  fields: ReadonlyArray<readonly [string, string]>,
  enc: GdtEnc,
  withLength: boolean
): Buffer {
  const first = gdtLine("8000", satzart, enc);
  const rest = fields.map(([fk, v]) => gdtLine(fk, v, enc));
  if (!withLength) return Buffer.concat([first, ...rest]);
  const total = first.length + 14 + rest.reduce((n, b) => n + b.length, 0);
  return Buffer.concat([first, gdtLine("8100", String(total).padStart(5, "0"), enc), ...rest]);
}

export interface PatientSatzOpts {
  satzart: "6301" | "6302" | "6311";
  patientId: string;
  profile: EncProfile;
  withLength: boolean;
  /** Empfaenger / Sender GDT-IDs (8315 / 8316). */
  receiver: string;
  sender: string;
  /** GDT 3.x style 3619 e-mail + 3618 mobile (ignored for 7-bit DIN). */
  contact: boolean;
}

function randomDob(): string {
  return `${String(randInt(1, 28)).padStart(2, "0")}${String(randInt(1, 12)).padStart(2, "0")}${randInt(1955, 2003)}`;
}

/** A PVS -> device patient Satz (6301 / 6302 / 6311). */
export function buildPatientSatz(o: PatientSatzOpts): Buffer {
  const fields: Array<[string, string]> = [
    ["8315", o.receiver],
    ["8316", o.sender],
    ["9218", "02.10"],
  ];
  if (o.profile.fk9206) fields.push(["9206", o.profile.fk9206]);
  fields.push(["3000", o.patientId]);
  fields.push(["3101", pick(NACHNAMEN)]);
  fields.push(["3102", pick(VORNAMEN)]);
  fields.push(["3103", randomDob()]);
  fields.push(["3110", pick(["1", "2"])]);
  // "@" is the DIN 66003 position of "§", so 7-bit files carry no e-mail.
  if (o.contact && o.profile.enc !== "din66003") {
    fields.push(["3619", `${o.patientId.toLowerCase()}@example.test`]);
    fields.push(["3618", `01${randInt(51, 79)}${randInt(1000000, 9999999)}`]);
  }
  if (o.satzart === "6302") fields.push(["8402", "EKG01"]);
  return buildSatz(o.satzart, fields, o.profile.enc, o.withLength);
}

/** BDT 6100 Patientenstamm Satz (ISO-8859-1). */
export function buildBdtPatientSatz(patientId: string): Buffer {
  return buildSatz(
    "6100",
    [
      ["3000", patientId],
      ["3101", pick(NACHNAMEN)],
      ["3102", pick(VORNAMEN)],
      ["3103", randomDob()],
    ],
    "latin1",
    false
  );
}

/** ECG device -> PVS result Satz (6310): never addressed to EINS. */
export function buildDeviceResultSatz(patientId: string): Buffer {
  return buildSatz(
    "6310",
    [
      ["8315", "PVS1"],
      ["8316", "EKG1"],
      ["9218", "02.10"],
      ["3000", patientId],
      ["3101", pick(NACHNAMEN)],
      ["3102", pick(VORNAMEN)],
      ["8410", "EKG"],
      ["8420", String(randInt(48, 130))],
    ],
    "cp437",
    false
  );
}

/** PVS -> ECG device order Satz (6302): addressed to EKG1, not to EINS. */
export function buildDeviceOrderSatz(patientId: string): Buffer {
  return buildPatientSatz({
    satzart: "6302",
    patientId,
    profile: { enc: "cp437", fk9206: "2" },
    withLength: false,
    receiver: "EKG1",
    sender: "PVS1",
    contact: false,
  });
}

// ---- CSV building ---------------------------------------------------------

const CSV_HEADER = ["PatNr", "RechnungsNr", "TerminNr", "Endbetrag", "Zahldatum", "Zahlstatus"];

/** cents → German amount string, sometimes with thousands dot ("1.234,56"). */
function centsToDeMaybeGrouped(cents: number): string {
  const plain = centsToDe(cents);
  if (Math.abs(cents) >= 1000_00 && chance(0.5)) {
    const [eur, frac] = plain.replace("-", "").split(",");
    const grouped = eur.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${cents < 0 ? "-" : ""}${grouped},${frac}`;
  }
  return plain;
}

function csvBuffer(rows: string[][]): Buffer {
  const text = [CSV_HEADER.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n") + "\r\n";
  return Buffer.from(text, "latin1");
}

// ---- Dropper --------------------------------------------------------------

const sha256File = (file: string): string | null => {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
};

export function startDropper(opts: DropperOpts = {}): DropperHandle {
  const dropEveryMs = opts.dropEveryMs ?? 45_000;
  const edge = opts.edge ?? false;
  let running = true;
  const stats = { drops: 0, paidCents: 0, refundCents: 0 };

  // Old runs may carry openGdt / gdtN: ignored. New fields default.
  const old = readJsonFile<Partial<DropperState>>(DROPPER_STATE_FILE, {});
  const state: DropperState = {
    csvN: old.csvN ?? 0,
    patN: old.patN ?? 0,
    openCsv: old.openCsv ?? [],
    lastCsvRows: old.lastCsvRows ?? [],
    counters: old.counters ?? {},
    pending: old.pending ?? [],
  };
  const save = () => writeJsonFile(DROPPER_STATE_FILE, state);
  const ledger = (e: Record<string, unknown>) => appendJsonl(DROPPER_LEDGER, e);

  const fileName = (dir: string, prefix: string, ext: string) =>
    join(dir, `${prefix}-${Date.now()}-${randInt(1000, 9999)}.${ext}`);

  function newPatientId(): string {
    state.patN++;
    return `SGP${state.patN}`;
  }

  const clinicFolder = (c: "A" | "B") => (c === "A" ? CLINIC_A.gdtFolder : CLINIC_B.gdtFolder);
  const randClinic = (): "A" | "B" => (chance(0.5) ? "A" : "B");

  /**
   * Next free `<prefix>.NNN` in the clinic folder (counter 001..999, wraps,
   * skips names that still exist). Null after 999 tries (folder full).
   */
  function nextCounterFile(clinic: "A" | "B", prefix: string): string | null {
    const key = `${clinic}:${prefix}`;
    const dir = clinicFolder(clinic);
    for (let i = 0; i < 999; i++) {
      const n = ((state.counters[key] ?? 0) % 999) + 1;
      state.counters[key] = n;
      const file = join(dir, `${prefix}.${String(n).padStart(3, "0")}`);
      if (!existsSync(file)) return file;
    }
    return null;
  }

  function counterFileOrProblem(clinic: "A" | "B", prefix: string): string | null {
    const file = nextCounterFile(clinic, prefix);
    if (!file) {
      ledger({ case: "gdtCounterExhausted", clinic, problem: true, prefix, source: "gdt", kind: "none" });
    }
    return file;
  }

  const randProfile = () => pickWeighted(ENC_PROFILES);

  function randomPatientSatz(patientId: string, receiver = "EINS"): { buf: Buffer; profile: EncProfile; satzart: string } {
    const profile = randProfile();
    const satzart = pickWeighted<"6301" | "6302" | "6311">([
      [80, "6301"],
      [15, "6302"],
      [5, "6311"],
    ]);
    const buf = buildPatientSatz({
      satzart,
      patientId,
      profile,
      withLength: chance(0.3),
      receiver,
      sender: "PVS1",
      contact: chance(0.3),
    });
    return { buf, profile, satzart };
  }

  // -- GDT cases (patient master data only, never revenue) -------------------

  function caseGdtPatientCounter(): void {
    const clinic = randClinic();
    const file = counterFileOrProblem(clinic, "EINSPVS1");
    if (!file) return;
    const patientId = newPatientId();
    const { buf, profile, satzart } = randomPatientSatz(patientId);
    writeFileSync(file, buf);
    ledger({
      case: "gdtPatientCounter", clinic, source: "gdt", kind: "none", expect: "consumed",
      patientIds: [patientId], file, satzart, enc: profile.enc, fk9206: profile.fk9206 ?? null,
    });
  }

  async function caseGdtPatientFixedName(): Promise<void> {
    const clinic = randClinic();
    const file = join(clinicFolder(clinic), "EINSPVS1.GDT");
    // Spec: the sender must not overwrite an unread file; wait for the delete.
    const t0 = Date.now();
    while (existsSync(file) && Date.now() - t0 < 60_000 && running) await sleep(1000);
    if (existsSync(file)) {
      ledger({
        case: "gdtChannelBusy", clinic, source: "gdt", kind: "none",
        waitedMs: Date.now() - t0, file,
      });
      return;
    }
    const patientId = newPatientId();
    const { buf, profile, satzart } = randomPatientSatz(patientId);
    writeFileSync(file, buf);
    ledger({
      case: "gdtPatientFixedName", clinic, source: "gdt", kind: "none", expect: "consumed",
      patientIds: [patientId], file, satzart, enc: profile.enc, fk9206: profile.fk9206 ?? null,
    });
  }

  async function caseGdtTorn(): Promise<void> {
    const clinic = randClinic();
    const file = counterFileOrProblem(clinic, "EINSPVS1");
    if (!file) return;
    const patientId = newPatientId();
    const { buf, profile, satzart } = randomPatientSatz(patientId);
    // Cut INSIDE the last line (it is >= 10 bytes), so part 1 ends mid-line.
    const cut = buf.length - randInt(2, 8);
    writeFileSync(file, buf.subarray(0, cut));
    await sleep(randInt(4000, 8000)); // > watcher stability window
    appendFileSync(file, buf.subarray(cut));
    ledger({
      case: "gdtTorn", clinic, source: "gdt", kind: "none", expect: "consumed",
      patientIds: [patientId], file, satzart, enc: profile.enc,
    });
  }

  function caseGdtNoFinalCrlf(): void {
    const clinic = randClinic();
    const file = counterFileOrProblem(clinic, "EINSPVS1");
    if (!file) return;
    const patientId = newPatientId();
    const profile = randProfile();
    const full = buildPatientSatz({
      satzart: "6301", patientId, profile, withLength: false,
      receiver: "EINS", sender: "PVS1", contact: false,
    });
    writeFileSync(file, full.subarray(0, full.length - 2));
    ledger({
      case: "gdtNoFinalCrlf", clinic, source: "gdt", kind: "none", expect: "consumed",
      patientIds: [patientId], file, enc: profile.enc,
    });
  }

  function caseGdtMultiSatz(): void {
    const clinic = randClinic();
    const file = counterFileOrProblem(clinic, "EINSPVS1");
    if (!file) return;
    const profile = randProfile();
    const patientIds: string[] = [];
    const parts: Buffer[] = [];
    for (let i = randInt(2, 4); i > 0; i--) {
      const id = newPatientId();
      patientIds.push(id);
      parts.push(buildPatientSatz({
        satzart: "6301", patientId: id, profile, withLength: chance(0.3),
        receiver: "EINS", sender: "PVS1", contact: false,
      }));
    }
    writeFileSync(file, Buffer.concat(parts));
    ledger({
      case: "gdtMultiSatz", clinic, source: "gdt", kind: "none", expect: "consumed",
      patientIds, file, enc: profile.enc,
    });
  }

  function addPending(file: string, clinic: "A" | "B"): void {
    const sha = sha256File(file);
    if (!sha) return;
    state.pending.push({ file, sha256: sha, dueAt: Date.now() + randInt(2, 5) * 60_000, clinic });
  }

  function caseGdtForeignDevice(): void {
    const clinic = randClinic();
    const toDevice = counterFileOrProblem(clinic, "EKG1PVS1");
    const fromDevice = counterFileOrProblem(clinic, "PVS1EKG1");
    if (!toDevice || !fromDevice) return;
    writeFileSync(toDevice, buildDeviceOrderSatz(newPatientId()));
    writeFileSync(fromDevice, buildDeviceResultSatz(newPatientId()));
    for (const file of [toDevice, fromDevice]) {
      addPending(file, clinic);
      ledger({ case: "gdtForeignDevice", clinic, source: "gdt", kind: "none", expect: "untouched", file });
    }
  }

  function caseBdtExport(): void {
    const clinic = randClinic();
    const file = join(clinicFolder(clinic), `export-${Date.now()}-${randInt(1000, 9999)}.bdt`);
    const header = buildSatz("0020", [["9206", "3"], ["9218", "02.10"]], "latin1", false);
    const patientIds: string[] = [];
    const parts: Buffer[] = [header];
    for (let i = randInt(2, 4); i > 0; i--) {
      const id = newPatientId();
      patientIds.push(id);
      parts.push(buildBdtPatientSatz(id));
    }
    writeFileSync(file, Buffer.concat(parts));
    addPending(file, clinic);
    ledger({
      case: "bdtExport", clinic, source: "gdt", kind: "none", expect: "untouched",
      patientIds, file,
    });
  }

  function caseGdtUtf16Garbage(): void {
    const clinic = randClinic();
    const file = counterFileOrProblem(clinic, "EINSPVS1");
    if (!file) return;
    const text = buildPatientSatz({
      satzart: "6301", patientId: "SGPX", profile: { enc: "latin1", fk9206: "3" },
      withLength: false, receiver: "EINS", sender: "PVS1", contact: false,
    }).toString("latin1");
    writeFileSync(file, Buffer.from(text, "utf16le"));
    ledger({ case: "gdtUtf16Garbage", clinic, source: "gdt", kind: "none", expect: "quarantined", file });
  }

  /**
   * The simulated ECG device / PVS reads its own files. Due entries: if the
   * file is missing or changed the agent touched a foreign file (problem),
   * else delete it. `checkOnly` (stop): check every entry, delete nothing.
   */
  function processPending(checkOnly: boolean): void {
    const now = Date.now();
    const keep: PendingFile[] = [];
    for (const p of state.pending) {
      if (!checkOnly && p.dueAt > now) {
        keep.push(p);
        continue;
      }
      const sha = sha256File(p.file);
      if (sha !== p.sha256) {
        ledger({
          case: "foreignFileTouched", clinic: p.clinic, problem: true, file: p.file,
          detail: sha === null ? "file missing" : "content changed",
        });
        continue;
      }
      if (checkOnly) {
        keep.push(p);
        continue;
      }
      try {
        unlinkSync(p.file);
      } catch {
        // already gone: the next check would flag it, but it was just consumed by "the device"
      }
    }
    state.pending = keep;
  }

  function makeCsvPaidRows(n: number): string[][] {
    const rows: string[][] = [];
    for (let i = 0; i < n; i++) {
      state.csvN++;
      const invoiceId = `SCSV${state.csvN}`;
      const cents = randInt(90_00, 4_200_00);
      rows.push([
        newPatientId(),
        invoiceId,
        `T${randInt(1000, 99999)}`,
        centsToDeMaybeGrouped(cents),
        csvDate(new Date()),
        "bezahlt",
      ]);
      state.openCsv.push({ id: invoiceId, cents });
      stats.paidCents += cents;
    }
    return rows;
  }

  function caseCsvBatch(): void {
    const paidRows = makeCsvPaidRows(randInt(5, 40));
    const rows = [...paidRows];
    // 0-3 offen rows that must NOT book revenue (H2 status gate).
    const nOffen = randInt(0, 3);
    for (let i = 0; i < nOffen; i++) {
      state.csvN++;
      rows.push([
        newPatientId(),
        `SCSV${state.csvN}`,
        `T${randInt(1000, 99999)}`,
        centsToDeMaybeGrouped(randInt(90_00, 2_000_00)),
        csvDate(new Date()),
        "offen",
      ]);
    }
    const file = fileName(CLINIC_B.csvFolder, "honorar", "csv");
    writeFileSync(file, csvBuffer(rows));
    state.lastCsvRows = rows;
    for (const r of paidRows) {
      ledger({ case: "csvBatch", clinic: "B", source: "csv", kind: "paid", invoiceId: r[1], cents: centsFromLedgerRow(r), file });
    }
    if (nOffen > 0) {
      ledger({ case: "csvBatch.offenRows", clinic: "B", source: "csv", kind: "none", count: nOffen, file });
    }
  }

  // The ledger needs the exact cents; re-derive from the state entry rather
  // than re-parsing the formatted string.
  function centsFromLedgerRow(row: string[]): number {
    const found = state.openCsv.find((e) => e.id === row[1]);
    return found ? found.cents : 0;
  }

  function caseCsvRedrop(): void {
    if (state.lastCsvRows.length === 0) return caseCsvBatch();
    const file = fileName(CLINIC_B.csvFolder, "redrop", "csv");
    writeFileSync(file, csvBuffer(state.lastCsvRows));
    ledger({ case: "csvRedrop", clinic: "B", source: "csv", kind: "none", rows: state.lastCsvRows.length, file });
  }

  async function caseCsvTorn(): Promise<void> {
    const rows = makeCsvPaidRows(randInt(4, 10));
    const buf = csvBuffer(rows);
    const cut = Math.max(20, buf.length - randInt(10, 30)); // mid-last-row, no trailing newline
    const file = fileName(CLINIC_B.csvFolder, "torn", "csv");
    writeFileSync(file, buf.subarray(0, cut));
    ledger({ case: "csvTorn.part1", clinic: "B", source: "csv", kind: "none", file });
    await sleep(randInt(5000, 9000)); // > csv watcher stability window (2s)
    appendFileSync(file, buf.subarray(cut));
    for (const r of rows) {
      ledger({ case: "csvTorn.completed", clinic: "B", source: "csv", kind: "paid", invoiceId: r[1], cents: centsFromLedgerRow(r), file });
    }
  }

  function caseCsvRefund(): void {
    if (state.openCsv.length === 0) return caseCsvBatch();
    const idx = randInt(0, state.openCsv.length - 1);
    const inv = state.openCsv.splice(idx, 1)[0]; // one refund per invoice, ever
    const refundCents = chance(0.6) ? inv.cents : randInt(10_00, inv.cents);
    const row = [
      newPatientId(),
      inv.id,
      `T${randInt(1000, 99999)}`,
      centsToDe(-refundCents),
      csvDate(new Date()),
      "storniert",
    ];
    const file = fileName(CLINIC_B.csvFolder, "storno", "csv");
    writeFileSync(file, csvBuffer([row]));
    stats.refundCents += refundCents;
    ledger({ case: "csvRefund", clinic: "B", source: "csv", kind: "refund", invoiceId: inv.id, cents: -refundCents, file });
  }

  function caseCsvDupHeader(): void {
    const text =
      ["PatNr;PatNr;RechnungsNr;Endbetrag;Zahldatum;Zahlstatus",
       `SGPX;SGPX;SCSV-DUP-IGNORED;99,99;${csvDate(new Date())};bezahlt`,
      ].join("\r\n") + "\r\n";
    const file = fileName(CLINIC_B.csvFolder, "dup-header", "csv");
    writeFileSync(file, Buffer.from(text, "latin1"));
    ledger({ case: "csvDupHeader", clinic: "B", source: "csv", kind: "none", file });
  }

  // -- loop ----------------------------------------------------------------

  const loop = (async () => {
    ensureDir(CLINIC_A.gdtFolder);
    ensureDir(CLINIC_B.gdtFolder);
    ensureDir(CLINIC_B.csvFolder);
    while (running) {
      const gap = Math.max(500, Math.round(-Math.log(1 - Math.random()) * dropEveryMs));
      await sleep(gap);
      if (!running) break;
      try {
        processPending(false);
      } catch (err) {
        ledger({ case: "ERROR", message: `pending: ${(err as Error).message}` });
      }
      const drop = pickWeighted<() => void | Promise<void>>([
        // GDT: patient master data only, zero revenue
        [14, caseGdtPatientCounter],
        [6, caseGdtPatientFixedName],
        [5, caseGdtTorn],
        [2, caseGdtNoFinalCrlf],
        [2, caseGdtMultiSatz],
        [4, caseGdtForeignDevice],
        [2, caseBdtExport],
        [2, caseGdtUtf16Garbage],
        // CSV: all revenue
        [24, caseCsvBatch],
        [8, caseCsvRedrop],
        [10, caseCsvRefund],
        [8, caseCsvTorn],
        [3, caseCsvDupHeader],
      ]);
      try {
        await drop();
        stats.drops++;
        save();
      } catch (err) {
        ledger({ case: "ERROR", message: (err as Error).message });
        await sleep(2000);
      }
    }
    save();
  })();

  return {
    stop: async () => {
      running = false;
      await loop;
      try {
        processPending(false); // consume what is due
        processPending(true); // check (never delete) the rest
      } catch (err) {
        ledger({ case: "ERROR", message: `pending: ${(err as Error).message}` });
      }
      save();
      log("dropper", `stopped after ${stats.drops} drops`);
    },
    stats: () => ({ ...stats }),
  };
}

// Standalone: `tsx src/dropper.ts [dropEveryMs]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handle = startDropper({ dropEveryMs: Number(process.argv[2] ?? 45000) });
  process.on("SIGINT", async () => {
    await handle.stop();
    process.exit(0);
  });
  log("dropper", "running standalone — Ctrl+C to stop");
}
