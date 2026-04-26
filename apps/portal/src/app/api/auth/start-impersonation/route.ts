import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { consumeImpersonationToken } from "@/auth/impersonation";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";

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
  const [admin] = await db
    .select({ email: schema.adminUsers.email })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, result.adminId))
    .limit(1);

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

  return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
}
