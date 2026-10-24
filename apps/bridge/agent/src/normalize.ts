import {
  pickAll,
  pickFirst,
  type GdtParseResult,
  type GdtRecord,
  type GdtSatz,
} from "./gdt-parser.js";

/**
 * GDT / BDT → canonical event translator.
 *
 * What GDT really carries (GDT 2.1 spec, QMS): GDT is the PVS ↔ medical
 * DEVICE interface. When the Praxis team clicks the EINS "device" in a
 * patient's chart, the PVS writes a Satz addressed to EINS:
 *
 *   6301 Stammdaten übermitteln       → PatientUpserted
 *   6302 Neue Untersuchung anfordern  → PatientUpserted (same patient block;
 *                                       CGM Turbomed must send 6302 whenever
 *                                       a Kennfeld 8402 is configured)
 *   6311 Daten einer Untersuchung zeigen → PatientUpserted
 *   6100 (BDT Patientenstamm)          → PatientUpserted
 *
 * Everything else yields nothing: 6300/6310 travel device → PVS and are not
 * ours to read, and BDT treatment Sätze are not translated.
 *
 * GDT has NO billing, appointment or remark fields. Earlier versions of this
 * file read FK 8420 as an invoice amount (8420 is "Ergebnis-Wert", a
 * MEASUREMENT such as a blood pressure), FK 6228 as a payment date (it is
 * "Ergebnistabellentext"), FK 3622 as a remark (it is the patient's height)
 * and a Satzart "8316" (8316 is the FIELD "GDT-ID des Senders"). That
 * produced fake revenue from lab values. Revenue comes only from the
 * Honorar-CSV path, the DB adapters or the cloud adapters.
 *
 * Patient fields (GDT 2.1 / 3.x, BDT):
 *   3000 Patientennummer   3100 Namenszusatz   3101 Name   3102 Vorname
 *   3103 Geburtsdatum TTMMJJJJ   3110 Geschlecht (1=m, 2=w; 3.x also M/W/D/X)
 *   3618 Mobiltelefon (3.x)   3619 E-Mail (3.x)   3626 Telefon (3.x, BDT)
 * Address, insurance number, height, weight and mother tongue are NOT
 * forwarded (data minimisation: EINS needs identity for lead linking only).
 *
 * Lead token: free-text fields (6220 Befund, 6227 Kommentar, ...) are
 * scanned ONLY for the `EINS-Lead-xxxxxxxx` token the Praxis may have
 * pasted; the clinical text itself is never forwarded.
 *
 * NOTE: canonical event types are duplicated from apps/bridge/src/canonical
 * to keep the agent buildable independently. Keep in sync.
 */

export interface CanonicalEvent {
  kind:
    | "PatientUpserted"
    | "AppointmentCreated"
    | "AppointmentStatusChanged"
    | "AppointmentCancelled"
    | "EncounterCompleted"
    | "InvoicePaid"
    | "InvoiceRefunded"
    | "RecallScheduled";
  clinicId: string;
  bridgeSource: "gdt_agent";
  pvsExternalEventId: string;
  occurredAt: string;
  [k: string]: unknown;
}

export interface NormalizeContext {
  clinicId: string;
  contentHash: string;
  /**
   * ISO-8601 UTC modification time of the source file (the moment the PVS
   * wrote it). Used as occurredAt: a 6301/6302 carries no business date, and
   * the file mtime is stable across re-reads of the same file, so a crash
   * between enqueue and delete re-emits byte-identical events (dedup).
   * Optional for back-compat; absent → one wall-clock stamp per file.
   */
  fileModifiedAtIso?: string;
}

/** Satzarten that translate to PatientUpserted. */
export const PATIENT_SATZARTEN = new Set(["6301", "6302", "6311", "6100"]);

let droppedNoPatientIdCount = 0;
const RATE_LIMIT_LOG_UNTIL = 5;

function noteDroppedNoPatientId(satzart: string, contentHash: string): void {
  droppedNoPatientIdCount++;
  if (droppedNoPatientIdCount <= RATE_LIMIT_LOG_UNTIL) {
    console.warn(
      `[normalize] Satz (satzart=${satzart}) has no patient FK 3000; dropped instead of ` +
        `fabricating a phantom patient. count=${droppedNoPatientIdCount} hash=${contentHash.slice(0, 12)}`
    );
  }
}

export function gdtToCanonical(
  parsed: GdtParseResult,
  ctx: NormalizeContext
): CanonicalEvent[] {
  const saetze = parsed.saetze;
  if (saetze.length === 0) return [];
  const resolved: NormalizeContext = {
    ...ctx,
    fileModifiedAtIso: ctx.fileModifiedAtIso ?? new Date().toISOString(),
  };
  if (saetze.length === 1) {
    return satzToCanonical(saetze[0], resolved);
  }
  // Several Sätze in one file (allowed by the spec; BDT always): scope the
  // hash per Satz so two Sätze of one patient cannot collide on an event id.
  const events: CanonicalEvent[] = [];
  saetze.forEach((satz, i) => {
    events.push(
      ...satzToCanonical(satz, {
        ...resolved,
        contentHash: `${resolved.contentHash}:s${i}`,
      })
    );
  });
  return events;
}

