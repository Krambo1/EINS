import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { PatientUpsertedEvent } from "@/server/pvs-events";
import { parseLeadTokenFromBemerkung } from "@/server/pvs-token";

/**
 * PVS Bridge — 3-stage patient linker.
 *
 * Stage 1: External-ID Direct
 *   pvs_patient_map[clinicId, pvsPatientId] → portalPatientId.
 *   Hit rate: near 100% for non-first-time events (after first PatientUpserted).
 *
 * Stage 2: Bemerkung Token (Direction A)
 *   Parse `EINS-Lead-{8hex}` from `event.bemerkung`. Match prefix against
 *   `requests.id`. If unique → upsert pvs_patient_map with method='bemerkung_token'.
 *   Hit rate: ~90% for newly-arrived PVS patients IF Direction A wrote the
 *   token at lead-time. Falls to 0% for clinics where Direction A isn't
 *   wired (or the MFA didn't paste the token).
 *
 * Stage 3: Fuzzy
 *   Inline lookup on (clinicId, lower(email)). If email missing/no match,
 *   trigram match on phone + full_name + dob. Returns top-3 candidates
 *   ranked by combined score; only the top is auto-accepted iff score ≥
 *   AUTO_ACCEPT_SCORE. Lower scores produce a linking_failure row with
 *   the candidates for one-click resolution.
 *
 * All three stages preserve idempotency: re-running the linker for the same
 * (clinicId, pvsPatientId) does not create duplicate map rows (UNIQUE
 * constraint + ON CONFLICT DO UPDATE).
 */

const AUTO_ACCEPT_SCORE = 0.85;

export interface LinkCandidate {
  patientId: string;
  /** 0..1 weighted match score (higher = better match). */
  score: number;
  /** Human-readable trace, e.g. "email exact + name 0.92 (trigram)". */
  reason: string;
}

// ---------------------------------------------------------------
// resolvePatientLink — Stage 1 only.
// ---------------------------------------------------------------

/**
 * Stage-1 lookup. Used by every non-PatientUpserted event. If miss, the
 * caller is expected to record a linking_failure and enqueue a backfill.
 */
export async function resolvePatientLink(
  clinicId: string,
  pvsPatientId: string
): Promise<{ portalPatientId: string; method: string } | null> {
  const [row] = await db
    .select({
      portalPatientId: schema.pvsPatientMap.portalPatientId,
      method: schema.pvsPatientMap.linkMethod,
    })
    .from(schema.pvsPatientMap)
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, clinicId),
        eq(schema.pvsPatientMap.pvsPatientId, pvsPatientId)
      )
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------
// upsertPatientFromPvs — PatientUpserted handler.
// ---------------------------------------------------------------

/**
 * Run on every PatientUpserted event. Drives:
 *   1. Stage 1→2→3 linking pipeline to either bind to an existing portal
 *      patient or create a new one.
 *   2. Upsert the patient row with PVS-derived demographics.
 *   3. Maintain pvs_patient_map row.
 *
 * Returns `{portalPatientId, method}` on a confident link, or
 * `{portalPatientId: null, candidates}` if Stage 3 found <AUTO_ACCEPT
 * matches (caller records linking_failure + creates no patient).
 */
export interface UpsertResult {
  portalPatientId: string | null;
  method: string;
  candidates: LinkCandidate[];
}

