import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  encryptString,
  generateToken,
  sha256Hex,
} from "@/lib/crypto";
import {
  invalidateSignatureSecretCache,
  mintAndStorePvsSecret,
} from "@/server/clinic-signature";

/**
 * PVS Bridge — GDT-Agent enrollment.
 *
 * Flow:
 *   1. Inhaber clicks "Agent installieren" → server-action calls
 *      issueAgentEnrollment(clinicId, userId). We generate a random token,
 *      store sha256(token), return the plaintext for one-time display.
 *      The portal renders it inside an installer command-line snippet
 *      (e.g. `eins-agent --enroll <token> --clinic <clinicId>`).
 *
 *   2. Inhaber installs the agent on the Praxis workstation; the agent
 *      reads the token from CLI args, captures a machine fingerprint
 *      (host name + OS + first MAC), and POSTs /api/pvs/agent-enroll
 *      with {clinicId, token, machineFingerprint}.
 *
 *   3. redeemAgentEnrollment() verifies the token (timing-safe, single-use,
 *      not expired), mints a per-clinic HMAC secret via
 *      mintAndStorePvsSecret (stores it encrypted in
 *      platform_credentials.platform='pvs'), marks the enrollment row
 *      consumed, and returns the secret plaintext to the agent ONCE.
 *
 *   4. The agent stores the secret encrypted with DPAPI (Windows) /
 *      Keychain (Mac) and uses it from then on to sign POSTs to
 *      /api/pvs/events directly (bypassing the Bridge service, which is
 *      not in the on-prem network path).
 *
 *   5. The pvs_link row is upserted with vendor='gdt_agent', status='connected'.
 *
 * Note: this flow MINTS a new pvs secret on every successful enrollment,
 * so re-running enrollment effectively rotates the secret and invalidates
 * all previously-deployed installer copies.
 */

const TOKEN_TTL_HOURS = 24;

// ---------------------------------------------------------------
// Issue (called from portal server-action)
// ---------------------------------------------------------------

export interface IssueResult {
  enrollmentId: string;
  token: string;
  expiresAt: Date;
}

export async function issueAgentEnrollment(input: {
  clinicId: string;
  createdBy: string;
  expectedFingerprint?: string;
  /**
   * P1-3: operator opt-in for vendor switch. Set to true ONLY when this
   * enrollment is intentionally migrating a clinic from a prior PVS
   * adapter (Tomedo, Pabau, RED, etc.) to gdt_agent. False by default so
   * a routine "install the agent" workflow can never silently re-point
   * a working integration.
   */
  allowVendorSwitch?: boolean;
}): Promise<IssueResult> {
  const token = generateToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const [row] = await db
    .insert(schema.pvsAgentEnrollmentTokens)
    .values({
      clinicId: input.clinicId,
      tokenHash,
      expectedFingerprint: input.expectedFingerprint ?? null,
      createdBy: input.createdBy,
      expiresAt,
      allowVendorSwitch: input.allowVendorSwitch ?? false,
    })
    .returning({ id: schema.pvsAgentEnrollmentTokens.id });

  return { enrollmentId: row!.id, token, expiresAt };
}

// ---------------------------------------------------------------
// Redeem (called from /api/pvs/agent-enroll)
// ---------------------------------------------------------------

export type RedeemResult =
  | { ok: true; pvsSecretHex: string; vendor: "gdt_agent" }
  | {
      ok: false;
      reason:
        | "token_invalid"
        | "token_expired"
        | "token_consumed"
        | "fingerprint_mismatch"
        | "clinic_mismatch"
        | "vendor_switch_requires_confirmation";
    };

/**
 * Internal sentinel used to abort the redemption transaction with a specific
 * RedeemResult reason. Thrown inside `db.transaction(...)` so the tx rolls
 * back the partial work (no orphaned secret, no half-consumed token);
 * caught at the outer boundary and translated into a clean RedeemResult.
 *
 * We never let this escape the module — the outer try/catch re-throws
 * anything else (real DB errors, etc.) so they fail loudly.
 */
class EnrollmentAbort extends Error {
  constructor(public readonly reason: RedeemResultReason) {
    super(`enrollment_abort:${reason}`);
    this.name = "EnrollmentAbort";
  }
}

type RedeemResultReason =
  | "token_invalid"
  | "token_expired"
  | "token_consumed"
  | "fingerprint_mismatch"
  | "clinic_mismatch"
  | "vendor_switch_requires_confirmation";

