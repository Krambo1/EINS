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
 * Stage 3: Email-exact only auto-accept; fuzzy → review queue
 *   The linker computes the same scored candidate set as before (email,
 *   phone-exact / phone-trigram, name-trigram, dob match) so the operator
 *   has a ranked list to choose from. BUT we no longer silently
 *   auto-merge fuzzy matches at score ≥ 0.85: that threshold could collide
 *   two patients named "Maria Müller" born the same year whose phones
 *   trigram-matched ≥ 0.6, producing a permanent wrong-link that mis-
 *   attributes revenue and ad-conversion fanout. (P1-1 hardening.)
 *
 *   Auto-accept rule (post P1-1):
 *     • Exactly one candidate exists with email-exact match, AND
 *     • that candidate's score is 1.0 (i.e. the email matches and no
 *       other signal is in disagreement).
 *   Anything else (including multi-email collisions, phone-trigram-only
 *   matches, name+dob-only matches) creates a NEW patient row + map and
 *   writes a linking_failure for one-click operator merge.
 *
 *   Trade-off: legitimate high-confidence-but-not-email matches that used
 *   to auto-merge now produce a duplicate patient until the operator
 *   triages. The plan accepts this: a small amount of operator time is
 *   strictly cheaper than the failure mode where the wrong patient's
 *   InvoicePaid stream funnels into someone else's lifetime revenue.
 *
 * All three stages preserve idempotency: re-running the linker for the same
 * (clinicId, pvsPatientId) does not create duplicate map rows (UNIQUE
 * constraint + ON CONFLICT DO UPDATE).
 */

export interface LinkCandidate {
  patientId: string;
  /** 0..1 weighted match score (higher = better match). */
  score: number;
  /**
   * Set to `true` when the candidate's email exactly matches the event
   * email (case-insensitive). The auto-accept gate uses this structurally
   * — we do NOT pattern-match on the `reason` string for that decision.
   */
  isEmailExact: boolean;
  /** Human-readable trace, e.g. "email exact + name 0.92 (trigram)". */
  reason: string;
}

// ---------------------------------------------------------------
// chooseAutoAcceptCandidate — pure decision function (P1-1).
// ---------------------------------------------------------------

/**
 * Apply the post-P1-1 auto-accept gate to a candidate list.
 *
 * Rule, in order:
 *   1. There must be EXACTLY ONE candidate where `isEmailExact === true`.
 *      Zero or two-plus email-exact matches return null (the latter is a
 *      data-quality issue; we never want the linker to silently pick one
 *      of N colliding emails for the operator).
 *   2. That candidate's score must be >= 1.0. In the current scoring
 *      formula, email-exact contributes exactly 1.0 and the raw score is
 *      capped at 1.0, so any email-exact match satisfies this. The check
 *      exists as future-proofing — if a future tuning lowers the email
 *      weight, the auto-accept gate stays conservative without further
 *      code changes.
 *
 * Pure function: no DB, no I/O, no schema dependency. Lives next to the
 * caller so changing the rule is a one-place edit; exported so the
 * adversarial fixture suite (pvs-linking.test.ts) can drive it without
 * spinning up a Postgres.
 */
