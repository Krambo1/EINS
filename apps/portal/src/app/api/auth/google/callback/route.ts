import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { createSession } from "@/auth/session";
import {
  exchangeCodeForGoogleEmail,
  verifyLoginState,
  readLoginStateCookie,
  clearLoginStateCookie,
  googleClinicRedirectUri,
} from "@/auth/google-login";
import { hasGoogleLogin } from "@/lib/env";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { defaultLandingPath } from "@/lib/roles";
import type { Role } from "@/lib/constants";

/**
 * Clinic "Mit Google anmelden" — step 2 (Google bounces here with ?code&state).
 *
 *   GET /api/auth/google/callback
 *
 * Validates the CSRF state (cookie === query + valid signature + clinic track),
 * exchanges the code for a verified email, then matches a NON-archived
 * clinic_users row by that email. Match → mint a session and land on the
 * role's default page. No match → /login?error=google_no_account. We never
 * create an account here; Google is just another way to prove email ownership.
 */
function loginError(origin: string, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${code}`, origin));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;

  if (!hasGoogleLogin()) {
    await clearLoginStateCookie();
    return loginError(origin, "google_unavailable");
  }

  // Per-IP throttle. Each attempt already requires a full Google auth, but cap
  // it anyway. rateLimit fails open if Postgres is unreachable.
  const ip =
    (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "")
      .split(",")[0]
      ?.trim() || "unknown";
  const rl = await rateLimit("login:google:ip", ip, {
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok) {
    await clearLoginStateCookie();
    return loginError(origin, "google_error");
  }

  const code = req.nextUrl.searchParams.get("code");
  const stateQuery = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  if (errorParam || !code || !stateQuery) {
    await clearLoginStateCookie();
    return loginError(origin, "google_error");
  }

  // Double-binding: state cookie must equal the state query AND verify as a
  // clinic-track JWT.
  const stateCookie = await readLoginStateCookie();
  const statePayload =
    stateCookie && stateCookie === stateQuery
      ? await verifyLoginState(stateQuery)
      : null;
  if (!statePayload || statePayload.track !== "clinic") {
    await clearLoginStateCookie();
    return loginError(origin, "google_error");
  }

  let identity;
  try {
    identity = await exchangeCodeForGoogleEmail({
      code,
      redirectUri: googleClinicRedirectUri(),
    });
  } catch (err) {
    console.error("[oauth/google-login/clinic] exchange failed:", err);
    await clearLoginStateCookie();
    return loginError(origin, "google_error");
  }
  await clearLoginStateCookie();

  if (!identity.emailVerified) {
    return loginError(origin, "google_unverified");
  }

  const [user] = await db
    .select({
      id: schema.clinicUsers.id,
      clinicId: schema.clinicUsers.clinicId,
      role: schema.clinicUsers.role,
    })
    .from(schema.clinicUsers)
    .where(
      and(
        eq(schema.clinicUsers.email, identity.email),
        isNull(schema.clinicUsers.archivedAt)
      )
    )
    .limit(1);

  if (!user) {
    await writeAudit({
      actorEmail: identity.email,
      action: "login",
      entityKind: "login",
      diff: { method: "google", ok: false, reason: "no_account" },
    });
    return loginError(origin, "google_no_account");
  }

  await createSession(user.id);
  await writeAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    actorEmail: identity.email,
    action: "login",
    entityKind: "login",
    diff: { method: "google", ok: true },
  });

  return NextResponse.redirect(
    new URL(defaultLandingPath(user.role as Role | null), origin)
  );
}
