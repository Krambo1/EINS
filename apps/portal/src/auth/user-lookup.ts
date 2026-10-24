import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client";

/**
 * Login-time lookup of a clinic user by email.
 *
 * `clinic_users.email` is only unique per Praxis (B-7), so the same address
 * can exist in two Praxen. Every login path (password, magic link, Google,
 * password reset) resolves through this one function so the answer is:
 *   - active only: the user is not archived AND the Praxis is not archived
 *     (G-05 / B-12: archiving a Praxis locks its users out of every login path)
 *   - deterministic: the OLDEST membership wins (created_at, then id). A later
 *     invite of the same address into another Praxis can therefore never
 *     hijack where an existing user lands. New cross-Praxis invites are refused
 *     in inviteTeamMemberAction.
 */
export interface ActiveClinicUser {
  id: string;
  clinicId: string;
  fullName: string | null;
  role: string;
  passwordHash: string | null;
}

export async function findActiveClinicUserByEmail(
  email: string
): Promise<ActiveClinicUser | null> {
  const lower = email.trim().toLowerCase();
  if (!lower) return null;
  const [row] = await db
    .select({
      id: schema.clinicUsers.id,
      clinicId: schema.clinicUsers.clinicId,
      fullName: schema.clinicUsers.fullName,
      role: schema.clinicUsers.role,
      passwordHash: schema.clinicUsers.passwordHash,
    })
    .from(schema.clinicUsers)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
    .where(
      and(
        eq(schema.clinicUsers.email, lower),
        isNull(schema.clinicUsers.archivedAt),
        isNull(schema.clinics.archivedAt)
      )
    )
    .orderBy(asc(schema.clinicUsers.createdAt), asc(schema.clinicUsers.id))
    .limit(1);
  return row ?? null;
}

/**
 * Whether a clinic user (by id) is active: user and Praxis both not archived.
 * Used by the token consumers (magic link, password setup, impersonation).
 */
export async function findActiveClinicUserById(
  userId: string,
  handle: Pick<typeof db, "select"> = db
): Promise<{ id: string; clinicId: string; email: string } | null> {
  const [row] = await handle
    .select({
      id: schema.clinicUsers.id,
      clinicId: schema.clinicUsers.clinicId,
      email: schema.clinicUsers.email,
    })
    .from(schema.clinicUsers)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
    .where(
      and(
        eq(schema.clinicUsers.id, userId),
        isNull(schema.clinicUsers.archivedAt),
        isNull(schema.clinics.archivedAt)
      )
    )
    .limit(1);
  return row ?? null;
}
