import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { firstTouchFields } from "@/lib/sources";
import { namesCompatible } from "@/server/pvs-linking";

/**
 * Pass 2 (PVS bridge review): attach Anfragen to the portal patient that the
 * PVS bridge created or matched.
 *
 * Nothing in production ever wrote `requests.patient_id`: lead intake stores
 * only contact fields, and the PVS linker matches PVS patients against the
 * `patients` table, where leads never appear. pvs-status-derive selects a
 * patient's Anfragen by patient_id, so no Anfrage ever received a PVS status,
 * revenue or a Purchase conversion.
 *
 * The link is made from the patient side, at the start of every derive run:
 * open Anfragen (patient_id NULL, not spam) of the same Praxis whose contact
 * email equals the patient's email, or whose phone number ends in the same 9
 * digits, are attached when the names do not contradict. Because migration
 * 0091 re-derives every PVS patient once, this also backfills history.
 *
 * Deliberately NOT done: creating a patient for every Anfrage at intake. The
 * 24-month anonymisation of unbooked Anfragen (purge-retention) treats a set
 * patient_id as "became a patient"; a patient row per lead would stop every
 * lead from ever being anonymised and keep its contact data in `patients`.
 */

/** Phone numbers match on their last 9 digits (+49 171 … vs 0171 …). */
export const PHONE_MATCH_DIGITS = 9;

export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= PHONE_MATCH_DIGITS
    ? digits.slice(-PHONE_MATCH_DIGITS)
    : null;
}

export interface LinkablePatient {
  email: string | null;
  phone: string | null;
  fullName: string | null;
  /** False when another patient of the Praxis has the same phone key (shared
   *  landline, duplicate record): the phone then proves nothing. */
  phoneUnique: boolean;
}

export interface LinkableRequest {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
}

/**
 * Pure match rule.
 *  - email: equal (case-insensitive) and names compatible. Same gate as the
 *    linker's email_exact auto-accept (shared family email with a different
 *    last name does not link).
 *  - phone: same last 9 digits, the key belongs to this patient only, BOTH
 *    names known and compatible. A phone alone is weaker than an email, so an
 *    unknown name on either side never links.
 */
export function requestMatchesPatient(
  r: LinkableRequest,
  p: LinkablePatient
): "email" | "phone" | null {
  if (r.status === "spam") return null;
  const re = r.contactEmail?.trim().toLowerCase();
  const pe = p.email?.trim().toLowerCase();
  if (re && pe && re === pe && namesCompatible(r.contactName, p.fullName)) {
    return "email";
  }
  const rk = phoneKey(r.contactPhone);
  const pk = phoneKey(p.phone);
  if (
    p.phoneUnique &&
    rk &&
    pk &&
    rk === pk &&
    r.contactName?.trim() &&
    p.fullName?.trim() &&
    namesCompatible(r.contactName, p.fullName)
  ) {
    return "phone";
  }
  return null;
}

/**
 * Pure: the patient's first-touch source after attaching Anfragen. A patient
 * the bridge created carries "pvs"; when an attached Anfrage is older than the
 * portal patient row, that Anfrage is how the patient found the Praxis, so the
 * LTV-by-source view counts the patient under the Anfrage's source.
 *
 * Pass 2 (verifier): the portal row is created when the bridge first sees the
 * patient, so for a long-standing patient every pre-go-live Anfrage is
 * "older". When the PVS shows activity (appointment, invoice, encounter) more
 * than a day before the Anfrage, the patient existed before it and stays
 * "pvs"; otherwise years of lifetime value would move onto the lead's channel.
 * Limit: the bridge only reads back as far as its initial horizon.
 */
export function firstTouchAfterAttach(
  current: string | null,
  patientCreatedAt: Date,
  attached: Array<{ source: string; createdAt: Date }>,
  earliestPvsActivityAt: Date | null = null
): string | null {
  return (
    firstTouchRequestAfterAttach(current, patientCreatedAt, attached, earliestPvsActivityAt)
      ?.source ?? current
  );
}

/**
 * Same rule as firstTouchAfterAttach, but returns the Anfrage that becomes
 * the first touch (null = the first touch stays as it is), so the caller can
 * also store its channel and post code.
 */
