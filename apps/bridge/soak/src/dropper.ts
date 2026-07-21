import { appendFileSync, writeFileSync } from "node:fs";
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
  gdtDate,
  log,
  pick,
  pickWeighted,
  randInt,
  readJsonFile,
  sleep,
  writeJsonFile,
} from "./lib/util.js";

/**
 * GDT/CSV-Export-Simulator for Praxis B (Datei-Pfad) + occasional
 * patient-only GDT for Praxis A. Every financially relevant row is recorded
 * in an append-only ledger (dropper-ledger.jsonl) which is the source of
 * truth the reconciliation compares the portal against.
 *
 * Nasty cases exercised on purpose:
 *   - torn writes (file appears without its final CR LF, completed seconds
 *     later) for both GDT and CSV
 *   - ISO-8859-1/CP1252 vs UTF-8 umlauts, plus a UTF-16 garbage file that
 *     must produce ZERO events without killing the agent
 *   - multi-Satz BDT batch files (one invoice per Satz)
 *   - thousands-separator amounts ("1.234,56")
 *   - duplicate-header CSV (must fail loudly, zero events)
 *   - offen-status rows (must be skipped, zero revenue)
 *   - full re-drops of already-delivered rows (must dedup to zero)
 */

interface DropperState {
  gdtN: number;
  csvN: number;
  patN: number;
  /** Paid-but-not-yet-refunded invoices per source, with cents. */
  openGdt: Array<{ id: string; cents: number }>;
  openCsv: Array<{ id: string; cents: number }>;
  /** Last CSV data rows (for verbatim re-drop). */
  lastCsvRows: string[][];
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
const LEISTUNGEN: ReadonlyArray<readonly [string, string]> = [
  ["A5300", "Botox Zornesfalte"],
  ["A5301", "Hyaluron Nasolabial"],
  ["A5302", "Laser Couperose"],
  ["A5303", "Kryolipolyse Flanken"],
];

// ---- GDT encoding ---------------------------------------------------------

type Enc = "latin1" | "utf8";

function gdtLine(fk: string, value: string, enc: Enc): Buffer {
  const content = Buffer.from(value, enc);
  const len = 3 + 4 + content.length + 2; // LLL + FFFF + content + CRLF
  return Buffer.concat([
    Buffer.from(String(len).padStart(3, "0"), "ascii"),
    Buffer.from(fk, "ascii"),
    content,
    Buffer.from("\r\n", "ascii"),
  ]);
}

interface GdtInvoice {
  invoiceId: string;
  /** Signed cents; the file may split it into several 8420 lines. */
  cents: number;
}

function buildSatz(
  satzart: string,
  patientId: string,
  enc: Enc,
  invoice?: GdtInvoice
): Buffer {
  const vor = pick(VORNAMEN);
  const nach = pick(NACHNAMEN);
  const lines: Buffer[] = [
    gdtLine("8000", satzart, enc),
    gdtLine("3000", patientId, enc),
    gdtLine("3101", nach, enc),
    gdtLine("3102", vor, enc),
    gdtLine("3103", `${String(randInt(1, 28)).padStart(2, "0")}${String(randInt(1, 12)).padStart(2, "0")}${randInt(1955, 2003)}`, enc),
    gdtLine("3110", pick(["1", "2"]), enc),
  ];
  if (invoice) {
    const [code, label] = pick(LEISTUNGEN);
    lines.push(gdtLine("6225", invoice.invoiceId, enc));
    lines.push(gdtLine("6228", gdtDate(new Date()), enc));
    lines.push(gdtLine("8410", code, enc));
    lines.push(gdtLine("8411", label, enc));
    // Split the total into 1-3 Honorar-Positionen; the parser sums them.
    const parts = splitCents(invoice.cents, randInt(1, 3));
    for (const p of parts) lines.push(gdtLine("8420", centsToDe(p), enc));
  }
  return Buffer.concat(lines);
}

function splitCents(total: number, n: number): number[] {
  if (n <= 1) return [total];
  const sign = total < 0 ? -1 : 1;
  let rest = Math.abs(total);
  const parts: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const cut = randInt(1, Math.max(1, rest - (n - 1 - i)));
    parts.push(sign * cut);
    rest -= cut;
  }
  parts.push(sign * rest);
  return parts;
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

export function startDropper(opts: DropperOpts = {}): DropperHandle {
  const dropEveryMs = opts.dropEveryMs ?? 45_000;
  const edge = opts.edge ?? false;
  let running = true;
  const stats = { drops: 0, paidCents: 0, refundCents: 0 };

  const state = readJsonFile<DropperState>(DROPPER_STATE_FILE, {
    gdtN: 0,
    csvN: 0,
    patN: 0,
    openGdt: [],
    openCsv: [],
    lastCsvRows: [],
  });
  const save = () => writeJsonFile(DROPPER_STATE_FILE, state);
  const ledger = (e: Record<string, unknown>) => appendJsonl(DROPPER_LEDGER, e);

  const fileName = (dir: string, prefix: string, ext: string) =>
    join(dir, `${prefix}-${Date.now()}-${randInt(1000, 9999)}.${ext}`);

  function newPatientId(): string {
    state.patN++;
    return `SGP${state.patN}`;
  }

  // -- cases ---------------------------------------------------------------

  function caseGdtPaid(): void {
    state.gdtN++;
    const invoiceId = `SGDT${state.gdtN}`;
    const cents = randInt(90_00, 3_800_00);
    const enc: Enc = chance(0.7) ? "latin1" : "utf8";
    const buf = buildSatz("8316", newPatientId(), enc, { invoiceId, cents });
    const file = fileName(CLINIC_B.gdtFolder, "honorar", "gdt");
    writeFileSync(file, buf);
    state.openGdt.push({ id: invoiceId, cents });
    stats.paidCents += cents;
    ledger({ case: "gdtPaid", clinic: "B", source: "gdt", kind: "paid", invoiceId, cents, file, enc });
  }

  async function caseGdtTornPaid(): Promise<void> {
    state.gdtN++;
    const invoiceId = `SGDT${state.gdtN}`;
    const cents = randInt(90_00, 3_800_00);
    const buf = buildSatz("8316", newPatientId(), "latin1", { invoiceId, cents });
    // Split INSIDE a line so part 1 cannot end on CR LF.
    const cut = Math.max(10, buf.length - randInt(15, 40));
    const file = fileName(CLINIC_B.gdtFolder, "torn", "gdt");
    writeFileSync(file, buf.subarray(0, cut));
    ledger({ case: "gdtTorn.part1", clinic: "B", source: "gdt", kind: "none", file });
    await sleep(randInt(4000, 8000)); // > watcher stability window
    appendFileSync(file, buf.subarray(cut));
    state.openGdt.push({ id: invoiceId, cents });
    stats.paidCents += cents;
    ledger({ case: "gdtTorn.completed", clinic: "B", source: "gdt", kind: "paid", invoiceId, cents, file });
  }

  function caseGdtRefund(): void {
    if (state.openGdt.length === 0) return caseGdtPaid();
    const idx = randInt(0, state.openGdt.length - 1);
    const inv = state.openGdt.splice(idx, 1)[0]; // one refund per invoice, ever
    const refundCents = chance(0.6) ? inv.cents : randInt(10_00, inv.cents);
    const buf = buildSatz("8316", newPatientId(), "latin1", {
      invoiceId: inv.id,
      cents: -refundCents,
    });
    const file = fileName(CLINIC_B.gdtFolder, "storno", "gdt");
    writeFileSync(file, buf);
    stats.refundCents += refundCents;
    ledger({ case: "gdtRefund", clinic: "B", source: "gdt", kind: "refund", invoiceId: inv.id, cents: -refundCents, file });
  }

  function caseBdtMultiSatz(): void {
    const n = randInt(2, 4);
    const bufs: Buffer[] = [];
    const entries: Array<{ invoiceId: string; cents: number }> = [];
    for (let i = 0; i < n; i++) {
      state.gdtN++;
      const invoiceId = `SGDT${state.gdtN}`;
      const cents = randInt(90_00, 2_000_00);
      bufs.push(buildSatz("8316", newPatientId(), "latin1", { invoiceId, cents }));
      entries.push({ invoiceId, cents });
    }
    const file = fileName(CLINIC_B.gdtFolder, "bdt-batch", "gdt");
    writeFileSync(file, Buffer.concat(bufs));
    for (const e of entries) {
      state.openGdt.push({ id: e.invoiceId, cents: e.cents });
      stats.paidCents += e.cents;
      ledger({ case: "bdtMultiSatz", clinic: "B", source: "gdt", kind: "paid", invoiceId: e.invoiceId, cents: e.cents, file });
    }
  }

  function caseGdtPatientOnly(): void {
    const toA = chance(0.5);
    const dir = toA ? CLINIC_A.gdtFolder : CLINIC_B.gdtFolder;
    const buf = buildSatz("6301", newPatientId(), chance(0.5) ? "latin1" : "utf8");
    const file = fileName(dir, "patient", "gdt");
    writeFileSync(file, buf);
    ledger({ case: "gdtPatientOnly", clinic: toA ? "A" : "B", source: "gdt", kind: "none", file });
  }

  function caseUtf16Garbage(): void {
    const text = buildSatz("8316", "SGPX", "latin1", {
      invoiceId: "SGDT-UTF16-IGNORED",
      cents: 123_45,
    }).toString("latin1");
    const utf16 = Buffer.from(text, "utf16le");
    // Final raw 0x0A byte: decoded as latin1 the text ends with "\n", so the
    // parser sees a "complete" file of garbage lines → zero events expected,
    // agent must survive.
    const buf = Buffer.concat([utf16, Buffer.from([0x0a])]);
    const file = fileName(CLINIC_B.gdtFolder, "utf16", "gdt");
    writeFileSync(file, buf);
    ledger({ case: "utf16Garbage", clinic: "B", source: "gdt", kind: "none", file });
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
      const drop = pickWeighted<() => void | Promise<void>>([
        [26, caseGdtPaid],
        [10, caseGdtPatientOnly],
        [15, caseCsvBatch],
        [7, caseCsvRedrop],
        [7, caseGdtRefund],
        [7, caseCsvRefund],
        [6, caseGdtTornPaid],
        [5, caseCsvTorn],
        [5, caseBdtMultiSatz],
        [3, caseUtf16Garbage],
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