export async function upsertPatientFromPvs(
  event: PatientUpsertedEvent
): Promise<UpsertResult> {
  // Stage 1: existing map.
  const stage1 = await resolvePatientLink(event.clinicId, event.pvsPatientId);
  if (stage1) {
    await mergePvsDataIntoPatient(stage1.portalPatientId, event);
    return {
      portalPatientId: stage1.portalPatientId,
      method: stage1.method,
      candidates: [],
    };
  }

  // Stage 2: bemerkung token.
  if (event.bemerkung) {
    const token = parseLeadTokenFromBemerkung(event.bemerkung);
    if (token) {
      const matched = await findRequestByLeadPrefix(
        event.clinicId,
        token.prefix
      );
      if (matched && matched.patientId) {
        await db
          .insert(schema.pvsPatientMap)
          .values({
            clinicId: event.clinicId,
            pvsPatientId: event.pvsPatientId,
            portalPatientId: matched.patientId,
            linkMethod: "bemerkung_token",
            confidenceScore: "1.0",
          })
          .onConflictDoUpdate({
            target: [
              schema.pvsPatientMap.clinicId,
              schema.pvsPatientMap.pvsPatientId,
            ],
            set: {
              portalPatientId: matched.patientId,
              linkMethod: "bemerkung_token",
              confidenceScore: "1.0",
            },
          });
        await mergePvsDataIntoPatient(matched.patientId, event);
        return {
          portalPatientId: matched.patientId,
          method: "bemerkung_token",
          candidates: [],
        };
      }
    }
  }

  // Stage 3: fuzzy candidates (email → phone+name+dob trigram).
  const candidates = await findFuzzyCandidates(event);
  const top = candidates[0];
  if (top && top.score >= AUTO_ACCEPT_SCORE) {
    await db
      .insert(schema.pvsPatientMap)
      .values({
        clinicId: event.clinicId,
        pvsPatientId: event.pvsPatientId,
        portalPatientId: top.patientId,
        linkMethod: "fuzzy",
        confidenceScore: top.score.toFixed(2),
      })
      .onConflictDoUpdate({
        target: [
          schema.pvsPatientMap.clinicId,
          schema.pvsPatientMap.pvsPatientId,
        ],
        set: {
          portalPatientId: top.patientId,
          linkMethod: "fuzzy",
          confidenceScore: top.score.toFixed(2),
        },
      });
    await mergePvsDataIntoPatient(top.patientId, event);
    return {
      portalPatientId: top.patientId,
      method: "fuzzy",
      candidates,
    };
  }

  // No confident match — but we still want a patient row for this PVS
  // patient so downstream status-derive works. Create one and link it.
  // The linking_failures row (recorded by the caller) flags this for the
  // Praxis to merge later if it turns out to be a duplicate.
  const newPatientId = await createPatientFromPvs(event);
  await db.insert(schema.pvsPatientMap).values({
    clinicId: event.clinicId,
    pvsPatientId: event.pvsPatientId,
    portalPatientId: newPatientId,
    linkMethod: "external_id",
    confidenceScore: "1.0",
  });

  // If we DID find low-confidence candidates, record them on the failure
  // row so the Praxis can choose to merge. If we found nothing, no failure
  // entry is needed.
  return {
    portalPatientId: newPatientId,
    method: "external_id",
    candidates,
  };
}

// ---------------------------------------------------------------
// recordLinkingFailure
// ---------------------------------------------------------------

