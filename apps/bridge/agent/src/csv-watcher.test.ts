import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import iconv from "iconv-lite";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CsvMapping } from "./csv-mapper.js";

let tempDir: string;
let honorarDir: string;

vi.mock("./config.js", () => ({
  outboxPath: () => join(tempDir, "outbox.sqlite"),
}));

let outbox: typeof import("./outbox");
let watcherMod: typeof import("./csv-watcher");

const CLINIC = "00000000-0000-0000-0000-000000000001";
const HEADER = "Patient-Nr.;Rechnungs-Nr.;Name;GOÄ-Ziffer;Betrag;Bezahldatum";

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "eins-csv-watcher-"));
  honorarDir = join(tempDir, "honorar");
  mkdirSync(honorarDir);
  vi.resetModules();
  outbox = await import("./outbox.js");
  outbox.setOutboxKey("c".repeat(64));
  watcherMod = await import("./csv-watcher.js");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  outbox._closeForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

/** CP1252 bytes + CRLF, like a German PVS export; mtime far in the past. */
function writeCsv(name: string, text: string, opts: { trailingNewline?: boolean } = {}): string {
  const body = text.split("\n").join("\r\n") + (opts.trailingNewline === false ? "" : "\r\n");
  const p = join(honorarDir, name);
  writeFileSync(p, iconv.encode(body, "win1252"));
  const old = new Date(Date.now() - 60_000);
  utimesSync(p, old, old);
  return p;
}

function start(extra: Partial<Parameters<typeof watcherMod.watchHonorarFolder>[0]> = {}) {
  return watcherMod.watchHonorarFolder({
    folder: honorarDir,
    clinicId: CLINIC,
    useChokidar: false,
    rescanIntervalMs: 3_600_000,
    ...extra,
  });
}

function events(): Array<Record<string, unknown>> {
  return outbox.dueRows(100_000).map((r) => JSON.parse(r.payload) as Record<string, unknown>);
}