export async function redeemAgentEnrollment(input: {
  clinicId: string;
  token: string;
  machineFingerprint: string;
  remoteIp: string | null;
}): Promise<RedeemResult> {
  const tokenHash = sha256Hex(input.token);

  // Cheap pre-check (outside tx) so we can return specific error reasons
  // without burning a transaction on hostile spray traffic. The real,
  // race-safe claim happens INSIDE the tx below via a conditional UPDATE.
  const [row] = await db
    .select({
      id: schema.pvsAgentEnrollmentTokens.id,
      clinicId: schema.pvsAgentEnrollmentTokens.clinicId,
      expectedFingerprint:
        schema.pvsAgentEnrollmentTokens.expectedFingerprint,
      consumedAt: schema.pvsAgentEnrollmentTokens.consumedAt,
      expiresAt: schema.pvsAgentEnrollmentTokens.expiresAt,
      allowVendorSwitch:
        schema.pvsAgentEnrollmentTokens.allowVendorSwitch,
    })
    .from(schema.pvsAgentEnrollmentTokens)
    .where(eq(schema.pvsAgentEnrollmentTokens.tokenHash, tokenHash))
    .limit(1);
  if (!row) return { ok: false, reason: "token_invalid" };

  if (row.clinicId !== input.clinicId) {
    return { ok: false, reason: "clinic_mismatch" };
  }
  if (row.consumedAt) return { ok: false, reason: "token_consumed" };
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "token_expired" };
  }
  if (
    row.expectedFingerprint &&
    row.expectedFingerprint !== input.machineFingerprint
  ) {
    return { ok: false, reason: "fingerprint_mismatch" };
  }

  // P1-3: vendor-switch gate.
  //
  // Read the clinic's CURRENT pvs_link (if any) outside the tx. If a link
  // exists AND its vendor is something other than 'gdt_agent' AND the
  // token used here was issued WITHOUT allow_vendor_switch=true, refuse
  // the redemption. The operator must explicitly tick the box when
  // issuing the token to confirm they're migrating PVS adapters; this
  // prevents a routine "install the agent" workflow from silently
  // breaking a clinic that's on Tomedo / Pabau / RED.
  //
  // Read outside the tx is acceptable here because (a) the pre-check
  // exists for ergonomics — the in-tx work below already won't proceed
  // if the gate fires, and (b) a vendor change between this read and
  // the tx body would have to be operator-initiated, which is the same
  // operator who is currently redeeming.
  const [currentLink] = await db
    .select({
      vendor: schema.pvsLink.pvsVendor,
    })
    .from(schema.pvsLink)
    .where(eq(schema.pvsLink.clinicId, input.clinicId))
    .limit(1);
  const wouldSwitchVendor =
    currentLink !== undefined &&
    currentLink.vendor !== "gdt_agent" &&
    currentLink.vendor !== "none";
  if (wouldSwitchVendor && !row.allowVendorSwitch) {
    return { ok: false, reason: "vendor_switch_requires_confirmation" };
  }

  // P0-1: Atomic redemption.
  //
  // The previous implementation performed three independent writes (mint
  // secret → consume token → upsert link). A transient failure between
  // steps 1 and 2 — or a concurrent second redemption arriving between the
  // pre-check above and step 2 — would silently rotate the freshly-deployed
  // secret out from under the legitimate agent, producing a 401 storm with
  // no operator-visible signal. See the Phase 0 hardening plan.
  //
  // Fix: wrap all three writes in one transaction, AND claim the token via
  // a conditional UPDATE (consumed_at IS NULL → set + RETURNING) that the
  // DB serializes per-row. If the UPDATE returns zero rows we know another
  // concurrent caller won the race; we abort the tx (rolling back the
  // mint), the legitimate caller retries cleanly against the now-consumed
  // token, and gets `token_consumed` from the pre-check on their next attempt.
  let secretHex: string;
  try {
    secretHex = await db.transaction(async (tx) => {
      // 1) Atomic claim. Conditional WHERE prevents two simultaneous
      //    redemptions from both proceeding past this point.
      const claimed = await tx
        .update(schema.pvsAgentEnrollmentTokens)
        .set({
          consumedAt: new Date(),
          consumedFingerprint: input.machineFingerprint,
          consumedIp: input.remoteIp,
        })
        .where(
          and(
            eq(schema.pvsAgentEnrollmentTokens.id, row.id),
            isNull(schema.pvsAgentEnrollmentTokens.consumedAt)
          )
        )
        .returning({ id: schema.pvsAgentEnrollmentTokens.id });
      if (claimed.length === 0) {
        // Someone else consumed the token in the gap between our pre-check
        // and this UPDATE. Abort cleanly — no secret minted, no link
        // change. Note: we throw here so the tx callback's outer
        // `db.transaction(...)` rolls back any prior statements in this
        // block. (Currently the UPDATE is the first write, but defensively
        // structuring the abort as a throw keeps future refactors safe.)
        throw new EnrollmentAbort("token_consumed");
      }

      // 2) Mint and store the per-clinic HMAC secret. Pass the tx handle
      //    so this insert/upsert participates in the same transaction —
      //    a failure on step 3 below will roll back the mint and the
      //    previously-deployed secret stays in place.
      const minted = await mintAndStorePvsSecret(
        input.clinicId,
        encryptString,
        tx as unknown as typeof db
      );

      // 3) Upsert pvs_link to mark the clinic as connected via gdt_agent.
      //    The P1-3 vendor-switch gate has already run above; if we got
      //    here, either no prior link existed, OR the operator explicitly
      //    opted into the switch via allow_vendor_switch=true on the token.
      //    Either way, write the audit row so the change is traceable
      //    in pvs_link_audit (the admin clinic-detail page reads this).
      await tx
        .insert(schema.pvsLink)
        .values({
          clinicId: input.clinicId,
          pvsVendor: "gdt_agent",
          status: "connected",
          connectionConfig: {
            machineFingerprint: input.machineFingerprint,
          },
        })
        .onConflictDoUpdate({
          target: schema.pvsLink.clinicId,
          set: {
            pvsVendor: "gdt_agent",
            status: "connected",
            connectionConfig: {
              machineFingerprint: input.machineFingerprint,
            },
            updatedAt: new Date(),
          },
        });

      // Phase 7: seed the gdt_agent provenance in pvs_link_source inside the
      // same tx. The file-watcher path signs and POSTs gdt_agent events the
      // moment the agent starts, which can be before its first heartbeat; this
      // closes that gap so those events never hit the membership 409. Idempotent
      // on re-enrollment (reinstall / workstation move).
      await tx
        .insert(schema.pvsLinkSource)
        .values({
          clinicId: input.clinicId,
          bridgeSource: "gdt_agent",
          pvsVendor: "gdt_agent",
          enrolledVia: "enrollment",
        })
        .onConflictDoUpdate({
          target: [
            schema.pvsLinkSource.clinicId,
            schema.pvsLinkSource.bridgeSource,
          ],
          set: { lastSeenAt: new Date(), enrolledVia: "enrollment" },
        });

      // Audit: always log the enrollment; additionally log the vendor
      // change if one happened.
      await tx.insert(schema.pvsLinkAudit).values({
        clinicId: input.clinicId,
        kind: "enrollment_redeemed",
        fromValue: currentLink?.vendor ?? null,
        toValue: "gdt_agent",
        context: {
          machineFingerprint: input.machineFingerprint,
          remoteIp: input.remoteIp,
          tokenId: row.id,
        },
      });
      if (
        currentLink !== undefined &&
        currentLink.vendor !== "gdt_agent" &&
        currentLink.vendor !== "none"
      ) {
        await tx.insert(schema.pvsLinkAudit).values({
          clinicId: input.clinicId,
          kind: "vendor_switch",
          fromValue: currentLink.vendor,
          toValue: "gdt_agent",
          context: {
            tokenId: row.id,
            allowVendorSwitch: row.allowVendorSwitch,
          },
        });
      }

      return minted.secretHex;
    });
  } catch (err) {
    if (err instanceof EnrollmentAbort) {
      return { ok: false, reason: err.reason };
    }
    throw err;
  }

  // Cache invalidation MUST happen post-commit, never inside the tx.
  // Invalidating earlier opens a window where a concurrent verifyClinicSignature
  // re-reads the DB (which still sees the pre-commit secret), caches it, and
  // then strands the new secret for the cache TTL.
  invalidateSignatureSecretCache(input.clinicId, "pvs");

  return { ok: true, pvsSecretHex: secretHex, vendor: "gdt_agent" };
}