export function firstTouchRequestAfterAttach<T extends { source: string; createdAt: Date }>(
  current: string | null,
  patientCreatedAt: Date,
  attached: T[],
  earliestPvsActivityAt: Date | null = null
): T | null {
  if (current && current !== "pvs") return null;
  const earliest = [...attached].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  )[0];
  if (!earliest || earliest.createdAt.getTime() > patientCreatedAt.getTime()) {
    return null;
  }
  if (
    earliestPvsActivityAt &&
    earliestPvsActivityAt.getTime() < earliest.createdAt.getTime() - EXISTING_PATIENT_SLACK_MS
  ) {
    return null;
  }
  return earliest;
}

const EXISTING_PATIENT_SLACK_MS = 24 * 60 * 60 * 1000;

/** Upper bound per run; a real patient has a handful of Anfragen. */
const ATTACH_CANDIDATE_LIMIT = 200;

/**
 * Attach every matching open Anfrage to the patient. Returns the number of
 * Anfragen linked. Never re-points an Anfrage that already has a patient.
 */
export async function attachRequestsToPatient(
  clinicId: string,
  patientId: string,
  /** Earliest non-PatientUpserted PVS event of the patient (see firstTouchAfterAttach). */
  earliestPvsActivityAt: Date | null = null
): Promise<number> {
  const [p] = await db
    .select({
      email: schema.patients.email,
      phone: schema.patients.phone,
      fullName: schema.patients.fullName,
      firstTouchSource: schema.patients.firstTouchSource,
      createdAt: schema.patients.createdAt,
    })
    .from(schema.patients)
    .where(
      and(
        eq(schema.patients.id, patientId),
        eq(schema.patients.clinicId, clinicId)
      )
    )
    .limit(1);
  if (!p) return 0;

  const emailLower = p.email ? String(p.email).trim().toLowerCase() : null;
  const key = phoneKey(p.phone);
  if (!emailLower && !key) return 0;

  let phoneUnique = false;
  if (key) {
    const holders = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM patients q
      WHERE q.clinic_id = ${clinicId}::uuid
        AND q.id <> ${patientId}::uuid
        AND right(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g'), ${PHONE_MATCH_DIGITS}) = ${key}::text
    `);
    phoneUnique = Number(holders[0]?.n ?? 0) === 0;
  }

  const rows = await db.execute<{
    id: string;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    status: string;
    source: string;
    utm: unknown;
    created_at: Date | string;
  }>(sql`
    SELECT r.id, r.contact_name, r.contact_email, r.contact_phone, r.status,
           r.source, r.utm, r.created_at
    FROM requests r
    WHERE r.clinic_id = ${clinicId}::uuid
      AND r.patient_id IS NULL
      AND r.status <> 'spam'
      AND (
        (${emailLower}::text IS NOT NULL AND lower(r.contact_email) = ${emailLower}::text)
        OR (${key}::text IS NOT NULL
            AND right(regexp_replace(coalesce(r.contact_phone, ''), '[^0-9]', '', 'g'), ${PHONE_MATCH_DIGITS}) = ${key}::text)
      )
    ORDER BY r.created_at DESC
    LIMIT ${ATTACH_CANDIDATE_LIMIT}
  `);

  const patient: LinkablePatient = {
    email: emailLower,
    phone: p.phone,
    fullName: p.fullName,
    phoneUnique,
  };
  const matched = rows.filter(
    (r) =>
      requestMatchesPatient(
        {
          contactName: r.contact_name,
          contactEmail: r.contact_email,
          contactPhone: r.contact_phone,
          status: r.status,
        },
        patient
      ) !== null
  );
  if (matched.length === 0) return 0;

  const linked = await db
    .update(schema.requests)
    .set({ patientId })
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        inArray(
          schema.requests.id,
          matched.map((r) => r.id)
        ),
        isNull(schema.requests.patientId)
      )
    )
    .returning({ id: schema.requests.id });
  if (linked.length === 0) return 0;

  const linkedIds = new Set(linked.map((r) => r.id));
  const firstTouch = firstTouchRequestAfterAttach(
    p.firstTouchSource,
    p.createdAt,
    matched
      .filter((r) => linkedIds.has(r.id))
      .map((r) => ({ source: r.source, utm: r.utm, createdAt: new Date(r.created_at) })),
    earliestPvsActivityAt
  );
  if (firstTouch) {
    await db
      .update(schema.patients)
      .set({
        firstTouchSource: firstTouch.source,
        ...firstTouchFields(firstTouch.source, firstTouch.utm),
      })
      .where(eq(schema.patients.id, patientId));
  }
  return linked.length;
}