describe("csv-watcher: Honorar ingestion", () => {
  it("line-item export: sums all rows of one invoice into ONE event with the total in its id", async () => {
    writeCsv(
      "honorar_2026-10.csv",
      [
        HEADER,
        "PAT-1;RE-100;Müller, Jürgen;GOÄ 5;100,00;05.10.2026",
        "PAT-1;RE-100;Müller, Jürgen;GOÄ 250;50,50;05.10.2026",
        "PAT-1;RE-100;Müller, Jürgen;GOÄ 1;20,00;07.10.2026",
        "PAT-2;RE-101;Böhm, Änne;GOÄ 5;80,00;06.10.2026",
        "PAT-2;RE-101;Böhm, Änne;GOÄ 250;1.000,00;06.10.2026",
        "PAT-2;RE-101;Böhm, Änne;GOÄ 1;5,00;06.10.2026",
        "Summe;ges;1.255,50;07.10.2026",
      ].join("\n")
    );
    const w = start();
    await w.rescan();
    const evs = events();
    expect(evs).toHaveLength(2);
    const byInv = Object.fromEntries(evs.map((e) => [e.pvsInvoiceId as string, e]));
    expect(byInv["RE-100"].amountCents).toBe(17050);
    expect(byInv["RE-100"].pvsExternalEventId).toBe("csv-local:invoice:RE-100:17050");
    // paidAt = latest row date (07.10. noon Berlin = 10:00Z in CEST)
    expect(byInv["RE-100"].paidAt).toBe("2026-10-07T10:00:00.000Z");
    expect(byInv["RE-101"].amountCents).toBe(108500);
    // No bogus invoice "ges" from the Summe line.
    expect(evs.some((e) => e.pvsInvoiceId === "ges")).toBe(false);

    const s = w.status();
    expect(s.ledger).toMatchObject({ done: 1, failed: 0, ignored: 0 });
    expect(s.lastFile).toMatchObject({ rows: 7, invoices: 2, inserted: 2, duplicates: 0 });
    expect(s.lastHeaderColumns).toEqual(HEADER.split(";"));
    expect(s.lastProcessedAt).not.toBeNull();
    w.stop();
  });

  it("corrected re-export re-emits with the new total; the identical total dedups", async () => {
    writeCsv("a.csv", [HEADER, "PAT-1;RE-100;X;GOÄ 5;100,00;05.10.2026"].join("\n"));
    const w = start();
    await w.rescan();
    expect(events()).toHaveLength(1);

    // Overlapping re-export, same total: dedup, reported honestly.
    writeCsv("b.csv", [HEADER, "PAT-1;RE-100;X;GOÄ 5;100,00;05.10.2026"].join("\n"));
    await w.rescan();
    expect(events()).toHaveLength(1);
    expect(w.status().lastFile).toMatchObject({ inserted: 0, duplicates: 1 });

    // Correction: another line item was added, total changes.
    writeCsv(
      "c.csv",
      [HEADER, "PAT-1;RE-100;X;GOÄ 5;100,00;05.10.2026", "PAT-1;RE-100;X;GOÄ 6;30,00;08.10.2026"].join("\n")
    );
    await w.rescan();
    const ids = events().map((e) => e.pvsExternalEventId);
    expect(ids).toContain("csv-local:invoice:RE-100:10000");
    expect(ids).toContain("csv-local:invoice:RE-100:13000");
    w.stop();
  });

  it("net negative invoice -> InvoiceRefunded; net zero -> InvoicePaid 0 (pass 2)", async () => {
    writeCsv(
      "n.csv",
      [
        HEADER,
        "PAT-1;RE-1;X;a;100,00;05.10.2026",
        "PAT-1;RE-1;X;a;-250,00;06.10.2026",
        "PAT-2;RE-2;X;a;40,00;05.10.2026",
        "PAT-2;RE-2;X;a;40,00-;06.10.2026",
      ].join("\n")
    );
    const w = start();
    await w.rescan();
    const evs = events();
    // Pass 2: RE-2 nets to 0 and is emitted as 0 €, so an amount an earlier
    // export sent for it stops counting.
    expect(evs).toHaveLength(2);
    expect(evs[0].kind).toBe("InvoiceRefunded");
    expect(evs[0].refundedAmountCents).toBe(15000);
    expect(evs[0].pvsExternalEventId).toBe("csv-local:refund:RE-1:15000");
    expect(evs[1]).toMatchObject({ kind: "InvoicePaid", pvsInvoiceId: "RE-2", amountCents: 0 });
    expect(typeof evs[1].sourceRevision).toBe("number");
    w.stop();
  });

  it("sep=; line, title line and a last row WITHOUT trailing newline", async () => {
    writeCsv(
      "excel.csv",
      [
        "sep=;",
        "Honorarliste Praxis Dr. Müller;;;;;",
        ";;;;;",
        HEADER,
        "PAT-1;RE-1;X;a;100,00;05.10.2026",
        "PAT-2;RE-2;X;a;60,00;06.10.2026",
      ].join("\n"),
      { trailingNewline: false }
    );
    const w = start();
    await w.rescan();
    const evs = events();
    expect(evs.map((e) => e.pvsInvoiceId).sort()).toEqual(["RE-1", "RE-2"]);
    expect(w.status().lastFile?.rows).toBe(2);
    w.stop();
  });

  it("a single-row file without trailing newline emits its row", async () => {
    writeCsv("one.csv", [HEADER, "PAT-1;RE-1;X;a;100,00;05.10.2026"].join("\n"), {
      trailingNewline: false,
    });
    const w = start();
    await w.rescan();
    expect(events()).toHaveLength(1);
    w.stop();
  });

  it("storniert rows with a positive amount are not revenue, are counted, and zero their invoice (pass 2)", async () => {
    writeCsv(
      "s.csv",
      [
        "Patient-Nr.;Rechnungs-Nr.;Betrag;Bezahldatum;Zahlstatus",
        "PAT-1;RE-1;100,00;05.10.2026;Ausgeglichen",
        "PAT-2;RE-2;70,00;05.10.2026;Storniert",
        "PAT-3;RE-3;30,00;05.10.2026;offen",
      ].join("\n")
    );
    const w = start();
    await w.rescan();
    const evs = events();
    expect(evs.map((e) => [e.pvsInvoiceId, e.amountCents])).toEqual([
      ["RE-1", 10000],
      ["RE-2", 0],
    ]);
    const logged = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(logged).toContain("storno=1");
    expect(logged).toContain("notPaid=1");
    w.stop();
  });

  it("pass 2: rows that cannot be read are counted in the status (heartbeat), not only logged", async () => {
    writeCsv(
      "partly.csv",
      [HEADER, "PAT-1;RE-1;X;a;100,00;05.10.2026", "PAT-2;RE-2;X;a;kaputt;05.10.2026"].join("\n")
    );
    const w = start();
    await w.rescan();
    expect(events().map((e) => e.pvsInvoiceId)).toEqual(["RE-1"]);
    const st = w.status();
    expect(st.skippedRows).toBe(1);
    expect(st.lastSkipReason).toBeTruthy();
    w.stop();
  });

  it("an invoice number with two different patients inside one file is ignored and warned", async () => {
    writeCsv(
      "conflict.csv",
      [HEADER, "PAT-1;RE-1;X;a;100,00;05.10.2026", "PAT-9;RE-1;X;a;50,00;05.10.2026", "PAT-2;RE-2;X;a;10,00;05.10.2026"].join(
        "\n"
      )
    );
    const w = start();
    await w.rescan();
    expect(events().map((e) => e.pvsInvoiceId)).toEqual(["RE-2"]);
    const logged = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(logged).toContain("conflictingInvoices=1");
    w.stop();
  });

  it("never logs cell values (patient ids, invoice numbers, names)", async () => {
    writeCsv(
      "priv.csv",
      [HEADER, "PAT-SECRET;RE-SECRET;Geheim, Gerda;a;100,00;05.10.2026", "PAT-SECRET;RE-SECRET2;Geheim, Gerda;a;xx;05.10.2026"].join("\n")
    );
    const w = start();
    await w.rescan();
    const all = [console.log, console.warn, console.error]
      .flatMap((fn) => (fn as unknown as ReturnType<typeof vi.fn>).mock.calls)
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(all).not.toMatch(/SECRET|Geheim|Gerda/);
    w.stop();
  });

  it("EBUSY on read: file is marked failed, retried after the backoff, never stranded", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    const p = join(honorarDir, "busy.csv");
    writeFileSync(p, iconv.encode([HEADER, "PAT-1;RE-1;X;a;100,00;05.10.2026", ""].join("\r\n"), "win1252"));
    const old = new Date("2026-10-07T11:00:00Z");
    utimesSync(p, old, old);

    let busy = true;
    const reader = async (path: string): Promise<Buffer> => {
      if (busy) {
        const e = new Error(`EBUSY: resource busy or locked, open '${path}'`) as NodeJS.ErrnoException;
        e.code = "EBUSY";
        throw e;
      }
      return readFile(path);
    };
    const w = start({ readFile: reader });
    await w.rescan();
    expect(events()).toHaveLength(0);
    expect(w.status().ledger).toMatchObject({ failed: 1, done: 0 });
    // The error text never carries the path.
    expect(w.status().ledger?.lastError).toBe("read_failed: EBUSY");

    // A NEWER file succeeds meanwhile (this stranded the old mtime cursor).
    const p2 = join(honorarDir, "newer.csv");
    writeFileSync(p2, iconv.encode([HEADER, "PAT-2;RE-2;X;a;5,00;05.10.2026", ""].join("\r\n"), "win1252"));
    utimesSync(p2, old, old);
    busy = false;
    await w.rescan();
    // busy.csv is still inside its 30 s backoff, newer.csv went through.
    expect(events().map((e) => e.pvsInvoiceId)).toEqual(["RE-2"]);

    vi.setSystemTime(new Date("2026-10-07T12:01:00Z"));
    await w.rescan();
    expect(events().map((e) => e.pvsInvoiceId).sort()).toEqual(["RE-1", "RE-2"]);
    expect(w.status().ledger).toMatchObject({ failed: 0, done: 2 });
    w.stop();
  });

  it("an enqueue error marks the file failed (not done) and it is retried", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    const p = join(honorarDir, "e.csv");
    writeFileSync(p, iconv.encode([HEADER, "PAT-1;RE-1;X;a;100,00;05.10.2026", ""].join("\r\n"), "win1252"));
    const old = new Date("2026-10-07T11:00:00Z");
    utimesSync(p, old, old);
    let first = true;
    const w = start({
      enqueueMany: (items) => {
        if (first) {
          first = false;
          throw new Error("SQLITE_FULL: disk is full");
        }
        return outbox.enqueueMany(items);
      },
    });
    await w.rescan();
    expect(w.status().ledger).toMatchObject({ failed: 1, done: 0 });
    vi.setSystemTime(new Date("2026-10-07T12:01:00Z"));
    await w.rescan();
    expect(w.status().ledger).toMatchObject({ failed: 0, done: 1 });
    expect(events()).toHaveLength(1);
    w.stop();
  });

  it("a file ignored for 'no mapping' is re-read once the mapping is configured", async () => {
    writeCsv(
      "exotisch.csv",
      ["Pat;Beleg;Wert;Datum", "PAT-1;RE-1;100,00;05.10.2026"].join("\n")
    );
    const w1 = start();
    await w1.rescan();
    expect(events()).toHaveLength(0);
    expect(w1.status().ledger).toMatchObject({ ignored: 1 });
    expect(w1.status().lastIgnoreReason).toMatch(/^no_header_found/);
    // Unchanged file + unchanged config: not re-read.
    await w1.rescan();
    expect(w1.status().ledger).toMatchObject({ ignored: 1 });
    w1.stop();

    const mapping: CsvMapping = {
      stream: "invoices",
      columns: { pvsPatientId: "Pat", pvsInvoiceId: "Beleg", amount: "Wert", paidAt: "Datum" },
      dateFormat: "DD.MM.YYYY",
      amountUnit: "eur",
      decimalSeparator: ",",
    };
    const w2 = start({ mapping });
    await w2.rescan();
    expect(events().map((e) => e.pvsInvoiceId)).toEqual(["RE-1"]);
    expect(w2.status().ledger).toMatchObject({ done: 1, ignored: 0 });
    w2.stop();
  });

  it("ambiguous amount columns are refused with a reason naming the columns", async () => {
    writeCsv(
      "amb.csv",
      ["Patient-Nr.;Rechnungs-Nr.;Rechnungsbetrag;Gesamtbetrag;Bezahldatum", "PAT-1;RE-1;100,00;119,00;05.10.2026"].join("\n")
    );
    const w = start();
    await w.rescan();
    expect(events()).toHaveLength(0);
    expect(w.status().lastIgnoreReason).toBe("ambiguous_amount_columns: Rechnungsbetrag, Gesamtbetrag");
    w.stop();
  });

  it("a file copied in with an old mtime is picked up", async () => {
    writeCsv("new.csv", [HEADER, "PAT-1;RE-1;X;a;10,00;05.10.2026"].join("\n"));
    const w = start();
    await w.rescan();
    const p = writeCsv("restored.csv", [HEADER, "PAT-2;RE-2;X;a;20,00;05.10.2026"].join("\n"));
    const ancient = new Date("2001-01-01T00:00:00Z");
    utimesSync(p, ancient, ancient);
    await w.rescan();
    expect(events().map((e) => e.pvsInvoiceId).sort()).toEqual(["RE-1", "RE-2"]);
    w.stop();
  });

  it("a file that changes while being processed is not recorded as done", async () => {
    const p = writeCsv("grow.csv", [HEADER, "PAT-1;RE-1;X;a;10,00;05.10.2026"].join("\n"));
    let grown = false;
    const reader = async (path: string): Promise<Buffer> => {
      const b = await readFile(path);
      if (!grown) {
        grown = true;
        appendFileSync(path, "PAT-2;RE-2;X;a;20,00;05.10.2026\r\n");
      }
      return b;
    };
    const w = start({ readFile: reader });
    await w.rescan();
    expect(events()).toHaveLength(0);
    expect(w.status().ledger).toMatchObject({ done: 0, failed: 0, ignored: 0 });
    // Make it look stable again; next pass processes the full file.
    const old = new Date(Date.now() - 60_000);
    utimesSync(p, old, old);
    await w.rescan();
    expect(events().map((e) => e.pvsInvoiceId).sort()).toEqual(["RE-1", "RE-2"]);
    w.stop();
  });

  it("prunes ledger rows of vanished files and keeps going", async () => {
    const p = writeCsv("gone.csv", [HEADER, "PAT-1;RE-1;X;a;10,00;05.10.2026"].join("\n"));
    const w = start();
    await w.rescan();
    expect(w.status().ledger?.done).toBe(1);
    rmSync(p);
    await w.rescan();
    expect(w.status().ledger?.done).toBe(0);
    w.stop();
  });

  it("getCsvWatcherStatus reflects the running watcher and clears on stop", async () => {
    const w = start();
    await w.rescan();
    expect(watcherMod.getCsvWatcherStatus()?.folder).toBe(honorarDir);
    w.stop();
    expect(watcherMod.getCsvWatcherStatus()).toBeNull();
  });

  it("chunks big files into 1000-event transactions", async () => {
    const lines = [HEADER];
    for (let i = 0; i < 2500; i++) lines.push(`PAT-${i};RE-${i};X;a;10,00;05.10.2026`);
    writeCsv("big.csv", lines.join("\n"));
    const w = start();
    await w.rescan();
    expect(w.status().lastFile).toMatchObject({ rows: 2500, invoices: 2500, inserted: 2500, duplicates: 0 });
    w.stop();
  });
});
