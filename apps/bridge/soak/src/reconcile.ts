import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLINIC_A,
  CLINIC_B,
  DROPPER_LEDGER,
  PORTAL_DB_URL,
  REPORT_PATH,
  VENDOR_DB_URL,
} from "./lib/env.js";
import { query } from "./lib/pg.js";
import { fmtEur, log, readJsonl, sqlNumericToCents, ts, warn } from "./lib/util.js";

/**
 * End-of-soak reconciliation. THE assertion:
 *
 *   Source-of-truth invoice sums (vendor DB for Praxis A, dropper ledger for
 *   Praxis B) equal the portal's ingested revenue events — to the cent, with
 *   zero duplicates, zero missing, zero unexpected.
 *
 * This is the property the Garantie's revenue attribution depends on and the
 * one thing no unit test can prove.
 *
 * GDT carries NO revenue (patient master data only), so Praxis B revenue is
 * the Honorar-CSV path alone. A separate "GDT inbox" check per clinic verifies
 * that addressed files were consumed, nothing is stuck in .eins/processing,
 * foreign-device files stayed untouched, every dropped patient reached the
 * portal, and no GDT-derived invoice event exists.
 *
 * Levels:
 *   1 (hard)  — pvs_event_log vs source truth. Worker-independent.
 *   2 (info)  — patients.lifetime_revenue_eur vs expected net. Requires the
 *               pg-boss worker (pnpm dev:worker) to have processed derives;
 *               reported, not asserted.
 */

interface Problem {
  clinic: "A" | "B";
  type:
    | "missing_paid"
    | "missing_refund"
    | "duplicate_paid"
    | "duplicate_refund"
    | "amount_mismatch"
    | "unexpected_paid"
    | "unexpected_refund";
  invoiceId: string;
  detail: string;
  /** True when the source row/ledger entry is younger than the grace window
   *  (event may legitimately still be in flight). */
  inFlight?: boolean;
}

/** A finding of the GDT inbox check. Always hard (grace already applied). */
interface GdtProblem {
  clinic: "A" | "B";
  type:
    | "gdt_not_consumed"
    | "gdt_stuck_in_processing"
    | "gdt_patient_missing"
    | "gdt_revenue_event"
    | "foreignFileTouched"
    | "gdtCounterExhausted"
    | "gdt_ledger_problem";
  detail: string;
}

interface GdtInboxResult {
  clinic: "A" | "B";
  problems: GdtProblem[];
  patientsExpected: number;
  patientsInPortal: number;
  rootEinsFiles: number;
  processingFiles: number;
  failedFiles: number;
  utf16Drops: number;
  channelBusy: number;
  untouchedDrops: number;
}

interface Expected {
  paid: Map<string, number>; // invoiceId → cents
  refund: Map<string, number>; // invoiceId → cents (positive magnitude)
  /** invoiceId → source-side last-modified ms (for the grace window). */
  freshness: Map<string, number>;
}

interface PortalActual {
  paid: Map<string, number[]>;
  refund: Map<string, number[]>;
  totalRows: number;
}

// ---------------------------------------------------------------------------

async function expectedFromVendorDb(): Promise<Expected> {
  const res = await query(
    VENDOR_DB_URL,
    `SELECT id::text AS id, betrag::text AS betrag, status, termin_id,
            extract(epoch FROM modified_at) * 1000 AS mts
     FROM rechnung ORDER BY id`
  );
  const exp: Expected = { paid: new Map(), refund: new Map(), freshness: new Map() };
  for (const r of res.rows) {
    const cents = sqlNumericToCents(r.betrag);
    const id = String(r.id);
    exp.freshness.set(id, Number(r.mts));
    if (cents < 0) {
      // Gutschrift row: refund only.
      exp.refund.set(id, Math.abs(cents));
      continue;
    }
    if (r.status === "bezahlt") {
      if (r.termin_id === null) {
        warn("reconcile", `rechnung ${id} bezahlt but termin_id NULL — stream skips it by contract; excluded from truth`);
        continue;
      }
      exp.paid.set(id, cents);
    } else if (r.status === "storniert") {
      // Paid-then-flipped: one InvoicePaid AND one InvoiceRefunded expected.
      exp.paid.set(id, cents);
      exp.refund.set(id, cents);
    } else if (r.status === "offen") {
      // No events expected.
    } else {
      warn("reconcile", `rechnung ${id}: unexpected status '${r.status}' with positive betrag — excluded`);
    }
  }
  return exp;
}