export function chooseAutoAcceptCandidate(
  candidates: LinkCandidate[]
): LinkCandidate | null {
  const emailExact = candidates.filter((c) => c.isEmailExact);
  if (emailExact.length !== 1) return null;
  const winner = emailExact[0]!;
  if (winner.score < 1.0) return null;
  return winner;
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

  // Stage 3: collect candidates (same scoring as before, used for the
  // review-queue UI), then apply the P1-1 tightened auto-accept gate.
  const candidates = await findFuzzyCandidates(event);

  const winner = chooseAutoAcceptCandidate(candidates);
  if (winner) {
    await db
      .insert(schema.pvsPatientMap)
      .values({
        clinicId: event.clinicId,
        pvsPatientId: event.pvsPatientId,
        portalPatientId: winner.patientId,
        linkMethod: "email_exact",
        confidenceScore: "1.0",
      })
      .onConflictDoUpdate({
        target: [
          schema.pvsPatientMap.clinicId,
          schema.pvsPatientMap.pvsPatientId,
        ],
        set: {
          portalPatientId: winner.patientId,
          linkMethod: "email_exact",
          confidenceScore: "1.0",
        },
      });
    await mergePvsDataIntoPatient(winner.patientId, event);
    return {
      portalPatientId: winner.patientId,
      method: "email_exact",
      // No candidates returned on auto-accept: the caller uses this to
      // decide whether to write a linking_failure (i.e. "operator should
      // review"). For email-exact wins, no review needed.
      candidates: [],
    };
  }

  // No confident match — create a fresh patient + map so events keep
  // flowing. If we found candidates (incl. multi-email-exact ambiguity,
  // phone+name+dob fuzzy, etc.) we return them so the caller writes a
  // linking_failure for one-click operator merge.
  const newPatientId = await createPatientFromPvs(event);
  await db.insert(schema.pvsPatientMap).values({
    clinicId: event.clinicId,
    pvsPatientId: event.pvsPatientId,
    portalPatientId: newPatientId,
    linkMethod: "external_id",
    confidenceScore: "1.0",
  });

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
  //
  // Explicit ::text / ::date casts on every parameter: without them, PG
  // raises 42P18 ("could not determine data type of parameter $N") on
  // expressions like `$1 IS NOT NULL` where the placeholder appears in a
  // type-agnostic context. The casts pin the type at parse time and also
  // make NULLs round-trip cleanly through postgres.js's parameter binding.
  const rows = await db.execute<{
    id: string;
    score: number;
    reason: string;
    is_email_exact: boolean;
  }>(sql`
    WITH scored AS (
      SELECT
        p.id,
        (
          CASE WHEN ${emailLower}::text IS NOT NULL AND lower(p.email::text) = ${emailLower}::text
               THEN 1.00 ELSE 0 END
          +
          CASE WHEN ${phone}::text IS NOT NULL AND p.phone IS NOT NULL
                AND regexp_replace(p.phone, '[^0-9]', '', 'g') =
                    regexp_replace(${phone}::text, '[^0-9]', '', 'g')
               THEN 0.80 ELSE 0 END
          +
          CASE WHEN ${phone}::text IS NOT NULL AND p.phone IS NOT NULL
                AND similarity(p.phone, ${phone}::text) >= 0.6
                AND regexp_replace(p.phone, '[^0-9]', '', 'g') <>
                    regexp_replace(${phone}::text, '[^0-9]', '', 'g')
               THEN 0.55 + 0.20 * (similarity(p.phone, ${phone}::text) - 0.6) / 0.4
               ELSE 0 END
          +
          CASE WHEN ${fullName}::text IS NOT NULL AND p.full_name IS NOT NULL
                AND similarity(p.full_name, ${fullName}::text) >= 0.5
               THEN 0.20 + 0.20 * (similarity(p.full_name, ${fullName}::text) - 0.5) / 0.5
               ELSE 0 END
          +
          CASE WHEN ${dob}::date IS NOT NULL AND p.dob IS NOT NULL AND p.dob = ${dob}::date
               THEN 0.20 ELSE 0 END
        ) AS raw_score,
        (
          CASE WHEN ${emailLower}::text IS NOT NULL AND lower(p.email::text) = ${emailLower}::text
               THEN TRUE ELSE FALSE END
        ) AS is_email_exact,
        (
          CASE WHEN ${emailLower}::text IS NOT NULL AND lower(p.email::text) = ${emailLower}::text
               THEN 'email exact' ELSE '' END
        ) AS email_reason
      FROM patients p
      WHERE p.clinic_id = ${event.clinicId}::uuid
        AND (
          (${emailLower}::text IS NOT NULL AND lower(p.email::text) = ${emailLower}::text)
          OR (${phone}::text IS NOT NULL AND p.phone IS NOT NULL AND similarity(p.phone, ${phone}::text) >= 0.4)
          OR (${fullName}::text IS NOT NULL AND p.full_name IS NOT NULL AND similarity(p.full_name, ${fullName}::text) >= 0.4)
          OR (${dob}::date IS NOT NULL AND p.dob = ${dob}::date)
        )
    )
    SELECT
      id,
      LEAST(1.0, raw_score) AS score,
      email_reason AS reason,
      is_email_exact
    FROM scored
    WHERE raw_score > 0
    ORDER BY raw_score DESC
    LIMIT 5
  `);

  return rows.map((r) => ({
    patientId: r.id,
    score: Number(r.score),
    isEmailExact: Boolean(r.is_email_exact),
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
  //
  // The `::text` cast on `${pvsPatientId}` is required: `payload->>'pvsPatientId'`
  // returns text, but the parameter on the RHS is type-agnostic to the planner,
  // and PG raises 42P18 ("could not determine data type of parameter $N").
  // Identical class to the bug fixed in findFuzzyCandidates (R1 #1).
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
        sql`${schema.pvsEventLog.payload}->>'pvsPatientId' = ${pvsPatientId}::text`
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
