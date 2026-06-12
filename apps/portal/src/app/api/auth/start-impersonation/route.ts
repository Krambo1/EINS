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
 *   POST /api/auth/start-impersonation   (body: token=<one-time-token>)
 *
 * The admin host issues the token and hands the browser an auto-submitting
 * POST form (NOT a GET redirect) so the cleartext token never lands in a URL
 * or an access log (pentest M1). The browser POSTs here on the clinic host;
 * we consume the token, mint an impersonation session, audit it, and 303 the
 * user to their role landing page.
 *
 * The token IS the capability (256-bit, single-use, 60s, IP-stamped at issue),
 * so authorization is by token possession — this cross-origin POST needs no
 * pre-existing cookie. A GET handler is intentionally absent: there is no
 * token-in-query code path to leak.
 *
 * Failure path: 303 to /login with an error query — no session is created.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let token: string | null = null;
  try {
    const form = await req.formData();
    const raw = form.get("token");
    token = typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    token = null;
  }
  if (!token) {
    return NextResponse.redirect(
      new URL("/login?error=impersonation_missing_token", req.nextUrl.origin),
      { status: 303 }
    );
  }

  const result = await consumeImpersonationToken(token);
  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/login?error=impersonation_${result.reason}`, req.nextUrl.origin),
      { status: 303 }
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
    ),
    { status: 303 }
  );
}
