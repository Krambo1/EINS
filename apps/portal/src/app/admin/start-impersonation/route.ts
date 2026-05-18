import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "@/auth/admin-guards";
import { issueImpersonationToken } from "@/auth/impersonation";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";

/**
 * POST /admin/start-impersonation
 *
 * Mints an impersonation token and 303s to the clinic-host landing
 * endpoint that consumes it. Accepts one of:
 *   - `targetUserId` — open as a specific clinic user (used by the
 *     per-user button on the clinic-detail Team tab).
 *   - `clinicId` — quick path: auto-pick the clinic's Inhaber (falling
 *     back to the oldest active user). Used by the one-click button in
 *     the admin clinics list so the common case ("open as this praxis")
 *     doesn't require drilling into the detail page.
 *
 * Driven by a real `<form target="_blank" method="POST">` so the browser
 * opens the new tab natively — no `window.open` and no popup-blocker
 * exposure.
 *
 * Why a route handler and not a server action:
 *   Server actions can't open a new browser tab. Their `redirect()`
 *   navigates the *current* page, and `target="_blank"` on a form is
 *   ignored by Next's server-action client runtime (which submits via
 *   fetch). For "do server work, then open the result in a new tab" the
 *   only correct primitive is a real form POST + redirect response.
 *
 * Auth: `requireAdmin()` redirects to /admin/login on missing/expired
 * session. CSRF is mitigated by our session cookie's `sameSite=lax`
 * setting (cross-site POSTs don't carry the cookie). Same-origin POSTs
 * from the admin UI are the only path that authenticates here.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();

  const form = await req.formData();
  const rawUserId = form.get("targetUserId");
  const rawClinicId = form.get("clinicId");

  let targetUserId: string;

  if (rawUserId != null && String(rawUserId).length > 0) {
    const parsed = z.string().uuid().safeParse(String(rawUserId));
    if (!parsed.success) {
      return new NextResponse("invalid_target_user_id", { status: 400 });
    }
    targetUserId = parsed.data;
  } else if (rawClinicId != null && String(rawClinicId).length > 0) {
    const parsed = z.string().uuid().safeParse(String(rawClinicId));
    if (!parsed.success) {
      return new NextResponse("invalid_clinic_id", { status: 400 });
    }
    // Prefer the Inhaber; if there's none (or several archived ones),
    // fall back to the oldest active user. ORDER BY puts inhaber first.
    const [picked] = await db
      .select({ id: schema.clinicUsers.id })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.clinicId, parsed.data),
          isNull(schema.clinicUsers.archivedAt)
        )
      )
      .orderBy(
        sql`CASE WHEN ${schema.clinicUsers.role} = 'inhaber' THEN 0 ELSE 1 END`,
        asc(schema.clinicUsers.createdAt)
      )
      .limit(1);
    if (!picked) {
      return new NextResponse("clinic_has_no_active_users", { status: 404 });
    }
    targetUserId = picked.id;
  } else {
    return new NextResponse("missing_target", { status: 400 });
  }

  // Confirm the target is a real, non-archived clinic_users row. The
  // consumer route also re-checks; we re-check here so the admin gets a
  // 404 immediately rather than landing on the clinic /login with a
  // cryptic ?error=impersonation_no_user.
  const [user] = await db
    .select({
      id: schema.clinicUsers.id,
    })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.id, targetUserId),
        isNull(schema.clinicUsers.archivedAt)
      )
    )
    .limit(1);
  if (!user) {
    return new NextResponse("user_not_found_or_archived", { status: 404 });
  }

  const token = await issueImpersonationToken({
    adminId: admin.adminId,
    targetUserId: user.id,
  });

  // Strip a leading `admin.` from the request host so dev (admin.localhost
  // → localhost) and prod (admin.X → X) behave the same way without env
  // wiring. Falls back to APP_ORIGIN if for some reason the host header is
  // missing (shouldn't happen, but defensive).
  const host = req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "");
  const clinicHost = host.replace(/^admin\./i, "");
  const fallback = env.APP_ORIGIN.replace(/\/$/, "");
  const origin = clinicHost ? `${proto}://${clinicHost}` : fallback;

  const url = `${origin}/api/auth/start-impersonation?token=${encodeURIComponent(token)}`;

  // 303 See Other — the browser switches to GET when following, which is
  // what the consumer endpoint expects.
  return NextResponse.redirect(url, { status: 303 });
}
