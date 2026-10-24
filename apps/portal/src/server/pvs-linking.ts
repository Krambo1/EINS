import "server-only";
import { and, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { enqueuePvsStatusDerive } from "@/server/jobs";
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
 *       other signal is in disagreement), AND
 *     • names are compatible and dob does not conflict (shared family
 *       email guard).
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
  /** Portal patient's full name / dob, used by the auto-accept compat check. */
  fullName?: string | null;
  dob?: string | null;
  /** pg_trgm similarity(patient.full_name, event.fullName), when both exist. */
  nameSimilarity?: number | null;
}

/** Minimal event identity used by the auto-accept compatibility check. */
export interface LinkEventIdentity {
  fullName?: string | null;
  dob?: string | null;
}

function normalizeNameForCompare(name: string): string {
  return name
    .toLowerCase()
    .replace(/\u00df/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s,\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Last, First" -> Last; "First Middle Last" -> Last. */
function lastNameOf(normalized: string): string {
  if (normalized.includes(",")) return normalized.split(",")[0]!.trim();
  const parts = normalized.split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Names are compatible when either side is unknown (nothing to contradict),
 * the normalized last names are equal (hyphenated double names match on any
 * part), or the trigram similarity of the full names is >= 0.6.
 */
export function namesCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
  similarity?: number | null
): boolean {
  if (!a?.trim() || !b?.trim()) return true;
  if (typeof similarity === "number" && similarity >= 0.6) return true;
  const la = lastNameOf(normalizeNameForCompare(a));
  const lb = lastNameOf(normalizeNameForCompare(b));
  if (!la || !lb) return true;
  if (la === lb) return true;
  const pa = la.split("-");
  const pb = lb.split("-");
  return pa.some((x) => x.length > 1 && pb.includes(x));
}

function dobConflicts(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  return a.slice(0, 10) !== b.slice(0, 10);
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
  candidates: LinkCandidate[],
  event?: LinkEventIdentity
): LinkCandidate | null {
  const emailExact = candidates.filter((c) => c.isEmailExact);
  if (emailExact.length !== 1) return null;
  const winner = emailExact[0]!;
  if (winner.score < 1.0) return null;
  // Shared family email (parent = lead, daughter = PVS patient): the email
  // alone does not prove it is the same person. Require compatible names and
  // no dob conflict when both sides carry the data; otherwise the caller
  // routes to the review queue and creates no link.
  if (event) {
    if (!namesCompatible(winner.fullName, event.fullName, winner.nameSimilarity)) {
      return null;
    }
    if (dobConflicts(winner.dob, event.dob)) return null;
  }
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
    if (!(await newerPatientUpsertApplied(event))) {
      await mergePvsDataIntoPatient(stage1.portalPatientId, event, stage1.method);
    }
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
        await mergePvsDataIntoPatient(matched.patientId, event, "bemerkung_token");
        return {
          portalPatientId: matched.patientId,
          method: "bemerkung_token",
          candidates: [],
        };
      }
      if (matched) {
        // Pass 2: the token names an Anfrage that has no patient yet, which
        // is the normal case (nothing creates a patient at lead intake). It
        // used to fall through to Stage 3, where a lead with a typo'd email
        // or no email never matched, so the strongest link we have was
        // thrown away. Create the patient from the PVS data, carry the
        // Anfrage's source as first touch, and stamp the Anfrage.
        const newPatientId = await createPatientFromPvs(event, matched.source);
        const inserted = await db
          .insert(schema.pvsPatientMap)
          .values({
            clinicId: event.clinicId,
            pvsPatientId: event.pvsPatientId,
            portalPatientId: newPatientId,
            linkMethod: "bemerkung_token",
            confidenceScore: "1.0",
          })
          .onConflictDoNothing({
            target: [
              schema.pvsPatientMap.clinicId,
              schema.pvsPatientMap.pvsPatientId,
            ],
          })
          .returning({ portalPatientId: schema.pvsPatientMap.portalPatientId });
        let portalPatientId = newPatientId;
        let method = "bemerkung_token";
        if (!inserted || inserted.length === 0) {
          // Lost a race with a concurrent event for the same PVS patient.
          const winnerMap = await resolvePatientLink(
            event.clinicId,
            event.pvsPatientId
          );
          if (winnerMap && winnerMap.portalPatientId !== newPatientId) {
            await db
              .delete(schema.patients)
              .where(eq(schema.patients.id, newPatientId));
            portalPatientId = winnerMap.portalPatientId;
            method = winnerMap.method;
          }
        }
        await db
          .update(schema.requests)
          .set({ patientId: portalPatientId })
          .where(
            and(
              eq(schema.requests.id, matched.requestId),
              eq(schema.requests.clinicId, event.clinicId),
              isNull(schema.requests.patientId)
            )
          );
        return { portalPatientId, method, candidates: [] };
      }
    }
  }

  // Stage 3: collect candidates (same scoring as before, used for the
  // review-queue UI), then apply the P1-1 tightened auto-accept gate.
  const candidates = await findFuzzyCandidates(event);

  const winner = chooseAutoAcceptCandidate(candidates, {
    fullName: event.fullName,
    dob: event.dob,
  });
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
    await mergePvsDataIntoPatient(winner.patientId, event, "email_exact");
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
  // ON CONFLICT DO NOTHING: two concurrent events for the same new PVS patient
  // both reach this point. The loser must not blow up on the unique map key
  // nor leave a ghost patient behind.
  const inserted = await db
    .insert(schema.pvsPatientMap)
    .values({
      clinicId: event.clinicId,
      pvsPatientId: event.pvsPatientId,
      portalPatientId: newPatientId,
      linkMethod: "external_id",
      confidenceScore: "1.0",
    })
    .onConflictDoNothing({
      target: [
        schema.pvsPatientMap.clinicId,
        schema.pvsPatientMap.pvsPatientId,
      ],
    })
    .returning({ portalPatientId: schema.pvsPatientMap.portalPatientId });
  if (!inserted || inserted.length === 0) {
    const winnerMap = await resolvePatientLink(event.clinicId, event.pvsPatientId);
    if (winnerMap && winnerMap.portalPatientId !== newPatientId) {
      // Lost the race: drop the patient row we just created (nothing else
      // references it yet) and use the winner's.
      await db
        .delete(schema.patients)
        .where(eq(schema.patients.id, newPatientId));
      return {
        portalPatientId: winnerMap.portalPatientId,
        method: winnerMap.method,
        candidates: [],
      };
    }
  }

  return {
    portalPatientId: newPatientId,
    method: "external_id",
    candidates,
  };
}

