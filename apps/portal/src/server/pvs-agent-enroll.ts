import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  encryptString,
  generateToken,
  sha256Hex,
} from "@/lib/crypto";
import { mintAndStorePvsSecret } from "@/server/clinic-signature";

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
        | "clinic_mismatch";
    };

export async function redeemAgentEnrollment(input: {
  clinicId: string;
  token: string;
  machineFingerprint: string;
  remoteIp: string | null;
}): Promise<RedeemResult> {
  const tokenHash = sha256Hex(input.token);

  const [row] = await db
    .select({
      id: schema.pvsAgentEnrollmentTokens.id,
      clinicId: schema.pvsAgentEnrollmentTokens.clinicId,
      expectedFingerprint:
        schema.pvsAgentEnrollmentTokens.expectedFingerprint,
      consumedAt: schema.pvsAgentEnrollmentTokens.consumedAt,
      expiresAt: schema.pvsAgentEnrollmentTokens.expiresAt,
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

  // Mint the secret and store it encrypted in platform_credentials.
  const { secretHex } = await mintAndStorePvsSecret(
    input.clinicId,
    encryptString
  );

  // Mark token consumed (single-use).
  await db
    .update(schema.pvsAgentEnrollmentTokens)
    .set({
      consumedAt: new Date(),
      consumedFingerprint: input.machineFingerprint,
      consumedIp: input.remoteIp,
    })
    .where(eq(schema.pvsAgentEnrollmentTokens.id, row.id));

  // Ensure the pvs_link row exists & marks the clinic as connected via
  // gdt_agent. If the clinic was on another adapter, this is a switch.
  await db
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

  return { ok: true, pvsSecretHex: secretHex, vendor: "gdt_agent" };
}

// ---------------------------------------------------------------
// Janitor — drop expired-and-unconsumed tokens.
// ---------------------------------------------------------------

export async function purgeExpiredAgentTokens(): Promise<number> {
  const result = await db.execute(
    `DELETE FROM pvs_agent_enrollment_tokens
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