// ---------------------------------------------------------------
// Janitor — drop expired-and-unconsumed tokens.
// ---------------------------------------------------------------

export async function purgeExpiredAgentTokens(): Promise<number> {
  // Tagged with `sql` for consistency with the rest of the module — there
  // are no interpolations here so this is purely a style win, but it keeps
  // the P0-5 grep gate simple (every db.execute in this file goes through
  // the parameterising tag).
  const result = await db.execute(
    sql`DELETE FROM pvs_agent_enrollment_tokens
       WHERE consumed_at IS NULL AND expires_at < now()`
  );
  return (result as unknown as { count?: number }).count ?? 0;
}

// Re-export for visibility into list views.
export async function listOpenEnrollments(clinicId: string) {
  return await db
    .select({
      id: schema.pvsAgentEnrollmentTokens.id,
      createdAt: schema.pvsAgentEnrollmentTokens.createdAt,
      expiresAt: schema.pvsAgentEnrollmentTokens.expiresAt,
      expectedFingerprint:
        schema.pvsAgentEnrollmentTokens.expectedFingerprint,
    })
    .from(schema.pvsAgentEnrollmentTokens)
    .where(
      and(
        eq(schema.pvsAgentEnrollmentTokens.clinicId, clinicId),
        isNull(schema.pvsAgentEnrollmentTokens.consumedAt),
        gt(schema.pvsAgentEnrollmentTokens.expiresAt, new Date())
      )
    );
}
