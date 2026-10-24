import type { CanonicalEvent } from "./types.js";
import { PvsEventMirror } from "./portal-schema.js";

/**
 * Pre-flight sanitiser: the one place vendor values are made to fit the portal
 * schema before anything is posted.
 *
 * Why it exists: the REST normalizers pass vendor values through verbatim, and
 * real vendor JSON is full of "" / "n/a" / ISO datetimes in date fields /
 * 5000-char notes. One such event used to make the portal reject the whole
 * batch, which the bridge treated as transient, so the cursor never advanced
 * and the whole practice froze behind a single row.
 *
 * Contract:
 *   - OPTIONAL fields that are blank / placeholder / invalid become undefined
 *     (email, phone, dob, gender, labels, notes ...), over-long strings are
 *     truncated to the portal limit, an ISO datetime in `dob` is cut to its date.
 *   - bemerkung is reduced to the EINS-Lead token (see leadToken), or omitted.
 *   - An invoice or refund in any currency but EUR / CHF is DROPPED
 *     (unsupported_currency), never relabelled.
 *   - REQUIRED fields that are missing or invalid DROP the event (counted,
 *     reason carries kind + field path, never a value: no patient data in logs).
 *     In particular an InvoicePaid without a valid paidAt is not an InvoicePaid:
 *     unpaid invoices are skipped entirely.
 *   - The result is finally validated against the bridge mirror of the portal
 *     Zod schema (portal-schema.ts), so anything the portal would reject for
 *     shape reasons is dropped here instead of reaching it.
 */

export interface SanitizeResult {
  /** Events safe to post, in input order. */
  events: CanonicalEvent[];
  /** Number of events dropped. */
  dropped: number;
  /** "Kind:field" (or "Kind:reason") -> count. */
  droppedByReason: Record<string, number>;
}

/** Placeholder strings vendors use for "no value". */
const PLACEHOLDER_RE = /^(?:n\/a|-{1,3}|–|—|null|undefined)$/i;

const ISO_DATETIME_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanString(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t === "" || PLACEHOLDER_RE.test(t)) return undefined;
  return t;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  // Do not leave half of a surrogate pair behind.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

function optText(v: unknown, max: number): string | undefined {
  const s = cleanString(v);
  return s === undefined ? undefined : truncate(s, max);
}

