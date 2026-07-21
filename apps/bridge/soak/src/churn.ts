import { pathToFileURL } from "node:url";
import { CHURN_JOURNAL, VENDOR_DB_URL } from "./lib/env.js";
import { withClient } from "./lib/pg.js";
import {
  appendJsonl,
  centsToSql,
  log,
  pick,
  pickWeighted,
  randInt,
  sleep,
  warn,
  chance,
} from "./lib/util.js";

/**
 * Praxis-Betrieb-Simulator ("MFA am Empfang") against the tomedo-shaped
 * vendor DB. Random ops at random intervals: neue Patienten, Termine,
 * Status-Wechsel, Behandlungen, Rechnungen (bezahlt/offen), Gutschriften,
 * Storno-Flips, Edits an alten Zeilen, Recalls.
 *
 * Invariants that keep the end-of-run reconciliation well-defined
 * (deliberate — each guarded case is a REAL semantic gap of state-polling
 * PVS bridges; `edge: true` lifts the guards to hunt those bugs, at the
 * cost of the binary PASS assertion):
 *
 *   1. A paid invoice is only storno-flipped after REFUND_DWELL_MS, so the
 *      60s poll is guaranteed to have seen it in status='bezahlt' first.
 *   2. Storno/Gutschrift rows are FROZEN after creation. The refund event id
 *      is `tomedo:refund:{id}:{modified_at}` — touching the row again would
 *      emit a second refund for the same money.
 *   3. betrag and bezahlt_am of a paid row are never edited (the InvoicePaid
 *      event id/occurredAt pin the original values; the portal cannot see a
 *      later correction). Non-financial touches (modified_at bump) are fine
 *      and exercised.
 */

export interface ChurnOpts {
  vendorDbUrl?: string;
  /** Average operations per minute. */
  opsPerMinute?: number;
  /** Min age of a paid invoice before it may be storno-flipped. */
  refundDwellMs?: number;
  /** Lift reconciliation-safety guards (bug-hunt mode). */
  edge?: boolean;
}

export interface ChurnHandle {
  stop: () => Promise<void>;
  stats: () => ChurnStats;
}

export interface ChurnStats {
  ops: number;
  patients: number;
  termine: number;
  invoicesPaid: number;
  paidCents: number;
  refunds: number;
  refundCents: number;
  errors: number;
}

const VORNAMEN = [
  "Jürgen", "Käthe", "Björn", "Sören", "Änne", "Lieselotte", "Maximilian",
  "Sophie", "Hans-Peter", "Renée", "Gülcan", "François", "Zoë", "Marie-Luise",
];
const NACHNAMEN = [
  "Müller", "Schäfer", "Größmann", "Weiß", "Öztürk", "van der Berg",
  "Le Blanc", "Krüger-Löwenstein", "Bäcker", "Straßburger", "D'Angelo",
];
const BEHANDLUNGEN: ReadonlyArray<readonly [string, string]> = [
  ["BTX01", "Botox Stirn"],
  ["HYA02", "Hyaluron Lippen"],
  ["LAS03", "Laser-Haarentfernung"],
  ["KRY04", "Kryolipolyse Bauch"],
  ["FAC05", "Facelift Beratung"],
  ["PRP06", "PRP Eigenbluttherapie"],
];
const TERMIN_STATUS = ["geplant", "erschienen", "abgeschlossen", "abgesagt", "nicht erschienen"];
const BEHANDLER = ["Dr. Sommer", "Dr. Öz", "Fr. Dr. Weiß"];