interface LedgerEntry {
  t: string;
  kind?: "paid" | "refund" | "none";
  invoiceId?: string;
  cents?: number;
  case?: string;
  clinic?: "A" | "B";
  source?: string;
  expect?: "consumed" | "untouched" | "quarantined";
  patientIds?: string[];
  problem?: boolean;
  file?: string;
  detail?: string;
}

function expectedFromLedger(): Expected {
  const entries = readJsonl<LedgerEntry>(DROPPER_LEDGER);
  const exp: Expected = { paid: new Map(), refund: new Map(), freshness: new Map() };
  for (const e of entries) {
    if (!e.invoiceId || e.cents === undefined) continue;
    const when = Date.parse(e.t) || 0;
    if (e.kind === "paid") {
      if (exp.paid.has(e.invoiceId)) {
        warn("reconcile", `ledger has two paid entries for ${e.invoiceId} — harness bug, keeping first`);
        continue;
      }
      exp.paid.set(e.invoiceId, e.cents);
      exp.freshness.set(e.invoiceId, when);
    } else if (e.kind === "refund") {
      if (exp.refund.has(e.invoiceId)) {
        warn("reconcile", `ledger has two refund entries for ${e.invoiceId} — harness bug, keeping first`);
        continue;
      }
      exp.refund.set(e.invoiceId, Math.abs(e.cents));
      exp.freshness.set(`r:${e.invoiceId}`, when);
    }
  }
  return exp;
}

async function portalActual(clinicId: string, bridgeSources: string[]): Promise<PortalActual> {
  const res = await query(
    PORTAL_DB_URL,
    `SELECT kind, payload
     FROM pvs_event_log
     WHERE clinic_id = $1 AND bridge_source = ANY($2)
       AND kind IN ('InvoicePaid', 'InvoiceRefunded')`,
    [clinicId, bridgeSources]
  );
  const actual: PortalActual = { paid: new Map(), refund: new Map(), totalRows: res.rowCount ?? 0 };
  for (const r of res.rows) {
    const p = r.payload as { pvsInvoiceId?: string; amountCents?: number; refundedAmountCents?: number };
    const id = String(p.pvsInvoiceId ?? "?");
    if (r.kind === "InvoicePaid") {
      const list = actual.paid.get(id) ?? [];
      list.push(Number(p.amountCents ?? NaN));
      actual.paid.set(id, list);
    } else {
      const list = actual.refund.get(id) ?? [];
      list.push(Number(p.refundedAmountCents ?? NaN));
      actual.refund.set(id, list);
    }
  }
  return actual;
}

function compare(
  clinic: "A" | "B",
  exp: Expected,
  act: PortalActual,
  graceMs: number
): Problem[] {
  const problems: Problem[] = [];
  const now = Date.now();
  const isFresh = (key: string) => now - (exp.freshness.get(key) ?? 0) < graceMs;

  for (const [id, cents] of exp.paid) {
    const got = act.paid.get(id);
    if (!got || got.length === 0) {
      problems.push({
        clinic, type: "missing_paid", invoiceId: id,
        detail: `expected InvoicePaid ${fmtEur(cents)}, portal has none`,
        inFlight: isFresh(id),
      });
    } else {
      if (got.length > 1) {
        problems.push({
          clinic, type: "duplicate_paid", invoiceId: id,
          detail: `${got.length} InvoicePaid events for one invoice (${got.map(fmtEur).join(", ")})`,
        });
      }
      if (got[0] !== cents) {
        problems.push({
          clinic, type: "amount_mismatch", invoiceId: id,
          detail: `expected ${fmtEur(cents)}, portal has ${fmtEur(got[0])}`,
        });
      }
    }
  }
  for (const [id, cents] of exp.refund) {
    const got = act.refund.get(id);
    if (!got || got.length === 0) {
      problems.push({
        clinic, type: "missing_refund", invoiceId: id,
        detail: `expected InvoiceRefunded ${fmtEur(cents)}, portal has none`,
        inFlight: isFresh(id) || isFresh(`r:${id}`),
      });
    } else {
      if (got.length > 1) {
        problems.push({
          clinic, type: "duplicate_refund", invoiceId: id,
          detail: `${got.length} InvoiceRefunded events for one invoice`,
        });
      }
      if (got[0] !== cents) {
        problems.push({
          clinic, type: "amount_mismatch", invoiceId: id,
          detail: `refund expected ${fmtEur(cents)}, portal has ${fmtEur(got[0])}`,
        });
      }
    }
  }
  for (const id of act.paid.keys()) {
    if (!exp.paid.has(id)) {
      problems.push({
        clinic, type: "unexpected_paid", invoiceId: id,
        detail: "portal has an InvoicePaid the source never produced",
      });
    }
  }
  for (const id of act.refund.keys()) {
    if (!exp.refund.has(id)) {
      problems.push({
        clinic, type: "unexpected_refund", invoiceId: id,
        detail: "portal has an InvoiceRefunded the source never produced",
      });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// GDT inbox (patients only; GDT never carries revenue)
// ---------------------------------------------------------------------------

// .bdt is read but never deleted by the agent, so it is not part of "consumed".
const WATCHED_GDT = /\.(gdt|\d{3})$/i;

function listFiles(dir: string): Array<{ name: string; mtimeMs: number }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ name: string; mtimeMs: number }> = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isFile()) continue;
    try {
      out.push({ name: d.name, mtimeMs: statSync(join(dir, d.name)).mtimeMs });
    } catch {
      // vanished between readdir and stat: consumed meanwhile
    }
  }
  return out;
}

