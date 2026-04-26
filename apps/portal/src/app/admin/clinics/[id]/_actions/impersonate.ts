"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { requireAdmin } from "@/auth/admin-guards";
import { issueImpersonationToken } from "@/auth/impersonation";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";

/**
 * Mints an impersonation token for `targetUserId` and returns the URL
 * (on the clinic host) the browser should open in a new tab.
 *
 * Hard-required:
 *  - Caller is an authenticated, MFA-verified admin (requireAdmin).
 *  - Target is a non-archived clinic_users row.
 *
 * The audit log row is written when the token is *consumed* on the
 * clinic host (start-impersonation route). We don't audit the issue
 * step separately — it would just be noise if the token never gets
 * used (browser closed, network failure, etc.).
 */
export async function startImpersonationAction(
  targetUserId: string
): Promise<{ url: string }> {
  const admin = await requireAdmin();

  const id = z.string().uuid().parse(targetUserId);

  // Confirm the target user is real and not archived. The consumer also
  // checks this — we re-check here to give the admin an immediate error
  // rather than redirecting to /login with a cryptic query string.
  const [user] = await db
    .select({
      id: schema.clinicUsers.id,
      clinicId: schema.clinicUsers.clinicId,
      email: schema.clinicUsers.email,
    })
    .from(schema.clinicUsers)
    .where(
      and(eq(schema.clinicUsers.id, id), isNull(schema.clinicUsers.archivedAt))
    )
    .limit(1);

  if (!user) {
    throw new Error("user_not_found_or_archived");
  }

  const token = await issueImpersonationToken({
    adminId: admin.adminId,
    targetUserId: user.id,
  });

  // Build the clinic-host URL. We strip a leading `admin.` from the request
  // host so dev (admin.localhost:3001 → localhost:3001) and prod (admin.X
  // → X) behave the same way without env wiring.
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "";
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const clinicHost = host.replace(/^admin\./i, "");
  const fallback = env.APP_ORIGIN.replace(/\/$/, "");
  const origin = clinicHost ? `${proto}://${clinicHost}` : fallback;

  const url = `${origin}/api/auth/start-impersonation?token=${encodeURIComponent(token)}`;
  return { url };
}