/**
 * Pass 2: when a PVS id is re-pointed (manual resolve, PatientMerged), the
 * Anfragen attached to the patient it left must follow it, or they lose
 * their PVS status and revenue (the new patient's derive only attaches
 * Anfragen that have no patient). Moves them only when the old patient has
 * no PVS id left, i.e. it was nothing but that PVS identity.
 */
export async function moveRequestsOfUnmappedPatient(
  clinicId: string,
  fromPatientId: string,
  toPatientId: string
): Promise<void> {
  if (fromPatientId === toPatientId) return;
  const [stillMapped] = await db
    .select({ id: schema.pvsPatientMap.id })
    .from(schema.pvsPatientMap)
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, clinicId),
        eq(schema.pvsPatientMap.portalPatientId, fromPatientId)
      )
    )
    .limit(1);
  if (stillMapped) return;
  await db
    .update(schema.requests)
    .set({ patientId: toPatientId })
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        eq(schema.requests.patientId, fromPatientId)
      )
    );
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
): Promise<{ requestId: string; patientId: string | null; source: string } | null> {
  // prefix is 8 hex chars; collision probability across clinic-scoped
  // requests is ~1 in 2^32 / requestsPerClinic. For a Praxis with 1000
  // requests, false-positive rate ≈ 0.00002%. Acceptable; we still order
  // by created_at DESC to prefer the most recent match if collisions ever
  // occur, and reject if >1 match exists.
  const rows = await db
    .select({
      id: schema.requests.id,
      patientId: schema.requests.patientId,
      source: schema.requests.source,
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
  return {
    requestId: rows[0]!.id,
    patientId: rows[0]!.patientId,
    source: rows[0]!.source,
  };
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
    full_name: string | null;
    dob: string | null;
    name_similarity: number | null;
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
        ) AS email_reason,
        p.full_name AS full_name,
        p.dob::text AS dob,
        (
          CASE WHEN ${fullName}::text IS NOT NULL AND p.full_name IS NOT NULL
               THEN similarity(p.full_name, ${fullName}::text) ELSE NULL END
        ) AS name_similarity
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
      is_email_exact,
      full_name,
      dob,
      name_similarity
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
    fullName: r.full_name ?? null,
    dob: r.dob ?? null,
    nameSimilarity:
      r.name_similarity === null || r.name_similarity === undefined
        ? null
        : Number(r.name_similarity),
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
  event: PatientUpsertedEvent,
  firstTouchSource = "pvs"
): Promise<string> {
  let emailLower = event.email?.trim().toLowerCase() ?? null;
  let phone = event.phone ?? null;
  // patients has UNIQUE(clinic_id, email) and UNIQUE(clinic_id, phone). When the
  // linker declined to merge into the existing holder (shared family email, or
  // a review-queue candidate) the new patient must not claim the same email or
  // phone, or the insert fails with 23505 and the event can never apply.
  if (emailLower || phone) {
    const holders = await db
      .select({ email: schema.patients.email, phone: schema.patients.phone })
      .from(schema.patients)
      .where(
        and(
          eq(schema.patients.clinicId, event.clinicId),
          or(
            emailLower
              ? sql`lower(${schema.patients.email}::text) = ${emailLower}`
              : undefined,
            phone ? eq(schema.patients.phone, phone) : undefined
          )
        )
      );
    for (const h of holders) {
      if (emailLower && String(h.email ?? "").toLowerCase() === emailLower) {
        emailLower = null;
      }
      if (phone && h.phone === phone) phone = null;
    }
  }
  // citext customType declares notNull:true in the Drizzle layer even
  // though the DB column is nullable; the cast to `string` is the
  // narrowest workaround. Drizzle serializes null to SQL NULL fine.
  const [row] = await db
    .insert(schema.patients)
    .values({
      clinicId: event.clinicId,
      email: emailLower as unknown as string,
      phone,
      fullName: event.fullName ?? null,
      dob: event.dob ?? null,
      gender: event.gender ?? null,
      pvsPatientId: event.pvsPatientId,
      externalId: event.externalId ?? null,
      firstTouchSource,
    })
    .returning({ id: schema.patients.id });
  return row!.id;
}

/**
 * Pass 2: the agent re-orders events (a retried row is sent behind newer
 * ones), so an OLDER PatientUpserted can arrive after a newer one of the same
 * PVS patient and used to overwrite the newer email / phone / name. Every
 * producer stamps occurredAt with the record's modification time (DB
 * modified_at, REST modifiedAt, GDT file mtime), so a later occurredAt from
 * the same source that is already applied means this event is stale. Uses
 * pvs_event_log_patient_idx (clinic_id, payload->>'pvsPatientId', occurred_at).
 * Equal times still merge (unchanged behaviour).
 */
async function newerPatientUpsertApplied(event: PatientUpsertedEvent): Promise<boolean> {
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return false;
  const [row] = await db
    .select({ id: schema.pvsEventLog.id })
    .from(schema.pvsEventLog)
    .where(
      and(
        eq(schema.pvsEventLog.clinicId, event.clinicId),
        sql`${schema.pvsEventLog.payload}->>'pvsPatientId' = ${event.pvsPatientId}::text`,
        eq(schema.pvsEventLog.kind, "PatientUpserted"),
        eq(schema.pvsEventLog.bridgeSource, event.bridgeSource),
        gt(schema.pvsEventLog.occurredAt, occurredAt),
        isNotNull(schema.pvsEventLog.appliedAt)
      )
    )
    .limit(1);
  return !!row;
}

async function mergePvsDataIntoPatient(
  portalPatientId: string,
  event: PatientUpsertedEvent,
  linkMethod?: string
): Promise<void> {
  // An email_exact link is only a weak identity signal (shared family
  // email): never overwrite identity fields of the existing portal patient,
  // fill them only when empty. Stage-1/token/manual links are authoritative.
  const fillOnly = linkMethod === "email_exact";
  // Pass 2: patients has UNIQUE(clinic_id, email) and UNIQUE(clinic_id,
  // phone). A PVS record whose email or phone already belongs to ANOTHER
  // portal patient (family member, duplicate the operator has not merged)
  // made this UPDATE fail with 23505 on every retry, so the event never
  // applied and the patient's PVS data froze. Keep the current value then.
  const emailLower = event.email ? event.email.trim().toLowerCase() : null;
  const emailHeldElsewhere = emailLower
    ? sql`EXISTS (SELECT 1 FROM patients q WHERE q.clinic_id = patients.clinic_id AND q.id <> patients.id AND lower(q.email::text) = ${emailLower}::text)`
    : sql`FALSE`;
  const phoneHeldElsewhere = event.phone
    ? sql`EXISTS (SELECT 1 FROM patients q WHERE q.clinic_id = patients.clinic_id AND q.id <> patients.id AND q.phone = ${event.phone}::text)`
    : sql`FALSE`;
  // Only overwrite fields if the PVS provides them — never clobber a
  // portal-side value with NULL. The denormalized pvs_patient_id is updated
  // unconditionally so the patient detail page can show "primary PVS id".
  await db
    .update(schema.patients)
    .set({
      lastSeenAt: new Date(),
      email: emailLower
        ? sql`CASE WHEN ${emailHeldElsewhere} THEN ${schema.patients.email} ELSE ${emailLower}::citext END`
        : sql`${schema.patients.email}`,
      phone: !event.phone
        ? sql`${schema.patients.phone}`
        : fillOnly
          ? sql`CASE WHEN ${phoneHeldElsewhere} THEN ${schema.patients.phone} ELSE COALESCE(${schema.patients.phone}, ${event.phone}::text) END`
          : sql`CASE WHEN ${phoneHeldElsewhere} THEN ${schema.patients.phone} ELSE ${event.phone}::text END`,
      fullName: fillOnly
        ? sql`COALESCE(${schema.patients.fullName}, ${event.fullName ?? null})`
        : (event.fullName ?? sql`${schema.patients.fullName}`),
      dob: fillOnly
        ? sql`COALESCE(${schema.patients.dob}, ${event.dob ?? null}::date)`
        : (event.dob ?? sql`${schema.patients.dob}`),
      gender: event.gender ?? sql`${schema.patients.gender}`,
      // Pass 2 (verifier): patients_pvs_id_unique (clinic_id, pvs_patient_id).
      // After a manual re-link or a PatientMerged the map points this PVS id at
      // a new patient while the old one still carries the id, so the next
      // PatientUpserted failed with 23505 on every retry (agent queue stuck,
      // contact data frozen). The column is a display copy; the map links.
      pvsPatientId: sql`CASE WHEN EXISTS (SELECT 1 FROM patients q WHERE q.clinic_id = patients.clinic_id AND q.id <> patients.id AND q.pvs_patient_id = ${event.pvsPatientId}::text) THEN patients.pvs_patient_id ELSE ${event.pvsPatientId}::text END`,
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
  /** Tenant scope — runs on the superuser `db`, so the WHERE predicate is the only tenancy guard. */
  clinicId: string;
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
        eq(schema.linkingFailures.clinicId, input.clinicId),
        eq(schema.linkingFailures.status, "open"),
        isNull(schema.linkingFailures.resolvedAt)
      )
    )
    .limit(1);
  if (!failure) return;

  // Cross-tenant linkage guard (pentest H5): `pickedPatientId` is client-
  // supplied for every method (the "new_patient" path also hands us an id
  // rather than creating one server-side). This runs on the superuser `db`
  // with no RLS, so the failure's clinic scope above does NOT constrain the
  // target patient. Prove the picked patient belongs to the SAME clinic
  // before writing the link, else a settings user in clinic A could point
  // their PVS patient at clinic B's portal patient. Fail closed (no-op).
  const [patient] = await db
    .select({ id: schema.patients.id })
    .from(schema.patients)
    .where(
      and(
        eq(schema.patients.id, input.pickedPatientId),
        eq(schema.patients.clinicId, failure.clinicId)
      )
    )
    .limit(1);
  if (!patient) return;

  // Pass 2: the patient this PVS id pointed at before the operator's pick
  // (usually the one Stage 3 created). Without a derive it kept the lifetime
  // revenue and its Anfragen kept the PVS revenue, counted twice.
  const previous = await resolvePatientLink(failure.clinicId, failure.pvsPatientId);

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

  if (previous && previous.portalPatientId !== input.pickedPatientId) {
    await moveRequestsOfUnmappedPatient(
      failure.clinicId,
      previous.portalPatientId,
      input.pickedPatientId
    );
    await enqueuePvsStatusDerive(failure.clinicId, previous.portalPatientId);
  }

  await db
    .update(schema.linkingFailures)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: input.resolverUserId,
      resolvedToPatientId: input.pickedPatientId,
      resolutionMethod: input.method,
    })
    .where(
      and(
        eq(schema.linkingFailures.id, input.failureId),
        eq(schema.linkingFailures.clinicId, input.clinicId)
      )
    );
}

export async function ignoreLinkingFailure(
  failureId: string,
  clinicId: string,
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
    .where(
      and(
        eq(schema.linkingFailures.id, failureId),
        eq(schema.linkingFailures.clinicId, clinicId)
      )
    );
}