async function gdtInbox(
  clinic: "A" | "B",
  graceMs: number,
  entries: LedgerEntry[]
): Promise<GdtInboxResult> {
  const cfg = clinic === "A" ? CLINIC_A : CLINIC_B;
  const now = Date.now();
  const older = (ms: number) => now - ms > graceMs;
  const mine = entries.filter((e) => e.clinic === clinic && e.source !== "csv");
  const problems: GdtProblem[] = [];

  // 1. Problem flags written by the dropper (foreign file touched, counter full).
  for (const e of mine) {
    if (!e.problem) continue;
    const known = e.case === "foreignFileTouched" || e.case === "gdtCounterExhausted";
    problems.push({
      clinic,
      type: known ? (e.case as GdtProblem["type"]) : "gdt_ledger_problem",
      detail: `${e.case ?? "?"} at ${e.t}${e.file ? ` file ${e.file}` : ""}${e.detail ? ` (${e.detail})` : ""}`,
    });
  }

  // 2. Addressed files still in the folder root past the grace window. Counter
  //    names get reused after the wrap, so judge the folder, not single entries.
  const root = listFiles(cfg.gdtFolder).filter(
    (f) => /^EINS/i.test(f.name) && WATCHED_GDT.test(f.name)
  );
  for (const f of root) {
    if (older(f.mtimeMs)) {
      problems.push({
        clinic,
        type: "gdt_not_consumed",
        detail: `${f.name} addressed to EINS is still in the folder, ${Math.round((now - f.mtimeMs) / 1000)}s old`,
      });
    }
  }

  // 3. Nothing may rot in .eins/processing.
  const processing = listFiles(join(cfg.gdtFolder, ".eins", "processing"));
  for (const f of processing) {
    if (older(f.mtimeMs)) {
      problems.push({
        clinic,
        type: "gdt_stuck_in_processing",
        detail: `.eins/processing/${f.name} is ${Math.round((now - f.mtimeMs) / 1000)}s old`,
      });
    }
  }

  // 4. Every dropped patient (consumed GDT + BDT exports) must be in the portal.
  const wantIds = new Set<string>();
  for (const e of mine) {
    const when = Date.parse(e.t);
    if (!e.patientIds || !(when > 0) || !older(when)) continue;
    if (e.expect === "consumed" || (e.expect === "untouched" && e.case === "bdtExport")) {
      for (const id of e.patientIds) wantIds.add(id);
    }
  }
  const res = await query(
    PORTAL_DB_URL,
    `SELECT DISTINCT payload->>'pvsPatientId' AS pid
     FROM pvs_event_log
     WHERE clinic_id = $1 AND bridge_source = 'gdt_agent' AND kind = 'PatientUpserted'`,
    [cfg.id]
  );
  const have = new Set<string>(res.rows.map((r) => String(r.pid)));
  for (const id of wantIds) {
    if (!have.has(id)) {
      problems.push({
        clinic,
        type: "gdt_patient_missing",
        detail: `patient ${id} was dropped in a GDT/BDT file but has no PatientUpserted in the portal`,
      });
    }
  }

  // 5. GDT must never produce revenue (the old fictional "SGDT" invoices).
  if (clinic === "B") {
    const rev = await query(
      PORTAL_DB_URL,
      `SELECT payload->>'pvsInvoiceId' AS id
       FROM pvs_event_log
       WHERE clinic_id = $1 AND kind IN ('InvoicePaid', 'InvoiceRefunded')
         AND payload->>'pvsInvoiceId' LIKE 'SGDT%'`,
      [CLINIC_B.id]
    );
    if ((rev.rowCount ?? 0) > 0) {
      problems.push({
        clinic,
        type: "gdt_revenue_event",
        detail:
          `${rev.rowCount} InvoicePaid/InvoiceRefunded event(s) with an SGDT* invoice id ` +
          `(e.g. ${rev.rows[0].id}); GDT carries no revenue. Stale data from an old run? reset first`,
      });
    }
  }

  return {
    clinic,
    problems,
    patientsExpected: wantIds.size,
    patientsInPortal: [...wantIds].filter((id) => have.has(id)).length,
    rootEinsFiles: root.length,
    processingFiles: processing.length,
    failedFiles: listFiles(join(cfg.gdtFolder, ".eins", "failed")).length,
    utf16Drops: mine.filter((e) => e.case === "gdtUtf16Garbage").length,
    channelBusy: mine.filter((e) => e.case === "gdtChannelBusy").length,
    untouchedDrops: mine.filter((e) => e.expect === "untouched").length,
  };
}

