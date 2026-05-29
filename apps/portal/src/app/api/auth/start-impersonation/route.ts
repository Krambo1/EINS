import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { consumeImpersonationToken } from "@/auth/impersonation";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { defaultLandingPath } from "@/lib/roles";
import type { Role } from "@/lib/constants";

/**
 * Clinic-host landing endpoint for the admin "View as user" flow.
 *
 *   GET /api/auth/start-impersonation?token=<one-time-token>
 *
 * The admin host issues the token, hands the URL to the browser, and
 * the browser hits this on `localhost`. We consume the token, mint an
 * impersonation session, audit it, and drop the user on /dashboard.
 *
 * Failure path: redirect to /login with an error query — no session is
 * created, the cleartext token in the URL is now useless either way.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(
      new URL("/login?error=impersonation_missing_token", req.nextUrl.origin)
    );
  }

  const result = await consumeImpersonationToken(token);
  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/login?error=impersonation_${result.reason}`, req.nextUrl.origin)
    );
  }

  // Look up admin email for the audit row — diff carries the rest.
  // Same query also fetches the target user's role so the post-audit redirect
  // honours role-based landing (frontdesk → /anfragen, others → /dashboard).
  const [admin, target] = await Promise.all([
    db
      .select({ email: schema.adminUsers.email })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.id, result.adminId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ role: schema.clinicUsers.role })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.id, result.targetUserId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  await writeAudit({
    clinicId: result.clinicId,
    actorId: null,
    actorEmail: admin?.email ?? null,
    action: "impersonate_start",
    entityKind: "clinic_user",
    entityId: result.targetUserId,
    diff: {
      adminId: result.adminId,
      targetUserId: result.targetUserId,
      targetEmail: result.targetEmail,
      clinicId: result.clinicId,
    },
  });

  return NextResponse.redirect(
    new URL(
      defaultLandingPath(target?.role as Role | null | undefined),
      req.nextUrl.origin
    )
  );
}