export async function recordLinkingFailure(input: {
  clinicId: string;
  pvsEventLogId: string;
  pvsEventOccurredAt: Date;
  pvsPatientId: string;
  snapshot: Record<string, unknown>;
  candidates: LinkCandidate[];
}): Promise<void> {
  // Don't spam the inbox if a failure for this (clinicId, pvsPatientId) is
  // already open. The candidates may have changed though, so update the row.
  const [existing] = await db
    .select({ id: schema.linkingFailures.id })
    .from(schema.linkingFailures)
    .where(
      and(
        eq(schema.linkingFailures.clinicId, input.clinicId),
        eq(schema.linkingFailures.pvsPatientId, input.pvsPatientId),
        eq(schema.linkingFailures.status, "open")
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.linkingFailures)
      .set({
        candidates: input.candidates as unknown as Record<string, unknown>,
        pvsPatientSnapshot: input.snapshot,
      })
      .where(eq(schema.linkingFailures.id, existing.id));
    return;
  }

  await db.insert(schema.linkingFailures).values({
    clinicId: input.clinicId,
    pvsEventLogId: input.pvsEventLogId,
    pvsEventOccurredAt: input.pvsEventOccurredAt,
    pvsPatientId: input.pvsPatientId,
    pvsPatientSnapshot: input.snapshot,
    candidates: input.candidates as unknown as Record<string, unknown>,
    status: "open",
  });
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

async function findRequestByLeadPrefix(
  clinicId: string,
  prefix: string
): Promise<{ requestId: string; patientId: string | null } | null> {
  // prefix is 8 hex chars; collision probability across clinic-scoped
  // requests is ~1 in 2^32 / requestsPerClinic. For a Praxis with 1000
  // requests, false-positive rate ≈ 0.00002%. Acceptable; we still order
  // by created_at DESC to prefer the most recent match if collisions ever
  // occur, and reject if >1 match exists.
  const rows = await db
    .select({
      id: schema.requests.id,
      patientId: schema.requests.patientId,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        sql`${schema.requests.id}::text LIKE ${prefix + "%"}`
      )
    )
    .orderBy(desc(schema.requests.createdAt))
    .limit(2);
  if (rows.length !== 1) return null;
  return { requestId: rows[0]!.id, patientId: rows[0]!.patientId };
}

async function findFuzzyCandidates(
  event: PatientUpsertedEvent
): Promise<LinkCandidate[]> {
  const emailLower = event.email?.trim().toLowerCase() ?? null;
  const phone = event.phone?.trim() ?? null;
  const fullName = event.fullName?.trim() ?? null;
  const dob = event.dob ?? null;

  // If we have nothing to match on, return empty.
  if (!emailLower && !phone && !fullName && !dob) return [];

  // Top-N candidates ordered by score DESC. The score formula:
  //   email exact:       1.00
  //   phone exact:       0.80
  //   phone trigram ≥0.6: 0.55..0.75 (lerp)
  //   name trigram ≥0.5:  0.20..0.40 (lerp)
  //   dob match:         0.20  (additive)
  //
  // We cap at 1.0 because email-exact alone is enough. The numbers were
  // chosen so a typical "Maria Müller, +49 30 12345, born 1970" fuzzy
  // match across phone+name+dob lands around 0.85 (auto-accept threshold).
  //
  // We compute it in SQL so we can rank in one round-trip; the alternative
  // is N+1 SELECTs which gets ugly at scale.
  const rows = await db.execute<{
    id: string;
    score: number;
    reason: string;
  }>(sql`
    WITH scored AS (
      SELECT
        p.id,
        (
          CASE WHEN ${emailLower} IS NOT NULL AND lower(p.email::text) = ${emailLower}
               THEN 1.00 ELSE 0 END
          +
          CASE WHEN ${phone} IS NOT NULL AND p.phone IS NOT NULL
                AND regexp_replace(p.phone, '[^0-9]', '', 'g') =
                    regexp_replace(${phone}, '[^0-9]', '', 'g')
               THEN 0.80 ELSE 0 END
          +
          CASE WHEN ${phone} IS NOT NULL AND p.phone IS NOT NULL
                AND similarity(p.phone, ${phone}) >= 0.6
                AND regexp_replace(p.phone, '[^0-9]', '', 'g') <>
                    regexp_replace(${phone}, '[^0-9]', '', 'g')
               THEN 0.55 + 0.20 * (similarity(p.phone, ${phone}) - 0.6) / 0.4
               ELSE 0 END
          +
          CASE WHEN ${fullName} IS NOT NULL AND p.full_name IS NOT NULL
                AND similarity(p.full_name, ${fullName}) >= 0.5
               THEN 0.20 + 0.20 * (similarity(p.full_name, ${fullName}) - 0.5) / 0.5
               ELSE 0 END
          +
          CASE WHEN ${dob} IS NOT NULL AND p.dob IS NOT NULL AND p.dob = ${dob}::date
               THEN 0.20 ELSE 0 END
        ) AS raw_score,
        (
          CASE WHEN ${emailLower} IS NOT NULL AND lower(p.email::text) = ${emailLower}
               THEN 'email exact' ELSE '' END
        ) AS email_reason
      FROM patients p
      WHERE p.clinic_id = ${event.clinicId}
        AND (
          (${emailLower} IS NOT NULL AND lower(p.email::text) = ${emailLower})
          OR (${phone} IS NOT NULL AND p.phone IS NOT NULL AND similarity(p.phone, ${phone}) >= 0.4)
          OR (${fullName} IS NOT NULL AND p.full_name IS NOT NULL AND similarity(p.full_name, ${fullName}) >= 0.4)
          OR (${dob} IS NOT NULL AND p.dob = ${dob}::date)
        )
    )
    SELECT
      id,
      LEAST(1.0, raw_score) AS score,
      email_reason AS reason
    FROM scored
    WHERE raw_score > 0
    ORDER BY raw_score DESC
    LIMIT 3
  `);

  return rows.map((r) => ({
    patientId: r.id,
    score: Number(r.score),
    reason: r.reason || buildReason(event),
  }));
}

function buildReason(event: PatientUpsertedEvent): string {
  const bits: string[] = [];
  if (event.email) bits.push(`email`);
  if (event.phone) bits.push(`phone`);
  if (event.fullName) bits.push(`name`);
  if (event.dob) bits.push(`dob`);
  return bits.length ? `fuzzy: ${bits.join("+")}` : "fuzzy";
}

async function createPatientFromPvs(
  event: PatientUpsertedEvent
): Promise<string> {
  const emailLower = event.email?.trim().toLowerCase() ?? null;
  // citext customType declares notNull:true in the Drizzle layer even
  // though the DB column is nullable; the cast to `string` is the
  // narrowest workaround. Drizzle serializes null to SQL NULL fine.
  const [row] = await db
    .insert(schema.patients)
    .values({
      clinicId: event.clinicId,
      email: emailLower as unknown as string,
      phone: event.phone ?? null,
      fullName: event.fullName ?? null,
      dob: event.dob ?? null,
      gender: event.gender ?? null,
      pvsPatientId: event.pvsPatientId,
      externalId: event.externalId ?? null,
      firstTouchSource: "pvs",
    })
    .returning({ id: schema.patients.id });
  return row!.id;
}

async function mergePvsDataIntoPatient(
  portalPatientId: string,
  event: PatientUpsertedEvent
): Promise<void> {
  // Only overwrite fields if the PVS provides them — never clobber a
  // portal-side value with NULL. The denormalized pvs_patient_id is updated
  // unconditionally so the patient detail page can show "primary PVS id".
  await db
    .update(schema.patients)
    .set({
      lastSeenAt: new Date(),
      email: event.email
        ? event.email.trim().toLowerCase()
        : sql`${schema.patients.email}`,
      phone: event.phone ?? sql`${schema.patients.phone}`,
      fullName: event.fullName ?? sql`${schema.patients.fullName}`,
      dob: event.dob ?? sql`${schema.patients.dob}`,
      gender: event.gender ?? sql`${schema.patients.gender}`,
      pvsPatientId: event.pvsPatientId,
    })
    .where(eq(schema.patients.id, portalPatientId));
}

// ---------------------------------------------------------------
// One-off Stage-3 re-runner — used by the pvs-link-backfill worker.
// ---------------------------------------------------------------

/**
 * Re-run Stage-3 for a single (clinicId, pvsPatientId) tuple. Used when a
 * non-PatientUpserted event arrives for a PVS patient that hasn't been
 * seen via PatientUpserted yet — we fetch the patient's most recent
 * PatientUpserted from event_log (if any) and re-run the linker.
 */
export async function backfillLinkFromHistory(
  clinicId: string,
  pvsPatientId: string
): Promise<void> {
  // Already linked? No-op.
  const existing = await resolvePatientLink(clinicId, pvsPatientId);
  if (existing) return;

  // Find the most-recent PatientUpserted event for this patient.
  const [latest] = await db
    .select({
      id: schema.pvsEventLog.id,
      payload: schema.pvsEventLog.payload,
      occurredAt: schema.pvsEventLog.occurredAt,
    })
    .from(schema.pvsEventLog)
    .where(
      and(
        eq(schema.pvsEventLog.clinicId, clinicId),
        eq(schema.pvsEventLog.kind, "PatientUpserted"),
        sql`${schema.pvsEventLog.payload}->>'pvsPatientId' = ${pvsPatientId}`
      )
    )
    .orderBy(desc(schema.pvsEventLog.occurredAt))
    .limit(1);

  if (!latest) return; // nothing to backfill from

  const event = latest.payload as unknown as PatientUpsertedEvent;
  await upsertPatientFromPvs(event);
}

// ---------------------------------------------------------------
// Manual resolution — called from the linking-failures inbox UI.
// ---------------------------------------------------------------

export async function manuallyResolveLinkingFailure(input: {
  failureId: string;
  resolverUserId: string;
  pickedPatientId: string;
  method: "candidate_pick" | "manual_search" | "new_patient";
}): Promise<void> {
  const [failure] = await db
    .select({
      id: schema.linkingFailures.id,
      clinicId: schema.linkingFailures.clinicId,
      pvsPatientId: schema.linkingFailures.pvsPatientId,
    })
    .from(schema.linkingFailures)
    .where(
      and(
        eq(schema.linkingFailures.id, input.failureId),
        eq(schema.linkingFailures.status, "open"),
        isNull(schema.linkingFailures.resolvedAt)
      )
    )
    .limit(1);
  if (!failure) return;

  await db
    .insert(schema.pvsPatientMap)
    .values({
      clinicId: failure.clinicId,
      pvsPatientId: failure.pvsPatientId,
      portalPatientId: input.pickedPatientId,
      linkMethod: "manual",
      confidenceScore: "1.0",
      linkedBy: input.resolverUserId,
    })
    .onConflictDoUpdate({
      target: [
        schema.pvsPatientMap.clinicId,
        schema.pvsPatientMap.pvsPatientId,
      ],
      set: {
        portalPatientId: input.pickedPatientId,
        linkMethod: "manual",
        confidenceScore: "1.0",
        linkedBy: input.resolverUserId,
      },
    });

  await db
    .update(schema.linkingFailures)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: input.resolverUserId,
      resolvedToPatientId: input.pickedPatientId,
      resolutionMethod: input.method,
    })
    .where(eq(schema.linkingFailures.id, input.failureId));
}

export async function ignoreLinkingFailure(
  failureId: string,
  resolverUserId: string
): Promise<void> {
  await db
    .update(schema.linkingFailures)
    .set({
      status: "ignored",
      resolvedAt: new Date(),
      resolvedBy: resolverUserId,
      resolutionMethod: "ignored",
    })
    .where(eq(schema.linkingFailures.id, failureId));
}