function net(exp: Expected): number {
  let n = 0;
  for (const c of exp.paid.values()) n += c;
  for (const c of exp.refund.values()) n -= c;
  return n;
}

function netActual(act: PortalActual): number {
  let n = 0;
  for (const list of act.paid.values()) for (const c of list) n += c;
  for (const list of act.refund.values()) for (const c of list) n -= c;
  return n;
}

async function derivedRevenue(clinicId: string): Promise<number | null> {
  try {
    const res = await query(
      PORTAL_DB_URL,
      `SELECT COALESCE(SUM(lifetime_revenue_eur), 0)::text AS s FROM patients WHERE clinic_id = $1`,
      [clinicId]
    );
    return sqlNumericToCents(res.rows[0].s);
  } catch {
    return null;
  }
}

export interface ReconcileResult {
  ok: boolean;
  hardFailures: number;
  inFlightOnly: number;
  report: string;
}

export async function reconcile(graceSeconds = 240): Promise<ReconcileResult> {
  const graceMs = graceSeconds * 1000;
  log("reconcile", "computing source truth + portal state ...");

  const expA = await expectedFromVendorDb();
  const actA = await portalActual(CLINIC_A.id, ["tomedo"]);
  const problemsA = compare("A", expA, actA, graceMs);

  const expB = expectedFromLedger();
  const actB = await portalActual(CLINIC_B.id, ["gdt_agent"]);
  const problemsB = compare("B", expB, actB, graceMs);

  const ledgerEntries = readJsonl<LedgerEntry>(DROPPER_LEDGER);
  const gdtA = await gdtInbox("A", graceMs, ledgerEntries);
  const gdtB = await gdtInbox("B", graceMs, ledgerEntries);
  const gdtProblems = [...gdtA.problems, ...gdtB.problems];

  const all = [...problemsA, ...problemsB];
  const hard = all.filter((p) => !p.inFlight);
  const soft = all.filter((p) => p.inFlight);
  const hardTotal = hard.length + gdtProblems.length;

  const derivedA = await derivedRevenue(CLINIC_A.id);
  const derivedB = await derivedRevenue(CLINIC_B.id);

  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`# PVS-Bridge Soak — Reconciliation`);
  push(``);
  push(`Generated: ${ts()}`);
  push(``);
  const verdict = hardTotal === 0 ? "**PASS**" : `**FAIL** (${hardTotal} hard finding${hardTotal === 1 ? "" : "s"})`;
  push(`## Verdict: ${verdict}`);
  if (soft.length > 0) {
    push(``);
    push(`${soft.length} finding(s) within the ${graceSeconds}s grace window (possibly still in flight) — re-run \`pnpm --filter eins-bridge-soak reconcile\` in a few minutes to confirm.`);
  }
  push(``);

  const section = (
    name: string,
    exp: Expected,
    act: PortalActual,
    problems: Problem[],
    derived: number | null
  ) => {
    const expNet = net(exp);
    const actNet = netActual(act);
    push(`## ${name}`);
    push(``);
    push(`| | Quelle (Soll) | Portal event_log (Ist) |`);
    push(`|---|---|---|`);
    push(`| Rechnungen bezahlt | ${exp.paid.size} Stück | ${act.paid.size} Rechnungs-IDs |`);
    push(`| Erstattungen | ${exp.refund.size} Stück | ${act.refund.size} Rechnungs-IDs |`);
    push(`| Netto-Umsatz | ${fmtEur(expNet)} | ${fmtEur(actNet)} |`);
    push(`| Event-Zeilen gesamt | | ${act.totalRows} |`);
    push(``);
    push(
      expNet === actNet
        ? `Netto stimmt centgenau überein: ${fmtEur(expNet)}.`
        : `**Netto-Differenz: ${fmtEur(actNet - expNet)}** (Soll ${fmtEur(expNet)}, Ist ${fmtEur(actNet)}).`
    );
    if (derived !== null) {
      push(``);
      push(
        `Level 2 (worker-abhängig): patients.lifetime_revenue_eur = ${fmtEur(derived)} ` +
          (derived === expNet
            ? `— entspricht dem Soll.`
            : `(Soll ${fmtEur(expNet)}; Abweichung normal, wenn der Worker nicht lief oder Refund-Netting anders bucht — informativ, nicht Teil des PASS/FAIL).`)
      );
    }
    if (problems.length > 0) {
      push(``);
      push(`### Findings`);
      for (const p of problems) {
        push(`- ${p.inFlight ? "(in-flight?) " : ""}\`${p.type}\` Rechnung ${p.invoiceId}: ${p.detail}`);
      }
    }
    push(``);
  };

  section("Praxis A — DB-Adapter-Pfad (tomedo)", expA, actA, problemsA, derivedA);
  section("Praxis B — Datei-Pfad (Honorar-CSV revenue, GDT patients)", expB, actB, problemsB, derivedB);

  push(`## GDT inbox`);
  push(``);
  push(`GDT carries patient master data only; revenue is checked in the sections above.`);
  push(``);
  push(`| | Praxis A | Praxis B |`);
  push(`|---|---|---|`);
  const row = (label: string, f: (g: GdtInboxResult) => string) =>
    push(`| ${label} | ${f(gdtA)} | ${f(gdtB)} |`);
  row("Patienten erwartet / im Portal", (g) => `${g.patientsExpected} / ${g.patientsInPortal}`);
  row("EINS-Dateien im Ordner (Root)", (g) => String(g.rootEinsFiles));
  row("In .eins/processing", (g) => String(g.processingFiles));
  row(".eins/failed vs. UTF-16-Drops (soft)", (g) => `${g.failedFiles} vs. ${g.utf16Drops}`);
  row("gdtChannelBusy (soft)", (g) => String(g.channelBusy));
  row("Fremd-/BDT-Dateien geschrieben (untouched)", (g) => String(g.untouchedDrops));
  push(``);
  if (gdtProblems.length === 0) {
    push(`Keine harten GDT-Findings.`);
  } else {
    push(`### Findings`);
    for (const p of gdtProblems) push(`- Praxis ${p.clinic} \`${p.type}\`: ${p.detail}`);
  }
  push(``);

  const report = lines.join("\n");
  writeFileSync(REPORT_PATH, report, "utf8");
  log("reconcile", `report written to ${REPORT_PATH}`);
  console.log("\n" + report + "\n");

  return {
    ok: hardTotal === 0,
    hardFailures: hardTotal,
    inFlightOnly: soft.length,
    report,
  };
}

// Standalone: `tsx src/reconcile.ts [graceSeconds]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reconcile(Number(process.argv[2] ?? 240))
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch((err) => {
      console.error("[reconcile] FATAL:", err);
      process.exit(2);
    });
}
