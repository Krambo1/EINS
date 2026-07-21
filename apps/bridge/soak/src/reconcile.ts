import { writeFileSync } from "node:fs";
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

  const all = [...problemsA, ...problemsB];
  const hard = all.filter((p) => !p.inFlight);
  const soft = all.filter((p) => p.inFlight);

  const derivedA = await derivedRevenue(CLINIC_A.id);
  const derivedB = await derivedRevenue(CLINIC_B.id);

  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`# PVS-Bridge Soak — Reconciliation`);
  push(``);
  push(`Generated: ${ts()}`);
  push(``);
  const verdict = hard.length === 0 ? "**PASS**" : `**FAIL** (${hard.length} hard finding${hard.length === 1 ? "" : "s"})`;
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
  section("Praxis B — Datei-Pfad (GDT + Honorar-CSV)", expB, actB, problemsB, derivedB);

  const report = lines.join("\n");
  writeFileSync(REPORT_PATH, report, "utf8");
  log("reconcile", `report written to ${REPORT_PATH}`);
  console.log("\n" + report + "\n");

  return {
    ok: hard.length === 0,
    hardFailures: hard.length,
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
