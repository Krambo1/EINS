import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession, destroySession } from "@/auth/session";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";

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

function adminOriginFor(req: NextRequest): string {
  const host = req.headers.get("host") ?? "localhost:3001";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  // Strip an existing `admin.` prefix to avoid stacking, then prepend.
  const bare = host.replace(/^admin\./i, "");
  return `${proto}://admin.${bare}`;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const adminOrigin = adminOriginFor(req);
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");

  if (!session || session.impersonatedByAdminId === null) {
    // Idempotent no-op — never logs out a real user. Return the admin host
    // anyway so the banner JS has somewhere safe to land.
    if (wantsJson) {
      return NextResponse.json({ ok: true, redirectTo: adminOrigin });
    }
    return NextResponse.redirect(new URL(adminOrigin));
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

  const redirectTo = `${adminOrigin}/clinics/${session.clinicId}`;
  if (wantsJson) {
    return NextResponse.json({ ok: true, redirectTo });
  }
  return NextResponse.redirect(new URL(redirectTo));
}

export const GET = handle;
export const POST = handle;