export function startChurn(opts: ChurnOpts = {}): ChurnHandle {
  const url = opts.vendorDbUrl ?? VENDOR_DB_URL;
  const opsPerMinute = opts.opsPerMinute ?? 12;
  const refundDwellMs = opts.refundDwellMs ?? 5 * 60_000;
  const edge = opts.edge ?? false;

  let running = true;
  const stats: ChurnStats = {
    ops: 0, patients: 0, termine: 0, invoicesPaid: 0, paidCents: 0,
    refunds: 0, refundCents: 0, errors: 0,
  };

  // In-memory working set, recovered from the DB at start so churn survives
  // orchestrator restarts without losing referential realism.
  const patientIds: number[] = [];
  const terminIds: Array<{ id: number; patientId: number }> = [];
  const offeneRechnungen: Array<{ id: number; patientId: number; terminId: number }> = [];
  // Paid rows eligible for a later storno flip: id + creation time + cents.
  const stornoCandidates: Array<{ id: number; paidAtMs: number; cents: number; patientId: number; terminId: number }> = [];

  const journal = (entry: Record<string, unknown>) => appendJsonl(CHURN_JOURNAL, entry);

  async function recover(): Promise<void> {
    await withClient(url, async (c) => {
      const p = await c.query(`SELECT id FROM patient ORDER BY id`);
      for (const r of p.rows) patientIds.push(Number(r.id));
      const t = await c.query(`SELECT id, patient_id FROM termin ORDER BY id`);
      for (const r of t.rows) terminIds.push({ id: Number(r.id), patientId: Number(r.patient_id) });
      const o = await c.query(
        `SELECT id, patient_id, termin_id FROM rechnung WHERE status = 'offen'`
      );
      for (const r of o.rows)
        offeneRechnungen.push({ id: Number(r.id), patientId: Number(r.patient_id), terminId: Number(r.termin_id) });
      // Only recover storno candidates that are old enough to be safe.
      const s = await c.query(
        `SELECT id, patient_id, termin_id, round(betrag * 100)::bigint AS cents,
                extract(epoch FROM modified_at) * 1000 AS mts
         FROM rechnung WHERE status = 'bezahlt' AND betrag > 0`
      );
      for (const r of s.rows)
        stornoCandidates.push({
          id: Number(r.id),
          patientId: Number(r.patient_id),
          terminId: Number(r.termin_id),
          cents: Number(r.cents),
          paidAtMs: Number(r.mts),
        });
    });
    log("churn", `recovered state: ${patientIds.length} Patienten, ${terminIds.length} Termine, ${stornoCandidates.length} bezahlte Rechnungen`);
  }

  // ---- ops ---------------------------------------------------------------

  async function opNewPatient(): Promise<void> {
    const vorname = pick(VORNAMEN);
    const nachname = pick(NACHNAMEN);
    await withClient(url, async (c) => {
      const res = await c.query(
        `INSERT INTO patient (vorname, nachname, email, telefon_mobil, geburtsdatum, geschlecht, bemerkung)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          vorname,
          nachname,
          chance(0.7) ? `${vorname}.${nachname}@example.de`.toLowerCase().replace(/[^a-z0-9.@]/g, "") : null,
          chance(0.8) ? `+49 15${randInt(0, 9)} ${randInt(1000000, 9999999)}` : null,
          `${randInt(1950, 2004)}-${String(randInt(1, 12)).padStart(2, "0")}-${String(randInt(1, 28)).padStart(2, "0")}`,
          pick(["w", "m", "w", "w"]),
          chance(0.2) ? "Empfehlung Instagram" : null,
        ]
      );
      const id = Number(res.rows[0].id);
      patientIds.push(id);
      stats.patients++;
      journal({ op: "newPatient", id, name: `${vorname} ${nachname}` });
    });
  }

  async function opNewTermin(): Promise<void> {
    if (patientIds.length === 0) return opNewPatient();
    const patientId = pick(patientIds);
    const [code, name] = pick(BEHANDLUNGEN);
    await withClient(url, async (c) => {
      const res = await c.query(
        `INSERT INTO termin (patient_id, termin_zeit, behandlung_code, behandlung_name, raum_id, raum_name, status, kommentar)
         VALUES ($1, now() + ($2 || ' hours')::interval, $3, $4, $5, $6, 'geplant', $7) RETURNING id`,
        [
          patientId,
          String(randInt(1, 24 * 14)),
          code,
          name,
          randInt(1, 4),
          `Raum ${randInt(1, 4)}`,
          chance(0.3) ? "Beratung gewünscht" : null,
        ]
      );
      const id = Number(res.rows[0].id);
      terminIds.push({ id, patientId });
      stats.termine++;
      journal({ op: "newTermin", id, patientId, code });
    });
  }

  async function opStatusChange(): Promise<void> {
    if (terminIds.length === 0) return opNewTermin();
    const t = pick(terminIds);
    const status = pick(TERMIN_STATUS);
    await withClient(url, async (c) => {
      await c.query(
        `UPDATE termin SET status = $1, modified_at = now() WHERE id = $2`,
        [status, t.id]
      );
    });
    journal({ op: "statusChange", terminId: t.id, status });
  }

  async function opEncounter(): Promise<number | null> {
    if (terminIds.length === 0) {
      await opNewTermin();
      return null;
    }
    const t = pick(terminIds);
    const [code, name] = pick(BEHANDLUNGEN);
    return withClient(url, async (c) => {
      const res = await c.query(
        `INSERT INTO behandlung (patient_id, termin_id, behandlung_zeit, behandlung_code, behandlung_name, behandler_name)
         VALUES ($1, $2, now(), $3, $4, $5) RETURNING id`,
        [t.patientId, t.id, code, name, pick(BEHANDLER)]
      );
      const id = Number(res.rows[0].id);
      journal({ op: "encounter", id, terminId: t.id });
      return id;
    });
  }

  async function opInvoicePaid(): Promise<void> {
    if (terminIds.length === 0) return opNewTermin();
    const t = pick(terminIds);
    const cents = randInt(80_00, 4_500_00);
    const behandlungId = chance(0.6) ? await opEncounter() : null;
    await withClient(url, async (c) => {
      const res = await c.query(
        `INSERT INTO rechnung (patient_id, termin_id, behandlung_id, betrag, bezahlt_am, status)
         VALUES ($1, $2, $3, $4, now(), 'bezahlt') RETURNING id, extract(epoch FROM modified_at) * 1000 AS mts`,
        [t.patientId, t.id, behandlungId, centsToSql(cents)]
      );
      const id = Number(res.rows[0].id);
      stornoCandidates.push({
        id,
        patientId: t.patientId,
        terminId: t.id,
        cents,
        paidAtMs: Number(res.rows[0].mts),
      });
      stats.invoicesPaid++;
      stats.paidCents += cents;
      journal({ op: "invoicePaid", id, terminId: t.id, cents });
    });
  }

  async function opInvoiceOffen(): Promise<void> {
    if (terminIds.length === 0) return opNewTermin();
    const t = pick(terminIds);
    const cents = randInt(80_00, 4_500_00);
    await withClient(url, async (c) => {
      const res = await c.query(
        `INSERT INTO rechnung (patient_id, termin_id, betrag, status)
         VALUES ($1, $2, $3, 'offen') RETURNING id`,
        [t.patientId, t.id, centsToSql(cents)]
      );
      const id = Number(res.rows[0].id);
      offeneRechnungen.push({ id, patientId: t.patientId, terminId: t.id });
      journal({ op: "invoiceOffen", id, cents });
    });
  }

  async function opPayOffene(): Promise<void> {
    const idx = offeneRechnungen.length ? randInt(0, offeneRechnungen.length - 1) : -1;
    if (idx < 0) return opInvoicePaid();
    const r = offeneRechnungen.splice(idx, 1)[0];
    await withClient(url, async (c) => {
      const res = await c.query(
        `UPDATE rechnung SET status = 'bezahlt', bezahlt_am = now(), modified_at = now()
         WHERE id = $1 AND status = 'offen'
         RETURNING round(betrag * 100)::bigint AS cents, extract(epoch FROM modified_at) * 1000 AS mts`,
        [r.id]
      );
      if (res.rowCount === 0) return;
      const cents = Number(res.rows[0].cents);
      stornoCandidates.push({
        id: r.id,
        patientId: r.patientId,
        terminId: r.terminId,
        cents,
        paidAtMs: Number(res.rows[0].mts),
      });
      stats.invoicesPaid++;
      stats.paidCents += cents;
      journal({ op: "payOffene", id: r.id, cents });
    });
  }

  async function opGutschrift(): Promise<void> {
    if (patientIds.length === 0) return;
    const t = terminIds.length && chance(0.7) ? pick(terminIds) : null;
    const patientId = t ? t.patientId : pick(patientIds);
    const cents = randInt(50_00, 900_00);
    await withClient(url, async (c) => {
      const res = await c.query(
        `INSERT INTO rechnung (patient_id, termin_id, betrag, status)
         VALUES ($1, $2, $3, 'gutschrift') RETURNING id`,
        [patientId, t?.id ?? null, centsToSql(-cents)]
      );
      stats.refunds++;
      stats.refundCents += cents;
      journal({ op: "gutschrift", id: Number(res.rows[0].id), cents: -cents });
    });
  }

  async function opStornoFlip(): Promise<void> {
    const now = Date.now();
    const eligible = stornoCandidates.filter((s) => edge || now - s.paidAtMs > refundDwellMs);
    if (eligible.length === 0) return;
    const victim = pick(eligible);
    const i = stornoCandidates.findIndex((s) => s.id === victim.id);
    if (i >= 0) stornoCandidates.splice(i, 1); // frozen from here on
    await withClient(url, async (c) => {
      await c.query(
        `UPDATE rechnung SET status = 'storniert', modified_at = now() WHERE id = $1`,
        [victim.id]
      );
    });
    stats.refunds++;
    stats.refundCents += victim.cents;
    journal({ op: "stornoFlip", id: victim.id, cents: -victim.cents });
  }

  async function opEditOld(): Promise<void> {
    const which = pickWeighted<"patient" | "termin" | "rechnungTouch">([
      [4, "patient"],
      [4, "termin"],
      [2, "rechnungTouch"],
    ]);
    await withClient(url, async (c) => {
      if (which === "patient" && patientIds.length) {
        const id = pick(patientIds);
        await c.query(
          `UPDATE patient SET telefon_mobil = $1, bemerkung = $2, modified_at = now() WHERE id = $3`,
          [`+49 17${randInt(0, 9)} ${randInt(1000000, 9999999)}`, "Nummer aktualisiert", id]
        );
        journal({ op: "editPatient", id });
      } else if (which === "termin" && terminIds.length) {
        const t = pick(terminIds);
        await c.query(
          `UPDATE termin SET kommentar = $1, modified_at = now() WHERE id = $2`,
          [`Notiz ${randInt(1, 999)}`, t.id]
        );
        journal({ op: "editTermin", id: t.id });
      } else if (which === "rechnungTouch" && stornoCandidates.length) {
        // Non-financial touch of a PAID row: must re-emit an identical event
        // that the portal dedups. betrag/bezahlt_am stay untouched (see
        // invariant 3) unless edge mode is on.
        const r = pick(stornoCandidates);
        if (edge && chance(0.3)) {
          await c.query(
            `UPDATE rechnung SET bezahlt_am = bezahlt_am + interval '1 day', modified_at = now() WHERE id = $1`,
            [r.id]
          );
          journal({ op: "EDGE_editPaidDate", id: r.id });
        } else {
          await c.query(`UPDATE rechnung SET modified_at = now() WHERE id = $1`, [r.id]);
          journal({ op: "touchRechnung", id: r.id });
        }
      }
    });
  }

  async function opRecall(): Promise<void> {
    if (patientIds.length === 0) return;
    const [code, name] = pick(BEHANDLUNGEN);
    await withClient(url, async (c) => {
      await c.query(
        `INSERT INTO recall (patient_id, recall_zeit, behandlung_code, behandlung_name)
         VALUES ($1, now() + interval '6 months', $2, $3)`,
        [pick(patientIds), code, name]
      );
    });
    journal({ op: "recall" });
  }

  // ---- loop ---------------------------------------------------------------

  const loop = (async () => {
    await recover();
    while (running) {
      const meanGapMs = 60_000 / opsPerMinute;
      // Exponential-ish inter-arrival: bursty like a real Empfang.
      const gap = Math.max(250, Math.round(-Math.log(1 - Math.random()) * meanGapMs));
      await sleep(gap);
      if (!running) break;
      const op = pickWeighted<() => Promise<unknown>>([
        [18, opNewPatient],
        [18, opNewTermin],
        [10, opStatusChange],
        [8, opEncounter],
        [16, opInvoicePaid],
        [5, opInvoiceOffen],
        [6, opPayOffene],
        [4, opGutschrift],
        [3, opStornoFlip],
        [9, opEditOld],
        [3, opRecall],
      ]);
      try {
        await op();
        stats.ops++;
      } catch (err) {
        // Chaos (DB password rotation, PG restart) makes churn errors
        // expected; count + journal them, never die.
        stats.errors++;
        journal({ op: "ERROR", message: (err as Error).message });
        await sleep(2000);
      }
    }
  })();

  return {
    stop: async () => {
      running = false;
      await loop;
      log("churn", `stopped after ${stats.ops} ops (${stats.errors} errors)`);
    },
    stats: () => ({ ...stats }),
  };
}

// Standalone: `tsx src/churn.ts [opsPerMinute]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handle = startChurn({ opsPerMinute: Number(process.argv[2] ?? 12) });
  process.on("SIGINT", async () => {
    await handle.stop();
    process.exit(0);
  });
  log("churn", "running standalone — Ctrl+C to stop");
}
