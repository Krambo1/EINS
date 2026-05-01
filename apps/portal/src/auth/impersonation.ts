import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "../db/client";
import { generateToken, sha256Hex } from "../lib/crypto";
import { createSession } from "./session";

/**
 * "View as clinic user" handoff between the admin host (admin.localhost)
 * and the clinic host (localhost).
 *
 * The admin clicks "Als Benutzer öffnen" in the admin panel. We mint a
 * 60s single-use token, hand it to the browser as a URL on the clinic
 * host, and consume it there to mint a clinic session bound to the
 * target user (with `impersonatedByAdminId` set).
 *
 * The cleartext token only lives in the URL. We store its sha256 in
 * `impersonation_tokens` so a leaked DB row alone can't impersonate.
 */

export const IMPERSONATION_TOKEN_TTL_SECONDS = 60;

interface IssueOpts {
  adminId: string;
  targetUserId: string;
}

/** Mints + persists a token. Caller is responsible for verifying admin auth. */
export async function issueImpersonationToken(opts: IssueOpts): Promise<string> {
  const token = generateToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + IMPERSONATION_TOKEN_TTL_SECONDS * 1000);

  const hdrs = await headers();
  const ip = parseIp(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));

  await db.insert(schema.impersonationTokens).values({
    tokenHash,
    adminId: opts.adminId,
    targetUserId: opts.targetUserId,
    expiresAt,
    issueIp: ip ?? undefined,
  });

  return token;
}

export type ConsumeResult =
  | {
      ok: true;
      adminId: string;
      targetUserId: string;
      clinicId: string;
      targetEmail: string;
    }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "no_user" };

/**
 * Atomically consume a token and create the impersonation session. If
 * everything checks out, the caller's request now carries a clinic-host
 * session cookie tied to the target user.
 */
export async function consumeImpersonationToken(token: string): Promise<ConsumeResult> {
  const tokenHash = sha256Hex(token);

  const outcome: ConsumeResult = await db.transaction(async (tx): Promise<ConsumeResult> => {
    const rows = await tx
      .select({
        id: schema.impersonationTokens.id,
        adminId: schema.impersonationTokens.adminId,
        targetUserId: schema.impersonationTokens.targetUserId,
        expiresAt: schema.impersonationTokens.expiresAt,
        consumedAt: schema.impersonationTokens.consumedAt,
      })
      .from(schema.impersonationTokens)
      .where(eq(schema.impersonationTokens.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row) return { ok: false, reason: "invalid" as const };
    if (row.consumedAt) return { ok: false, reason: "consumed" as const };
    if (row.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: "expired" as const };
    }

    const users = await tx
      .select({
        id: schema.clinicUsers.id,
        clinicId: schema.clinicUsers.clinicId,
        email: schema.clinicUsers.email,
        archivedAt: schema.clinicUsers.archivedAt,
      })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.id, row.targetUserId))
      .limit(1);

    const user = users[0];
    if (!user || user.archivedAt) return { ok: false, reason: "no_user" as const };

    const consumed = await tx
      .update(schema.impersonationTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(schema.impersonationTokens.id, row.id),
          isNull(schema.impersonationTokens.consumedAt)
        )
      )
      .returning({ id: schema.impersonationTokens.id });

    if (consumed.length === 0) {
      return { ok: false, reason: "consumed" as const };
    }

    return {
      ok: true as const,
      adminId: row.adminId,
      targetUserId: user.id,
      clinicId: user.clinicId,
      targetEmail: user.email,
    };
  });

  if (!outcome.ok) return outcome;

  // Mint a session with MFA pre-cleared (admin already authenticated upstream)
  // and the impersonation marker set so banner + audit + guards can react.
  await createSession(outcome.targetUserId, {
    mfaVerified: true,
    impersonatedByAdminId: outcome.adminId,
  });

  return outcome;
}

function parseIp(xff: string | null, xri: string | null): string | null {
  const first = (xff ?? xri ?? "").split(",")[0]?.trim();
  return first || null;
}
