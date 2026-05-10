import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSession } from "@/auth/session";
import { db, schema } from "@/db/client";
import { writeAudit } from "@/server/audit";

/**
 * PATCH /api/me/ui-mode — switch the current user between Einfach / Detail.
 *
 * Why this route is hand-rolled instead of using `withApi(...)`:
 *
 *   Turbopack's route-handler compiler walks named-method exports (PATCH /
 *   POST / GET / …) to discover route handlers. For
 *
 *     export const PATCH = withApi({}, async ({ session, request }) => {…})
 *
 *   the compiler's export-graph analysis intermittently fails to track the
 *   const through the higher-order `withApi` call under HMR, so changes to
 *   the wrapped handler don't take effect (or the route 404s entirely)
 *   until a full restart. Webpack's pipeline doesn't have this issue —
 *   which is exactly the symptom we hit here (toggle works without
 *   `--turbopack`, dies with it). A plain `export async function PATCH(…)`
 *   sidesteps the static-analysis quirk because the function declaration
 *   is unambiguous to Turbopack.
 *
 * The auth + audit semantics are inlined to match what `withApi({})` would
 * have done: 401 with no session, 403 when MFA is enrolled but unverified
 * (no permission gate — every authenticated user can flip their own UI
 * mode), 422 on bad input, and an audit row on success.
 */

const Body = z.object({ mode: z.enum(["einfach", "detail"]) });

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Nicht angemeldet." } },
      { status: 401 }
    );
  }
  if (session.mfaEnrolled && !session.mfaVerified) {
    return NextResponse.json(
      { error: { code: "mfa_required", message: "Zwei-Faktor-Bestätigung erforderlich." } },
      { status: 403 }
    );
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation",
          message: "Eingabe ist nicht gültig.",
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
      },
      { status: 422 }
    );
  }

  const previous = session.uiMode;
  const next = parsed.data.mode;

  await db
    .update(schema.clinicUsers)
    .set({ uiMode: next })
    .where(eq(schema.clinicUsers.id, session.userId));

  // Audit failures are swallowed inside writeAudit so they can't fail the
  // user-facing action.
  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "ui_mode_change",
    entityKind: "settings",
    entityId: session.userId,
    diff: { from: previous, to: next },
  });

  return NextResponse.json({ ok: true, mode: next });
}