function optEmail(v: unknown): string | undefined {
  const s = cleanString(v);
  if (s === undefined || s.length > 200 || !EMAIL_RE.test(s)) return undefined;
  // The portal uses zod's email(); let the mirror decide the edge cases.
  return PvsEventMirror.safeParse({
    kind: "PatientUpserted",
    clinicId: "x",
    bridgeSource: "tomedo",
    pvsExternalEventId: "x",
    occurredAt: "2026-01-01T00:00:00.000Z",
    pvsPatientId: "x",
    email: s,
  }).success
    ? s
    : undefined;
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/** YYYY-MM-DD, accepting an ISO datetime (cut to its date) or DD.MM.YYYY. */
function optDob(v: unknown): string | undefined {
  const s = cleanString(v);
  if (s === undefined) return undefined;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(s);
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (de) {
    d = Number(de[1]);
    m = Number(de[2]);
    y = Number(de[3]);
  } else {
    return undefined;
  }
  if (!isRealDate(y, m, d)) return undefined;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Valid ISO datetime with offset, else undefined. Normalises anything Date can
 *  parse from an ISO-looking string; refuses bare numbers like "1". */
function isoDateTime(v: unknown): string | undefined {
  const s = cleanString(v);
  if (s === undefined) return undefined;
  if (ISO_DATETIME_OFFSET_RE.test(s) && !Number.isNaN(Date.parse(s))) return s;
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function reqId(v: unknown): string | undefined {
  const s = cleanString(v);
  // A required id is never truncated: two long ids could alias one another.
  return s !== undefined && s.length <= 200 ? s : undefined;
}

function optId(v: unknown): string | undefined {
  return optText(v, 200);
}

/** The same pattern the portal parses (apps/portal/src/server/pvs-token.ts). */
const LEAD_TOKEN_RE = /EINS-Lead-[0-9a-f]{8}/i;

/**
 * bemerkung is only used by the portal to link a PVS patient to the enquiry that
 * brought them (the EINS-Lead token EINS wrote into the note). Everything else a
 * practice types there is clinical free text the portal has no use for, so it
 * does not leave the bridge. Sending just the token also means the 4000
 * character limit can no longer cut the token off a long note.
 */
function leadToken(v: unknown): string | undefined {
  return typeof v === "string" ? LEAD_TOKEN_RE.exec(v)?.[0] : undefined;
}

const GENDERS = new Set(["f", "m", "d", "x"]);
const STATUSES = new Set(["scheduled", "checked_in", "completed", "no_show", "cancelled"]);

function cents(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const r = Math.round(v);
  return r >= 0 && r <= 100_000_000 ? r : undefined;
}

function currency(v: unknown): "EUR" | "CHF" | undefined {
  return v === "EUR" || v === "CHF" ? v : undefined;
}

/** A currency was given and it is neither EUR nor CHF. Absent / blank is fine. */
function unsupportedCurrency(raw: CanonicalEvent): boolean {
  const c = (raw as unknown as { currency?: unknown }).currency;
  if (c === undefined || c === null || c === "") return false;
  return c !== "EUR" && c !== "CHF";
}

/** Drop undefined keys so JSON and the schema see an absent field. */
function compact<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function coerce(raw: CanonicalEvent): Record<string, unknown> {
  const e = raw as unknown as Record<string, unknown>;
  const base = {
    kind: e.kind,
    clinicId: cleanString(e.clinicId),
    // csv_upload is reserved for the portal's own CSV worker (invalid_bridge_source).
    bridgeSource: e.bridgeSource === "csv_upload" ? undefined : e.bridgeSource,
    pvsExternalEventId: reqId(e.pvsExternalEventId),
    occurredAt: isoDateTime(e.occurredAt),
  };
  switch (e.kind) {
    case "PatientUpserted":
      return compact({
        ...base,
        pvsPatientId: reqId(e.pvsPatientId),
        email: optEmail(e.email),
        phone: optText(e.phone, 64),
        fullName: optText(e.fullName, 200),
        dob: optDob(e.dob),
        gender: typeof e.gender === "string" && GENDERS.has(e.gender) ? e.gender : undefined,
        bemerkung: leadToken(e.bemerkung),
        externalId: optId(e.externalId),
      });
    case "AppointmentCreated":
      return compact({
        ...base,
        pvsPatientId: reqId(e.pvsPatientId),
        pvsAppointmentId: reqId(e.pvsAppointmentId),
        scheduledAt: isoDateTime(e.scheduledAt),
        treatmentCode: optId(e.treatmentCode),
        treatmentLabel: optText(e.treatmentLabel, 200),
        locationCode: optId(e.locationCode),
        locationLabel: optText(e.locationLabel, 200),
        bemerkung: leadToken(e.bemerkung),
      });
    case "AppointmentStatusChanged":
      return compact({
        ...base,
        pvsPatientId: reqId(e.pvsPatientId),
        pvsAppointmentId: reqId(e.pvsAppointmentId),
        newStatus:
          typeof e.newStatus === "string" && STATUSES.has(e.newStatus) ? e.newStatus : undefined,
        changedAt: isoDateTime(e.changedAt),
      });
    case "AppointmentCancelled":
      return compact({
        ...base,
        pvsPatientId: reqId(e.pvsPatientId),
        pvsAppointmentId: reqId(e.pvsAppointmentId),
        cancellationReason: optText(e.cancellationReason, 200),
        cancelledBy: e.cancelledBy === "patient" || e.cancelledBy === "clinic" ? e.cancelledBy : undefined,
      });
    case "EncounterCompleted":
      return compact({
        ...base,
        pvsPatientId: reqId(e.pvsPatientId),
        pvsEncounterId: reqId(e.pvsEncounterId),
        pvsAppointmentId: optId(e.pvsAppointmentId),
        treatmentCode: optId(e.treatmentCode),
        treatmentLabel: optText(e.treatmentLabel, 200),
        completedAt: isoDateTime(e.completedAt),
        practitionerLabel: optText(e.practitionerLabel, 200),
      });
    case "InvoicePaid":
      return compact({
        ...base,
        pvsPatientId: reqId(e.pvsPatientId),
        pvsInvoiceId: reqId(e.pvsInvoiceId),
        pvsAppointmentId: optId(e.pvsAppointmentId),
        pvsEncounterId: optId(e.pvsEncounterId),
        amountCents: cents(e.amountCents),
        currency: currency(e.currency),
        // No valid paidAt => not a paid invoice => dropped (never defaulted).
        paidAt: isoDateTime(e.paidAt),
      });
    case "InvoiceRefunded":
      return compact({
        ...base,
        pvsPatientId: reqId(e.pvsPatientId),
        pvsInvoiceId: reqId(e.pvsInvoiceId),
        pvsAppointmentId: optId(e.pvsAppointmentId),
        pvsRefundId: optId(e.pvsRefundId),
        refundedAmountCents: cents(e.refundedAmountCents),
        currency: currency(e.currency),
        refundedAt: isoDateTime(e.refundedAt),
        reason: optText(e.reason, 200),
      });
    case "RecallScheduled":
      return compact({
        ...base,
        pvsPatientId: reqId(e.pvsPatientId),
        pvsRecallId: reqId(e.pvsRecallId),
        recallAt: isoDateTime(e.recallAt),
        treatmentCode: optId(e.treatmentCode),
        treatmentLabel: optText(e.treatmentLabel, 200),
      });
    case "PatientMerged":
      return compact({
        ...base,
        fromPvsPatientId: reqId(e.fromPvsPatientId),
        toPvsPatientId: reqId(e.toPvsPatientId),
      });
    default:
      return { kind: e.kind };
  }
}

/** Sanitise one event. Returns the event to post, or the drop reason. */
export function sanitizeEvent(
  raw: CanonicalEvent
): { event: CanonicalEvent } | { drop: string } {
  const kind = String((raw as { kind?: unknown })?.kind ?? "unknown");
  if (!raw || typeof raw !== "object") return { drop: "unknown:not_an_object" };
  if ((kind === "InvoicePaid" || kind === "InvoiceRefunded") && unsupportedCurrency(raw)) {
    // Reason carries the kind only, never the value.
    return { drop: `${kind}:unsupported_currency` };
  }
  let coerced: Record<string, unknown>;
  try {
    coerced = coerce(raw);
  } catch {
    return { drop: `${kind}:coerce_error` };
  }
  const parsed = PvsEventMirror.safeParse(coerced);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // path only, never a value: patient data must not reach logs.
    const path = issue?.path.join(".") || "kind";
    return { drop: `${kind}:${path}` };
  }
  return { event: coerced as unknown as CanonicalEvent };
}

export function sanitizeEvents(events: CanonicalEvent[]): SanitizeResult {
  const out: CanonicalEvent[] = [];
  const droppedByReason: Record<string, number> = {};
  let dropped = 0;
  for (const raw of events) {
    const r = sanitizeEvent(raw);
    if ("event" in r) {
      out.push(r.event);
    } else {
      dropped += 1;
      droppedByReason[r.drop] = (droppedByReason[r.drop] ?? 0) + 1;
    }
  }
  return { events: out, dropped, droppedByReason };
}