function satzToCanonical(satz: GdtSatz, ctx: NormalizeContext): CanonicalEvent[] {
  if (!PATIENT_SATZARTEN.has(satz.satzart)) return [];
  if (!pickFirst(satz.records, "3000")) {
    noteDroppedNoPatientId(satz.satzart, ctx.contentHash);
    return [];
  }
  return [patientFromGdt(satz.records, ctx)];
}

function patientFromGdt(fks: GdtRecord[], ctx: NormalizeContext): CanonicalEvent {
  const pvsPatientId = (pickFirst(fks, "3000") as string).slice(0, 200);
  const firstName = pickFirst(fks, "3102");
  const prefix = pickFirst(fks, "3100");
  const lastName = pickFirst(fks, "3101");
  const fullName =
    [firstName, prefix, lastName].filter(Boolean).join(" ").slice(0, 200) || undefined;
  return {
    kind: "PatientUpserted",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: `gdt:patient:${pvsPatientId}:${ctx.contentHash}`,
    occurredAt: ctx.fileModifiedAtIso as string,
    pvsPatientId,
    fullName,
    dob: formatGdtDate(pickFirst(fks, "3103")),
    gender: mapGender(pickFirst(fks, "3110")),
    email: pickEmail(fks),
    phone: pickPhone(fks),
    bemerkung: collectLeadTokens(fks),
  };
}

/**
 * Lead-token extraction (Stage-2 linking). Mirrors the portal's tolerant
 * parser (apps/portal/src/server/pvs-token.ts): "EINS-Lead-1a2b3c4d",
 * "EINS Lead: 1a2b3c4d", "eins_lead_1A2B3C4D". Only the normalised tokens are
 * forwarded, never the surrounding text.
 */
const LEAD_TOKEN_RE = /EINS[\s\-_:]*Lead[\s\-_:]*([0-9a-fA-F]{8})(?![0-9a-fA-F])/gi;

function collectLeadTokens(fks: GdtRecord[]): string | undefined {
  const tokens = new Set<string>();
  for (const r of fks) {
    for (const m of r.value.matchAll(LEAD_TOKEN_RE)) {
      tokens.add(`EINS-Lead-${m[1].toLowerCase()}`);
    }
  }
  return tokens.size > 0 ? [...tokens].join(" ") : undefined;
}

function pickEmail(fks: GdtRecord[]): string | undefined {
  const v = pickFirst(fks, "3619");
  if (v && isEmail(atFromDin(v))) return atFromDin(v).trim().toLowerCase();
  // Non-conformant exporters put the address in another patient (3xxx)
  // field; accept it only when the value is unambiguously an e-mail address.
  for (const r of fks) {
    if (!r.feldKennung.startsWith("3")) continue;
    const c = atFromDin(r.value);
    if (isEmail(c)) return c.trim().toLowerCase();
  }
  return undefined;
}

/**
 * 7-bit DIN 66003 (FK 9206=1) has no "@": byte 0x40 is "§". A PVS writing
 * an address into such a file still writes 0x40, which decodes as "§".
 * "§" never occurs in a valid address, so exactly one "§" and no "@" is
 * restored.
 */
function atFromDin(v: string): string {
  if (v.includes("@")) return v;
  const parts = v.split("§");
  return parts.length === 2 ? parts.join("@") : v;
}

function pickPhone(fks: GdtRecord[]): string | undefined {
  for (const fk of ["3618", "3626"]) {
    for (const v of pickAll(fks, fk)) {
      if (isPhone(v)) return v.trim().replace(/\s{2,}/g, " ").slice(0, 64);
    }
  }
  return undefined;
}

function isEmail(v: string): boolean {
  const t = v.trim();
  return t.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function isPhone(v: string): boolean {
  const t = v.trim();
  if (t.length < 4 || t.length > 64) return false;
  if (!/^[\d+()\-\s/.]+$/.test(t)) return false;
  return t.replace(/\D/g, "").length >= 5;
}

/** GDT date TTMMJJJJ → YYYY-MM-DD, calendar-validated. */
export function formatGdtDate(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const m = input.trim().match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 1880 || month < 1 || month > 12 || day < 1) return undefined;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function mapGender(input: string | undefined): "f" | "m" | "d" | "x" | undefined {
  if (!input) return undefined;
  switch (input.trim().toLowerCase()) {
    case "1":
    case "m":
      return "m";
    case "2":
    case "w":
    case "f":
      return "f";
    case "d":
      return "d";
    case "x":
      return "x";
    default:
      return undefined;
  }
}
