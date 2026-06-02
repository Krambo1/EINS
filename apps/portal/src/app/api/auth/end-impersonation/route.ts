import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession, destroySession } from "@/auth/session";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { adminOrigin } from "@/lib/env";

/**
 * Ends an impersonation session.
 *
 * Body: none. Method: POST (also accepts GET as a fallback for the
 * "Beenden" link if JS is disabled — both paths behave identically).
 *
 * Behaviour:
 *  - If the current session has `impersonatedByAdminId` set, revoke it
 *    and write an `impersonate_end` audit row.
 *  - If the session is a regular clinic-user session, do nothing —
 *    we never want this endpoint to log out a real user.
 *
 * Response:
 *  - JSON `{ ok: true, redirectTo }` for fetch() callers (the banner JS).
 *  - 302 redirect when the request is form-submitted (Accept: text/html).
 */

async function handle(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  // Admin host is a fixed, configured origin (ADMIN_ORIGIN, falling back to
  // `admin.` + APP_ORIGIN host). Do NOT derive it from the request host: the
  // clinic app this runs on (APP_ORIGIN, e.g. eins-portal.vercel.app) is not a
  // sibling of the admin host, so prepending `admin.` would yield an invalid
  // host like admin.eins-portal.vercel.app.
  const adminBase = adminOrigin();
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");

  if (!session || session.impersonatedByAdminId === null) {
    // Idempotent no-op — never logs out a real user. Return the admin host
    // anyway so the banner JS has somewhere safe to land.
    if (wantsJson) {
      return NextResponse.json({ ok: true, redirectTo: adminBase });
    }
    return NextResponse.redirect(new URL(adminBase));
  }

  const [admin] = await db
    .select({ email: schema.adminUsers.email })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, session.impersonatedByAdminId))
    .limit(1);

  await writeAudit({
    clinicId: session.clinicId,
    actorId: null,
    actorEmail: admin?.email ?? null,
    action: "impersonate_end",
    entityKind: "clinic_user",
    entityId: session.userId,
    diff: {
      adminId: session.impersonatedByAdminId,
      targetUserId: session.userId,
      targetEmail: session.email,
      clinicId: session.clinicId,
    },
  });

  await destroySession();

  const redirectTo = `${adminBase}/clinics/${session.clinicId}`;
  if (wantsJson) {
    return NextResponse.json({ ok: true, redirectTo });
  }
  return NextResponse.redirect(new URL(redirectTo));
}

export const GET = handle;
export const POST = handle;
